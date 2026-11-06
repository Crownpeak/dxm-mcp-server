import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
    search, searchFields, advancedSearch, SEARCH_PATH, ADVANCED_SEARCH_PATH, ADVANCED_FIELDS_PATH,
    SEARCH_SORT, SEARCH_FIELDS, SEARCH_OPERATIONS, SEARCH_MAX_PAGE_SIZE, ADVANCED_SEARCH_MAX_SET_VALUES, ADVANCED_SEARCH_MAX_EXPRESSIONS
} from "../dxm/search.js";
import { registerReadTools } from "../dxm/tools/search.js";
import { makeFakeCms, makeFakeDxm } from "./_helpers.js";

// A fake CMS whose `Util.makeCall` records (path, body) and answers from `answers[path]`
// (a value or a function of the body). The CMS's custom field list is `fields`.
function setup({ answers = {}, fields = ["class_name", "body", "label"], host = "cms.example", instance = "I1" } = {}) {
    const calls = [];
    const cms = makeFakeCms({
        host, instance,
        Util: {
            makeCall: async (_cms, path, body) => {
                calls.push({ path, body });
                if (path === ADVANCED_FIELDS_PATH) {
                    return { resultCode: "conWS_Success", searchFields: fields.map(name => ({ name, type: "Custom", isList: name === "body" })) };
                }
                const answer = answers[path];
                return typeof answer === "function" ? answer(body) : answer;
            }
        }
    });
    const dxm = makeFakeDxm(cms);
    return { dxm, calls, of: path => calls.filter(c => c.path === path) };
}

const worklist = (id, over = {}) => ({
    id, label: `Asset ${id}`, type: 2, fullPath: `/Site/Asset ${id}`, statusName: "Draft", folder_id: 9, branchId: -2, error_msg: null,
    cookie: ["session=secret"], ...over
});
const ok = extra => ({ resultCode: "conWS_Success", errorMessage: "", ...extra });

describe("search", () => {
    test("posts the simple-search body: trimmed text, 1-based page, default sort, no content", async () => {
        const { dxm, of } = setup({ answers: { [SEARCH_PATH]: ok({ assets: [] }) } });
        await search(dxm, { query: "  home ", page: 2, pageSize: 10 });
        assert.deepEqual(of(SEARCH_PATH)[0].body, {
            query: "home", currentPage: 2, pageSize: 10, sortColumn: 0, orderType: 0, includeContentFields: false
        });
    });

    test("sort names map to the CMS's column numbers, descending to orderType 1", async () => {
        const { dxm, of } = setup({ answers: { [SEARCH_PATH]: ok({ assets: [] }) } });
        await search(dxm, { query: "x", sort: "created", descending: true, includeContent: true });
        const body = of(SEARCH_PATH)[0].body;
        assert.equal(body.sortColumn, 4);
        assert.equal(body.orderType, 1);
        assert.equal(body.includeContentFields, true);
        // label 13 and size 24 are the ones checked live as plain text/number sorts
        assert.equal(SEARCH_SORT.label, 13);
        assert.equal(SEARCH_SORT.size, 24);
    });

    test("returns mapAsset records without the session cookie, and says if a full page may have more", async () => {
        const { dxm } = setup({ answers: { [SEARCH_PATH]: ok({ assets: [worklist(1), worklist(2)] }) } });
        const full = await search(dxm, { query: "a", pageSize: 2 });
        assert.deepEqual(full.results[0], {
            id: 1, label: "Asset 1", type: "File", fullPath: "/Site/Asset 1", status: "Draft", folder_id: 9, branchId: -2, error_msg: null
        });
        assert.equal(full.count, 2);
        assert.equal(full.mayHaveMore, true);
        assert.ok(!JSON.stringify(full).includes("secret"));
        const partial = await search(dxm, { query: "a", pageSize: 5 });
        assert.equal(partial.mayHaveMore, false);
        assert.equal("total" in partial, false);
    });

    test("rejects bad arguments before logging in", async () => {
        const { dxm } = setup();
        for (const args of [{ query: "" }, { query: "   " }, { query: 5 }, { query: "a", page: 0 }, { query: "a", pageSize: SEARCH_MAX_PAGE_SIZE + 1 }, { query: "a", sort: "bogus" }]) {
            await assert.rejects(search(dxm, args), undefined, JSON.stringify(args));
        }
        assert.equal(dxm.ensureLoginCalls, 0);
    });

    test("throws the CMS's message when the search is refused", async () => {
        const { dxm } = setup({ answers: { [SEARCH_PATH]: { resultCode: "conWS_GeneralError", errorMessage: "boom" } } });
        await assert.rejects(search(dxm, { query: "a" }), /Search failed: boom/);
    });
});

describe("searchFields and the field cache", () => {
    test("lists the 26 built-in fields with their operators, plus the custom fields", async () => {
        const { dxm } = setup();
        const result = await searchFields(dxm);
        assert.equal(result.builtIn.length, 26);
        assert.deepEqual(result.builtIn.find(f => f.field === "Label").operators, ["Contains", "NotContains", "StartsWith", "EndsWith", "Equals", "NotEquals", "IsNull", "NotNull"]);
        assert.deepEqual(result.builtIn.find(f => f.field === "Status").operators, ["Equals", "NotEquals"]);
        assert.deepEqual(result.custom, [{ name: "class_name", isList: false }, { name: "body", isList: true }, { name: "label", isList: false }]);
        assert.ok(result.customOperators.includes("Contains"));
        assert.ok(!result.customOperators.includes("GreaterThan"));
    });

    test("search keeps only names containing the text, case-insensitively", async () => {
        const { dxm } = setup();
        const result = await searchFields(dxm, { search: "LAB" });
        assert.deepEqual(result.builtIn.map(f => f.field), ["Label"]);
        assert.deepEqual(result.custom.map(f => f.name), ["label"]);
    });

    test("is fetched once per CMS instance, and again for another instance", async () => {
        const { dxm, of } = setup();
        await Promise.all([searchFields(dxm), searchFields(dxm)]);
        await searchFields(dxm);
        assert.equal(of(ADVANCED_FIELDS_PATH).length, 1);
        dxm._cms.instance = "I2";
        await searchFields(dxm);
        assert.equal(of(ADVANCED_FIELDS_PATH).length, 2);
    });

    test("a failed fetch is not kept", async () => {
        let fail = true;
        const calls = [];
        const cms = makeFakeCms({
            host: "h", instance: "i",
            Util: { makeCall: async (_c, path) => { calls.push(path); return fail ? { resultCode: "conWS_GeneralError", errorMessage: "down" } : ok({ searchFields: [{ name: "a", isList: false }] }); } }
        });
        const dxm = makeFakeDxm(cms);
        await assert.rejects(searchFields(dxm), /Could not read the search fields: down/);
        fail = false;
        assert.deepEqual((await searchFields(dxm)).custom, [{ name: "a", isList: false }]);
        assert.equal(calls.length, 2);
    });

    test("every built-in field has a type with a defined operator set", () => {
        for (const f of SEARCH_FIELDS) assert.ok(f.type && f.description, f.property);
        assert.equal(new Set(SEARCH_FIELDS.map(f => f.property)).size, SEARCH_FIELDS.length);
    });
});

describe("advancedSearch request bodies", () => {
    const answers = { [ADVANCED_SEARCH_PATH]: ok({ searchResults: [], total: 0 }) };
    const send = async (filters, rest = {}) => {
        const s = setup({ answers });
        await advancedSearch(s.dxm, { filters, ...rest });
        return { ...s, body: s.of(ADVANCED_SEARCH_PATH)[0].body };
    };

    test("a label search is the working UI payload", async () => {
        const { body } = await send([{ field: "Label", operation: "StartsWith", value: "test" }], { pageSize: 50 });
        assert.deepEqual(body, {
            limit: 500,
            filterExpressions: [{ filterId: 0, logical: "NotSet", name: "[Label]", propertyName: "Label", operation: "StartsWith", orderId: 1, value: "test" }],
            sortOrder: null, baseAssetId: 0, additionalBuiltInFields: null, responseType: "WorklistAsset", pageNumber: 1, pageSize: 50
        });
    });

    test("a custom field sends its own name and no propertyName", async () => {
        const { body } = await send([{ field: "class_name", operation: "Equals", value: "test2" }]);
        assert.deepEqual(body.filterExpressions, [{ filterId: 0, logical: "NotSet", name: "class_name", operation: "Equals", orderId: 1, value: "test2" }]);
    });

    test("an And-joined pair is the working UI payload: id fields use valueDropDown, numbers go as text", async () => {
        const { body } = await send([
            { field: "TemplateName", operation: "Equals", value: 3814 },
            { field: "Id", operation: "GreaterThan", value: 1000 }
        ]);
        assert.deepEqual(body.filterExpressions, [
            { filterId: 0, logical: "And", name: "[TemplateName]", propertyName: "TemplateName", operation: "Equals", orderId: 1, valueDropDown: 3814 },
            { filterId: 0, logical: "NotSet", name: "[Id]", propertyName: "Id", operation: "GreaterThan", orderId: 2, value: "1000" }
        ]);
    });

    test("logical joins a filter to the next one; the last is always NotSet", async () => {
        const { body } = await send([
            { field: "Id", operation: "Equals", value: 1, logical: "Or" },
            { field: "Id", operation: "Equals", value: 2 },
            { field: "Id", operation: "Equals", value: 3, logical: "Or" }
        ]);
        assert.deepEqual(body.filterExpressions.map(f => [f.orderId, f.logical]), [[1, "Or"], [2, "And"], [3, "NotSet"]]);
    });

    test("paging, limit, folder scope and the light response type are passed on", async () => {
        const { body } = await send([{ field: "Label", operation: "Contains", value: "x" }], { page: 3, pageSize: 20, limit: 100, baseAssetId: 3121, light: true });
        assert.equal(body.pageNumber, 3);
        assert.equal(body.pageSize, 20);
        assert.equal(body.limit, 100);
        assert.equal(body.baseAssetId, 3121);
        assert.equal(body.responseType, "LightAsset");
    });

    test("IsNull and NotNull send no value; dates are passed as given; Type takes a name", async () => {
        const { body } = await send([
            { field: "CheckedOutBy", operation: "IsNull", value: "ignored" },
            { field: "CreateDate", operation: "GreaterThan", value: "2025-01-01" },
            { field: "ModifiedDate", operation: "LessThan", value: "2025-01-01T08:30:00Z" },
            { field: "Type", operation: "Equals", value: "folder" },
            { field: "Type", operation: "NotEquals", value: "2" }
        ]);
        const [a, b, c, d, e] = body.filterExpressions;
        assert.equal("value" in a, false);
        assert.equal("valueDropDown" in a, false);
        assert.equal(b.value, "2025-01-01");
        assert.equal(c.value, "2025-01-01T08:30:00Z");
        assert.equal(d.valueDropDown, 4);
        assert.equal(e.valueDropDown, 2);
    });
});

describe("advancedSearch lists of values", () => {
    const answers = { [ADVANCED_SEARCH_PATH]: ok({ searchResults: [], total: 0 }) };
    const expand = async filters => {
        const s = setup({ answers });
        await advancedSearch(s.dxm, { filters });
        return s.of(ADVANCED_SEARCH_PATH)[0].body.filterExpressions;
    };
    const summary = expr => expr.map(e => [e.orderId, e.name, e.operation, e.valueDropDown ?? e.value, e.logical]);

    test("Equals with a list is an Or chain of Equals, since the CMS's IsInSet is not implemented", async () => {
        const expr = await expand([{ field: "TemplateName", operation: "Equals", value: [123, 456, 789] }]);
        assert.deepEqual(summary(expr), [
            [1, "[TemplateName]", "Equals", 123, "Or"],
            [2, "[TemplateName]", "Equals", 456, "Or"],
            [3, "[TemplateName]", "Equals", 789, "NotSet"]
        ]);
        assert.ok(expr.every(e => e.operation !== "IsInSet"));
    });

    test("an Equals list alongside other filters is distributed over them, because And binds tighter than Or", async () => {
        // (Template = 1 or 2) and Label starts with x  ->  (T=1 and L) or (T=2 and L)
        const expr = await expand([
            { field: "TemplateName", operation: "Equals", value: [1, 2] },
            { field: "Label", operation: "StartsWith", value: "x" }
        ]);
        assert.deepEqual(summary(expr), [
            [1, "[TemplateName]", "Equals", 1, "And"], [2, "[Label]", "StartsWith", "x", "Or"],
            [3, "[TemplateName]", "Equals", 2, "And"], [4, "[Label]", "StartsWith", "x", "NotSet"]
        ]);
    });

    test("two Equals lists give every combination", async () => {
        const expr = await expand([
            { field: "TemplateName", operation: "Equals", value: [1, 2] },
            { field: "Type", operation: "Equals", value: ["File", "Folder", 9] }
        ]);
        assert.equal(expr.length, 12);
        assert.equal(expr.filter(e => e.logical === "Or").length, 5);
        assert.equal(expr.at(-1).logical, "NotSet");
        const pairs = [];
        for (let i = 0; i < 12; i += 2) pairs.push([expr[i].valueDropDown, expr[i + 1].valueDropDown]);
        assert.deepEqual(pairs, [[1, 2], [1, 4], [1, 9], [2, 2], [2, 4], [2, 9]]);
    });

    test("NotEquals with a list is plain Ands in place, keeping the filter's own join", async () => {
        const expr = await expand([
            { field: "Id", operation: "Equals", value: 5, logical: "Or" },
            { field: "Type", operation: "NotEquals", value: ["Folder", "File"], logical: "Or" },
            { field: "Label", operation: "Equals", value: "z" }
        ]);
        assert.deepEqual(summary(expr), [
            [1, "[Id]", "Equals", "5", "Or"],
            [2, "[Type]", "NotEquals", 4, "And"],
            [3, "[Type]", "NotEquals", 2, "Or"],
            [4, "[Label]", "Equals", "z", "NotSet"]
        ]);
    });

    test("each value in a list is validated like a single one", async () => {
        const s = setup({ answers });
        await assert.rejects(advancedSearch(s.dxm, { filters: [{ field: "Type", operation: "Equals", value: ["File", "Banana"] }] }), /Unknown asset type "Banana"/);
        await assert.rejects(advancedSearch(s.dxm, { filters: [{ field: "Size", operation: "Equals", value: [1, "big"] }] }), /Size takes a number/);
        assert.equal(s.of(ADVANCED_SEARCH_PATH).length, 0);
    });

    test("lists are refused where they can't mean what was asked", async () => {
        const s = setup({ answers });
        const refuse = (filters, pattern) => assert.rejects(advancedSearch(s.dxm, { filters }), pattern);
        await refuse([{ field: "Id", operation: "GreaterThan", value: [1, 2] }], /works with Equals .* or NotEquals .*not GreaterThan/);
        await refuse([{ field: "Id", operation: "Equals", value: [] }], /list of values is empty/);
        await refuse([{ field: "Id", operation: "Equals", value: Array.from({ length: ADVANCED_SEARCH_MAX_SET_VALUES + 1 }, (_, i) => i) }], /at most 20 values/);
        await refuse([{ field: "Id", operation: "Equals", value: 1, logical: "Or" }, { field: "Id", operation: "Equals", value: [2, 3] }], /can't be combined with an "Or"/);
        await refuse([
            { field: "Id", operation: "Equals", value: Array.from({ length: 20 }, (_, i) => i) },
            { field: "Type", operation: "Equals", value: ["File", "Folder", 9, 10] }
        ], new RegExp(`more than ${ADVANCED_SEARCH_MAX_EXPRESSIONS} conditions`));
        assert.equal(s.of(ADVANCED_SEARCH_PATH).length, 0);
    });

    test("the largest allowed request is 60 expressions", async () => {
        const expr = await expand([
            { field: "Id", operation: "Equals", value: Array.from({ length: 20 }, (_, i) => i + 1) },
            { field: "Label", operation: "Contains", value: "home" },
            { field: "Type", operation: "Equals", value: "File" }
        ]);
        assert.equal(expr.length, ADVANCED_SEARCH_MAX_EXPRESSIONS);
        assert.deepEqual(expr.map(e => e.orderId), Array.from({ length: 60 }, (_, i) => i + 1));
    });
});

describe("advancedSearch field resolution", () => {
    const answers = { [ADVANCED_SEARCH_PATH]: ok({ searchResults: [], total: 0 }) };
    const names = async (filters, opts) => {
        const s = setup({ answers, ...opts });
        await advancedSearch(s.dxm, { filters });
        return { ...s, expr: s.of(ADVANCED_SEARCH_PATH)[0].body.filterExpressions };
    };

    test("an exact built-in name needs no field lookup", async () => {
        const { of } = await names([{ field: "Label", operation: "Equals", value: "x" }]);
        assert.equal(of(ADVANCED_FIELDS_PATH).length, 0);
    });

    test("[Label] is the built-in even when a custom field has that name", async () => {
        const { expr } = await names([{ field: "[label]", operation: "Equals", value: "x" }]);
        assert.equal(expr[0].propertyName, "Label");
    });

    test("a custom field named like a built-in is reachable by its exact name", async () => {
        const { expr } = await names([{ field: "label", operation: "Equals", value: "x" }]);
        assert.equal(expr[0].propertyName, undefined);
        assert.equal(expr[0].name, "label");
    });

    test("a loose built-in name works when there is no custom field of that name", async () => {
        const { expr } = await names([{ field: "createdby", operation: "Equals", value: 5 }], { fields: ["class_name"] });
        assert.equal(expr[0].propertyName, "CreatedBy");
    });

    test("a custom field name is matched case-insensitively and sent in its real case", async () => {
        const { expr } = await names([{ field: "CLASS_NAME", operation: "Equals", value: "x" }]);
        assert.equal(expr[0].name, "class_name");
    });

    test("an unknown field is an error with similar names and the built-in list, since the CMS would return zero rows", async () => {
        const s = setup({ answers, fields: ["class_name", "main_class", "body"] });
        await assert.rejects(
            advancedSearch(s.dxm, { filters: [{ field: "class", operation: "Equals", value: "x" }] }),
            err => /No search field is called "class"/.test(err.message) && /class_name, main_class/.test(err.message) && /Built-in fields: Id, Label/.test(err.message)
        );
        assert.equal(s.of(ADVANCED_SEARCH_PATH).length, 0);
    });

    test("an unknown [bracketed] built-in is an error", async () => {
        const s = setup({ answers });
        await assert.rejects(advancedSearch(s.dxm, { filters: [{ field: "[Nope]", operation: "Equals", value: "x" }] }), /No built-in search field is called "\[Nope\]"/);
    });
});

describe("advancedSearch validation", () => {
    const answers = { [ADVANCED_SEARCH_PATH]: ok({ searchResults: [], total: 0 }) };
    const reject = (filter, pattern) => {
        const s = setup({ answers });
        return assert.rejects(advancedSearch(s.dxm, { filters: [filter] }), pattern).then(() => assert.equal(s.of(ADVANCED_SEARCH_PATH).length, 0));
    };

    test("an operation the field's type doesn't take is refused, naming what it does take", async () => {
        await reject({ field: "Label", operation: "GreaterThan", value: "a" }, /Label is a String field and doesn't support GreaterThan\. It takes: Contains/);
        await reject({ field: "CreateDate", operation: "Contains", value: "2025" }, /CreateDate is a Date field/);
        await reject({ field: "Id", operation: "StartsWith", value: "1" }, /Id is a Numeric field/);
        await reject({ field: "Status", operation: "IsNull" }, /Status is a Status field and doesn't support IsNull/);
        await reject({ field: "class_name", operation: "NotContains", value: "a" }, /class_name is a Custom field/);
    });

    test("an unknown operation is refused", async () => {
        await reject({ field: "Label", operation: "Like", value: "a" }, /Unknown operation "Like"/);
    });

    test("every type's operators are within the operations the tool offers", async () => {
        const { builtIn, customOperators } = await searchFields(setup().dxm);
        for (const op of [...builtIn.flatMap(f => f.operators), ...customOperators]) assert.ok(SEARCH_OPERATIONS.includes(op), op);
    });

    test("values are checked against the field's type", async () => {
        await reject({ field: "Label", operation: "Equals" }, /Label Equals needs a value/);
        await reject({ field: "Label", operation: "Equals", value: "  " }, /needs a value/);
        await reject({ field: "Size", operation: "GreaterThan", value: "big" }, /Size takes a number/);
        await reject({ field: "CreateDate", operation: "GreaterThan", value: "yesterday" }, /CreateDate takes a date as YYYY-MM-DD/);
        await reject({ field: "TemplateName", operation: "Equals", value: "hero" }, /TemplateName takes an id/);
        await reject({ field: "Type", operation: "Equals", value: "Banana" }, /Unknown asset type "Banana"/);
        await reject({ field: "Label", operation: "Equals", value: "a", logical: "Xor" }, /logical must be "And" or "Or"/);
    });

    test("the filter list and paging arguments are checked before logging in", async () => {
        const { dxm } = setup({ answers });
        const one = [{ field: "Label", operation: "Equals", value: "a" }];
        for (const args of [
            { filters: [] }, { filters: "Label" }, { filters: Array(21).fill(one[0]) },
            { filters: one, page: 0 }, { filters: one, pageSize: 0 }, { filters: one, limit: 1001 }, { filters: one, baseAssetId: -1 }
        ]) {
            await assert.rejects(advancedSearch(dxm, args), undefined, JSON.stringify(args));
        }
        assert.equal(dxm.ensureLoginCalls, 0);
    });
});

describe("advancedSearch results", () => {
    const filters = [{ field: "Label", operation: "Contains", value: "a" }];

    test("full records are mapped like find_asset's, with no session cookie", async () => {
        const { dxm } = setup({ answers: { [ADVANCED_SEARCH_PATH]: ok({ searchResults: [worklist(7, { type: 4 })], total: 1 }) } });
        const result = await advancedSearch(dxm, { filters });
        assert.deepEqual(result, {
            total: 1, limit: 500, limitReached: false, page: 1, pageSize: 50,
            results: [{ id: 7, label: "Asset 7", type: "Folder", fullPath: "/Site/Asset 7", status: "Draft", folder_id: 9, branchId: -2, error_msg: null }]
        });
        assert.ok(!JSON.stringify(result).includes("secret"));
    });

    test("light records keep the useful fields and drop the CMS's null settings", async () => {
        const light = { label: "home02.jpg", id: 3166, folderId: 3121, statusId: 783, type: 2, workflowId: 15, parentPath: "/A/images/home02.jpg", preferenceData: null, publishingServers: null };
        const { dxm } = setup({ answers: { [ADVANCED_SEARCH_PATH]: ok({ searchResults: null, lightSearchResults: [light], total: 1 }) } });
        const result = await advancedSearch(dxm, { filters, light: true });
        assert.deepEqual(result.results, [{ id: 3166, label: "home02.jpg", type: "File", fullPath: "/A/images/home02.jpg", folder_id: 3121, statusId: 783, workflow_id: 15 }]);
    });

    test("limitReached flags a total that hit the limit, since the CMS stops counting there", async () => {
        const { dxm } = setup({ answers: { [ADVANCED_SEARCH_PATH]: ok({ searchResults: [worklist(1)], total: 100 }) } });
        const result = await advancedSearch(dxm, { filters, limit: 100 });
        assert.equal(result.total, 100);
        assert.equal(result.limitReached, true);
    });

    test("a null result list is an empty one", async () => {
        const { dxm } = setup({ answers: { [ADVANCED_SEARCH_PATH]: ok({ searchResults: null, total: 0 }) } });
        assert.deepEqual((await advancedSearch(dxm, { filters })).results, []);
    });

    test("a refused search throws the CMS's message", async () => {
        const { dxm } = setup({ answers: { [ADVANCED_SEARCH_PATH]: { resultCode: "conWS_GeneralError", errorMessage: "Field name failed." } } });
        await assert.rejects(advancedSearch(dxm, { filters }), /Advanced search failed: Field name failed\./);
    });
});

describe("search tools", () => {
    function register() {
        const tools = new Map();
        const calls = [];
        const dxm = {
            search: async a => { calls.push(["search", a]); return { results: [] }; },
            searchFields: async a => { calls.push(["searchFields", a]); return { builtIn: [], custom: [] }; },
            advancedSearch: async a => { calls.push(["advancedSearch", a]); return { results: [] }; }
        };
        registerReadTools({ tool: (name, description, schema, handler) => tools.set(name, { description, schema, handler }) }, dxm);
        return { tools, calls };
    }

    test("registers search, search_fields and advanced_search", () => {
        assert.deepEqual([...register().tools.keys()].sort(), ["advanced_search", "search", "search_fields"]);
    });

    test("search passes its arguments on, renamed", async () => {
        const { tools, calls } = register();
        await tools.get("search").handler({ query: "home", page: 2, page_size: 10, sort: "label", descending: true, include_content: true });
        assert.deepEqual(calls[0], ["search", { query: "home", page: 2, pageSize: 10, sort: "label", descending: true, includeContent: true }]);
    });

    test("advanced_search passes its arguments on, renamed", async () => {
        const { tools, calls } = register();
        const filters = [{ field: "Label", operation: "Equals", value: "x" }];
        await tools.get("advanced_search").handler({ filters, base_asset_id: 5, page: 2, page_size: 10, limit: 100, light: true });
        assert.deepEqual(calls[0], ["advancedSearch", { filters, baseAssetId: 5, page: 2, pageSize: 10, limit: 100, light: true }]);
    });

    test("search_fields passes the search text on", async () => {
        const { tools, calls } = register();
        await tools.get("search_fields").handler({ search: "class" });
        assert.deepEqual(calls[0], ["searchFields", { search: "class" }]);
    });

    test("the schemas accept only the offered operations and sorts, and the description lists every built-in field", () => {
        const { tools } = register();
        const { filters } = tools.get("advanced_search").schema;
        assert.equal(filters.safeParse([{ field: "Label", operation: "Equals", value: "x" }]).success, true);
        assert.equal(filters.safeParse([{ field: "Label", operation: "Like", value: "x" }]).success, false);
        assert.equal(filters.safeParse([]).success, false);
        assert.equal(filters.safeParse([{ field: "TemplateName", operation: "Equals", value: [1, 2, "3"] }]).success, true);
        assert.equal(filters.safeParse([{ field: "TemplateName", operation: "Equals", value: [] }]).success, false);
        assert.equal(tools.get("search").schema.sort.safeParse("label").success, true);
        assert.equal(tools.get("search").schema.sort.safeParse("bogus").success, false);
        for (const f of SEARCH_FIELDS) assert.ok(tools.get("advanced_search").description.includes(f.property), f.property);
    });
});
