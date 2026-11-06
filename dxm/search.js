import { mapAsset } from "./util.js";

// Two searches, two endpoints. Neither has a helper wrapper, so both go through the generic
// `cms.Util.makeCall`. Swagger gives no names for the advanced filter's numeric enums, so the
// tables below come from the CMS web UI's own code (its public JavaScript bundle) and from
// probing CPUK; CLAUDE.md records which is which.
export const SEARCH_PATH = "/Asset/Search";
export const ADVANCED_SEARCH_PATH = "/Asset/AdvancedSearch";
export const ADVANCED_FIELDS_PATH = "/Asset/AdvancedSearchFieldOptions";

export const SEARCH_MAX_PAGE_SIZE = 200;
const SEARCH_DEFAULT_PAGE_SIZE = 50;
// `limit` caps the *total* the CMS counts, not just the page: limit 1 gave total 1. 500 is what
// the CMS UI sends. A search that reaches it has more matches than the total says.
export const ADVANCED_SEARCH_DEFAULT_LIMIT = 500;
export const ADVANCED_SEARCH_MAX_LIMIT = 1000;
export const ADVANCED_SEARCH_MAX_FILTERS = 20;

// /Asset/Search's sortColumn, by name. The numbers are the CMS UI's field keys (Label 13, Type
// 29, Size 24...); Swagger lists them as a bare enum. Checked live: every one reordered results.
// 0 and -1 mean "no sort". 31 and 55 are in Swagger's enum but nothing identifies what they sort
// by, so they aren't offered.
export const SEARCH_SORT = {
    label: 13, created: 4, changed: 32, status_date: 54, size: 24, type: 29,
    status: 25, created_by: 3, modified_by: 17, last_status_by: 53
};
// orderType: the helper's Util.OrderType is Ascending 0, Descending 1 (2 NotSet and 3 Saved are no use here).
const ORDER_ASCENDING = 0;
const ORDER_DESCENDING = 1;

// The advanced filter's field types, as the CMS UI names them. The type decides which operators
// are allowed and how the value is sent.
const STRING = "String", NUMERIC = "Numeric", DATE = "Date", USER = "User", CUSTOM = "Custom";
const MODEL = "Model", BASE_MODEL = "BaseModel", STATUS = "Status", TEMPLATE = "Template", WORKFLOW = "Workflow", FILE_TYPE = "FileType";
// Types whose value is the id of something the CMS lists (a dropdown in the UI).
const LIST_TYPES = new Set([USER, MODEL, BASE_MODEL, STATUS, TEMPLATE, WORKFLOW, FILE_TYPE]);

// Built-in fields: the 26 the CMS UI offers. The CMS's PropertyName enum has 45 names; the other
// 18 are unused by the UI and not offered, because the CMS answers each with "Filtering is not yet
// implemented" (Template works, but only as a duplicate of TemplateID). `property` is what goes in the filter's
// propertyName, and `[property]` is its `name`.
export const SEARCH_FIELDS = [
    { property: "Id", type: NUMERIC, description: "Asset id" },
    { property: "Label", type: STRING, description: "The asset's name" },
    { property: "Type", type: FILE_TYPE, description: "Asset type, by name (File, Folder...) or id (File 2, Folder 4)" },
    { property: "FolderId", type: NUMERIC, description: "Id of the folder containing the asset" },
    { property: "BranchId", type: NUMERIC, description: "Id of the master asset of the asset's branch family" },
    { property: "ShortcutId", type: NUMERIC, description: "Id of the asset a shortcut points at" },
    { property: "Size", type: NUMERIC, description: "Size" },
    { property: "Status", type: STATUS, description: "Workflow status, by status id" },
    { property: "StatusText", type: STATUS, description: "Workflow status, by status id (the UI's text-labelled variant of Status)" },
    { property: "Workflow", type: WORKFLOW, description: "Workflow, by workflow id (list_workflows)" },
    { property: "TemplateID", type: NUMERIC, description: "Template id" },
    { property: "TemplateName", type: TEMPLATE, description: "Template, by template id (a find_asset or read_full_asset record's template_id)" },
    { property: "Model", type: MODEL, description: "Model, by model asset id" },
    { property: "CreatedFromModel", type: BASE_MODEL, description: "Base model the asset was created from, by asset id" },
    { property: "CreateDate", type: DATE, description: "When the asset was created" },
    { property: "ModifiedDate", type: DATE, description: "When the asset was last modified" },
    { property: "ChangeDate", type: DATE, description: "When the asset was last changed" },
    { property: "StatusDate", type: DATE, description: "When the asset's status last changed" },
    { property: "PublishDate", type: DATE, description: "When the asset was last published" },
    { property: "CheckedOutDate", type: DATE, description: "When the asset was checked out" },
    { property: "CreatedBy", type: USER, description: "User who created the asset, by user id (list_users)" },
    { property: "ModifiedBy", type: USER, description: "User who last modified the asset, by user id" },
    { property: "ChangedBy", type: USER, description: "User who last changed the asset, by user id" },
    { property: "CheckedOutBy", type: USER, description: "User who has the asset checked out, by user id" },
    { property: "LastPublishedBy", type: USER, description: "User who last published the asset, by user id" },
    { property: "LastStatusBy", type: USER, description: "User who last changed the asset's status, by user id" }
];
const FIELD_BY_LOWER = new Map(SEARCH_FIELDS.map(f => [f.property.toLowerCase(), f]));

// Operators per type, from the CMS UI's comparison table; the wire names are the CMS's
// Comparison enum (the UI's "ContainsWord" is Contains, its "IsNotNull" is NotNull). The CMS
// rejects an operator its type doesn't support ("The binary operator GreaterThan is not defined
// for the types 'System.String'"), so these are checked before sending. The UI offers
// IsNull/NotNull for text only, but the CMS also takes them on dates, users and models (checked
// live: CheckedOutDate, PublishDate, CheckedOutBy, Model). It takes them on Status, Workflow and
// TemplateName too, but those are never null (0 means none), so IsNull matches nothing there
// and they're left off.
const OPERATORS_BY_TYPE = {
    [STRING]: ["Contains", "NotContains", "StartsWith", "EndsWith", "Equals", "NotEquals", "IsNull", "NotNull"],
    [CUSTOM]: ["Contains", "StartsWith", "EndsWith", "Equals", "NotEquals", "IsNull", "NotNull"],
    [NUMERIC]: ["GreaterThan", "GreaterOrEquals", "LessThan", "LessOrEquals", "Equals", "NotEquals"],
    [DATE]: ["GreaterThan", "GreaterOrEquals", "LessThan", "LessOrEquals", "Equals", "NotEquals", "IsNull", "NotNull"],
    [USER]: ["Equals", "NotEquals", "IsNull", "NotNull"],
    [MODEL]: ["Equals", "NotEquals", "IsNull", "NotNull"]
};
const LIST_OPERATORS = ["Equals", "NotEquals"];
export const SEARCH_OPERATIONS = ["Equals", "NotEquals", "Contains", "NotContains", "StartsWith", "EndsWith", "GreaterThan", "GreaterOrEquals", "LessThan", "LessOrEquals", "IsNull", "NotNull"];
const NO_VALUE_OPERATIONS = new Set(["IsNull", "NotNull"]);
const operatorsFor = type => OPERATORS_BY_TYPE[type] ?? LIST_OPERATORS;

// "2012-05-01" or "2012-05-01T00:00:00Z": both were accepted live.
const DATE_VALUE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function checkResponse(response, context) {
    // The helper doesn't throw when the CMS refuses a call; it hands back the failure.
    if (response?.isSuccessful === false || (response?.resultCode && response.resultCode !== "conWS_Success")) {
        throw new Error(`${context}: ${response.errorMessage || response.resultCode}`);
    }
    return response;
}

function checkInt(value, name, min, max) {
    if (!Number.isInteger(value) || value < min || (max !== undefined && value > max)) {
        throw new Error(`${name} must be a whole number from ${min}${max !== undefined ? ` to ${max}` : " up"}.`);
    }
}

// ------------------------------------------------------------------ simple search

// /Asset/Search: text in the label (and, if asked, in field content), 1-based pages, optionally
// sorted. Verified live on CPUK. Page 0 is not page 1 (it returns different rows), an empty
// query returns nothing, and content search is ~5x slower than label search (9.5s vs 1.7s).
// Unlike the advanced search it reports no total (the records' totalCount is absent), so the
// result says only how many rows this page has and whether a full page suggests there are more.
export async function search(dxm, { query, page = 1, pageSize = SEARCH_DEFAULT_PAGE_SIZE, sort, descending = false, includeContent = false } = {}) {
    if (typeof query !== "string" || !query.trim()) throw new Error("query must be the text to search for.");
    checkInt(page, "page", 1);
    checkInt(pageSize, "pageSize", 1, SEARCH_MAX_PAGE_SIZE);
    if (sort !== undefined && !(sort in SEARCH_SORT)) {
        throw new Error(`Unknown sort "${sort}". Use one of: ${Object.keys(SEARCH_SORT).join(", ")}.`);
    }
    await dxm._ensureLoggedIn();
    const cms = dxm._cms;
    const response = checkResponse(await cms.Util.makeCall(cms, SEARCH_PATH, {
        query: query.trim(),
        currentPage: page,
        pageSize,
        sortColumn: sort === undefined ? 0 : SEARCH_SORT[sort],
        orderType: descending ? ORDER_DESCENDING : ORDER_ASCENDING,
        includeContentFields: !!includeContent
    }), "Search failed");
    const assets = response.assets ?? [];
    return {
        page,
        pageSize,
        count: assets.length,
        mayHaveMore: assets.length === pageSize,
        results: assets.map(a => mapAsset(cms, a))
    };
}

// ------------------------------------------------------------------ advanced search fields

// The custom (template-defined) field names the advanced search can filter on, as [{ name, isList }];
// isList marks a multi-valued field (what a panel holds).
// The CMS fixes them per instance, so they're fetched once and kept on the Dxm instance, keyed by
// server and instance like the audit action list (see auditActions). A failed fetch isn't kept.
async function customFieldList(dxm) {
    await dxm._ensureLoggedIn();
    const cms = dxm._cms;
    const key = `${cms.host}/${cms.instance}`;
    if (dxm._searchFieldsCache?.key !== key) {
        const promise = (async () => {
            const response = checkResponse(
                await cms.Util.makeCall(cms, ADVANCED_FIELDS_PATH, { UseAutoCompleteSearch: false, Query: "" }),
                "Could not read the search fields");
            return (Array.isArray(response.searchFields) ? response.searchFields : [])
                .filter(f => f?.name)
                .map(f => ({ name: f.name, isList: !!f.isList }));
        })();
        dxm._searchFieldsCache = { key, promise };
        promise.catch(() => { if (dxm._searchFieldsCache?.promise === promise) dxm._searchFieldsCache = null; });
    }
    return dxm._searchFieldsCache.promise;
}

// What advanced_search can filter on: the built-in fields (with their types and the operators each
// takes) and the instance's custom fields. `search` keeps only names containing that text.
export async function searchFields(dxm, { search: text } = {}) {
    const custom = await customFieldList(dxm);
    const wanted = typeof text === "string" && text.trim() ? text.trim().toLowerCase() : null;
    const keep = name => !wanted || name.toLowerCase().includes(wanted);
    return {
        builtIn: SEARCH_FIELDS.filter(f => keep(f.property)).map(f => ({
            field: f.property, type: f.type, operators: operatorsFor(f.type), description: f.description
        })),
        custom: custom.filter(f => keep(f.name)),
        customOperators: OPERATORS_BY_TYPE[CUSTOM]
    };
}

// ------------------------------------------------------------------ advanced search

// A filter's field as a built-in or a custom field. "[Label]" always means the built-in. An exact
// built-in name (Label) is the built-in without a lookup; anything else is checked against the
// instance's custom fields first, so a custom field called "label" is still reachable. Unknown
// names are refused because the CMS answers a filter on a field that doesn't exist with zero
// rows and no error, which reads as "nothing matches".
async function resolveField(dxm, raw) {
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) throw new Error("Each filter needs a field.");
    const bracketed = /^\[(.+)\]$/.exec(text);
    if (bracketed) {
        const def = FIELD_BY_LOWER.get(bracketed[1].trim().toLowerCase());
        if (!def) throw new Error(`No built-in search field is called "${text}". Built-in fields: ${SEARCH_FIELDS.map(f => f.property).join(", ")}.`);
        return { builtIn: def };
    }
    const exactBuiltIn = SEARCH_FIELDS.find(f => f.property === text);
    if (exactBuiltIn) return { builtIn: exactBuiltIn };

    const custom = await customFieldList(dxm);
    const lower = text.toLowerCase();
    const exact = custom.find(f => f.name === text);
    if (exact) return { custom: exact.name };
    if (FIELD_BY_LOWER.has(lower)) return { builtIn: FIELD_BY_LOWER.get(lower) };
    const loose = custom.filter(f => f.name.toLowerCase() === lower);
    if (loose.length === 1) return { custom: loose[0].name };
    if (loose.length > 1) throw new Error(`"${text}" matches several custom fields: ${loose.map(f => f.name).join(", ")}. Use the exact name.`);

    const near = custom
        .filter(f => f.name.toLowerCase().includes(lower) || (f.name.length >= 4 && lower.includes(f.name.toLowerCase())))
        .slice(0, 10).map(f => f.name);
    throw new Error(
        `No search field is called "${text}". ` +
        (near.length ? `Similar custom fields: ${near.join(", ")}. ` : "") +
        `Built-in fields: ${SEARCH_FIELDS.map(f => f.property).join(", ")}. The search_fields tool lists all of them.`);
}

// The value of a list-type field is an id; Type also accepts the asset type's name.
function listValue(cms, def, value) {
    if (def.type === FILE_TYPE && typeof value === "string" && !/^\s*-?\d+\s*$/.test(value)) {
        const types = cms.Util.AssetType;
        const name = Object.keys(types).find(k => k.toLowerCase() === value.trim().toLowerCase());
        if (name === undefined) throw new Error(`Unknown asset type "${value}". Use one of: ${Object.keys(types).join(", ")}, or its id.`);
        return types[name];
    }
    const n = typeof value === "number" ? value : Number(String(value).trim());
    if (!Number.isInteger(n)) throw new Error(`${def.property} takes an id (a whole number), not "${value}". ${def.description}.`);
    return n;
}

// One validated condition, without its orderId and `logical`, which depend on where it ends up in
// the request. `filter.value` is a single value here (see expandSets for lists of them).
async function buildCondition(dxm, filter) {
    const cms = dxm._cms;
    const resolved = await resolveField(dxm, filter?.field);
    const def = resolved.builtIn;
    const type = def ? def.type : CUSTOM;
    const label = def ? def.property : resolved.custom;
    const operation = filter.operation;
    if (!SEARCH_OPERATIONS.includes(operation)) {
        throw new Error(`Unknown operation "${operation}". Use one of: ${SEARCH_OPERATIONS.join(", ")}.`);
    }
    const allowed = operatorsFor(type);
    if (!allowed.includes(operation)) {
        throw new Error(`${label} is a ${type} field and doesn't support ${operation}. It takes: ${allowed.join(", ")}.`);
    }

    const expression = {
        filterId: 0,
        name: def ? `[${def.property}]` : resolved.custom,
        operation
    };
    // Custom fields send no propertyName.
    if (def) expression.propertyName = def.property;

    if (NO_VALUE_OPERATIONS.has(operation)) return expression;

    const value = filter.value;
    if (value === undefined || value === null || String(value).trim() === "") {
        throw new Error(`${label} ${operation} needs a value.`);
    }
    if (LIST_TYPES.has(type)) {
        expression.valueDropDown = listValue(cms, def, value);
    } else if (type === NUMERIC) {
        const n = Number(String(value).trim());
        if (!Number.isFinite(n)) throw new Error(`${label} takes a number, not "${value}".`);
        expression.value = String(n);
    } else if (type === DATE) {
        const text = String(value).trim();
        if (!DATE_VALUE.test(text)) throw new Error(`${label} takes a date as YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ, not "${value}".`);
        expression.value = text;
    } else {
        expression.value = String(value);
    }
    return expression;
}

// The CMS has IsInSet / NotInSet operations but doesn't implement them: every field type and
// value shape tried (comma lists, JSON, valueDropDown) fails with a bare "IsInSet" error. A list
// of values on Equals / NotEquals is therefore expanded here into conditions it does implement.
//   NotEquals [a, b]  ->  field != a And field != b. Plain And pieces, so they sit in the filter list
//                         wherever it was and keep its own `logical` on the last piece.
//   Equals [a, b]     ->  field = a Or field = b. The CMS has no brackets and And binds tighter
//                         than Or, so inside a larger filter list this can't just be inserted:
//                         "A Or B And D" means A Or (B And D). Instead the list is distributed
//                         over the other filters, (A Or B) And D -> (A And D) Or (B And D), as a
//                         group per combination. That is only valid when every filter is joined
//                         by And, so lists on Equals can't be combined with "Or" joins.
export const ADVANCED_SEARCH_MAX_SET_VALUES = 20;
export const ADVANCED_SEARCH_MAX_EXPRESSIONS = 60;

async function buildFilterExpressions(dxm, filters) {
    // pieces: one per condition in the ordinary case; `alternatives` holds an Equals list's choices.
    const pieces = [];
    for (const [i, filter] of filters.entries()) {
        const join = filter.logical ?? "And";
        if (!Array.isArray(filter.value)) {
            pieces.push({ alternatives: [await buildCondition(dxm, filter)], join });
            continue;
        }
        const label = typeof filter.field === "string" ? filter.field : `filter ${i + 1}`;
        if (filter.operation !== "Equals" && filter.operation !== "NotEquals") {
            throw new Error(`A list of values works with Equals (matches any of them) or NotEquals (matches none of them), not ${filter.operation}. ${label} was given ${filter.value.length} values.`);
        }
        if (filter.value.length === 0) throw new Error(`${label}: the list of values is empty.`);
        if (filter.value.length > ADVANCED_SEARCH_MAX_SET_VALUES) throw new Error(`${label}: at most ${ADVANCED_SEARCH_MAX_SET_VALUES} values in a list.`);
        const conditions = [];
        for (const value of filter.value) conditions.push(await buildCondition(dxm, { ...filter, value }));
        if (filter.operation === "Equals") {
            pieces.push({ alternatives: conditions, join, isSet: true });
        } else {
            conditions.forEach((c, k) => pieces.push({ alternatives: [c], join: k < conditions.length - 1 ? "And" : join }));
        }
    }

    const isLastGroup = (g, groups) => g === groups.length - 1;
    const emit = groups => {
        // Each group is an And of conditions; groups are joined by Or. `logical` is how an expression
        // joins the NEXT one, so the last of the whole request is NotSet.
        const out = [];
        groups.forEach((group, g) => group.forEach((condition, c) => {
            const last = c === group.length - 1;
            out.push({ ...condition, logical: !last ? "And" : isLastGroup(g, groups) ? "NotSet" : "Or", orderId: out.length + 1 });
        }));
        return out;
    };

    if (!pieces.some(p => p.isSet)) {
        // No Equals list: one expression per piece, joined as the caller asked.
        return pieces.map((p, i) => ({ ...p.alternatives[0], logical: i === pieces.length - 1 ? "NotSet" : p.join, orderId: i + 1 }));
    }

    // Equals list(s): distribute over the other conditions (see above).
    if (pieces.some((p, i) => i < pieces.length - 1 && p.join === "Or")) {
        throw new Error("A list of values on Equals can't be combined with an \"Or\" between filters, because the CMS has no brackets to say which part the Or applies to. Use only And, or write the alternatives as separate Equals filters joined by Or.");
    }
    let groups = [[]];
    for (const piece of pieces) {
        groups = groups.flatMap(group => piece.alternatives.map(condition => [...group, condition]));
        if (groups.length * pieces.length > ADVANCED_SEARCH_MAX_EXPRESSIONS) {
            throw new Error(`The lists of values expand to more than ${ADVANCED_SEARCH_MAX_EXPRESSIONS} conditions. Use shorter lists or fewer of them.`);
        }
    }
    return emit(groups);
}

// A LightAsset (what responseType LightAsset returns) is { label, id, folderId, statusId, type,
// workflowId, parentPath } - plus a lot of null settings fields that are dropped here. parentPath
// is the asset's own full path (verified: "/AdventGeneral/Assets/images/home02.jpg" for home02.jpg).
function mapLightAsset(cms, a) {
    const typeNames = Object.fromEntries(Object.entries(cms.Util.AssetType).map(([k, v]) => [v, k]));
    return {
        id: a.id,
        label: a.label,
        type: typeNames[a.type] ?? a.type,
        fullPath: a.parentPath,
        folder_id: a.folderId,
        statusId: a.statusId,
        workflow_id: a.workflowId
    };
}

// /Asset/AdvancedSearch. `filters` is a list of { field, operation, value, logical }; `logical`
// ("And" by default, or "Or") joins that filter to the next one, and the last one's is ignored.
// Mixing the two follows the usual precedence, And before Or (checked live: A Or B And C matched
// A and also B-and-C, where left to right would have matched only B-and-C). Results are in no order the
// CMS lets us control: sortOrder is accepted but never changed the order in any form tried.
// pageNumber is 1-based (0 repeats page 1). baseAssetId limits the search to a folder's
// subtree (verified: a folder with 3 matching assets under it returned 3, an unrelated folder 0).
export async function advancedSearch(dxm, { filters, baseAssetId = 0, page = 1, pageSize = SEARCH_DEFAULT_PAGE_SIZE, limit = ADVANCED_SEARCH_DEFAULT_LIMIT, light = false } = {}) {
    if (!Array.isArray(filters) || filters.length === 0) throw new Error("filters must be a list of at least one filter.");
    if (filters.length > ADVANCED_SEARCH_MAX_FILTERS) throw new Error(`At most ${ADVANCED_SEARCH_MAX_FILTERS} filters are allowed.`);
    checkInt(page, "page", 1);
    checkInt(pageSize, "pageSize", 1, SEARCH_MAX_PAGE_SIZE);
    checkInt(limit, "limit", 1, ADVANCED_SEARCH_MAX_LIMIT);
    checkInt(baseAssetId, "baseAssetId", 0);

    for (const filter of filters) {
        if (filter?.logical !== undefined && filter.logical !== "And" && filter.logical !== "Or") {
            throw new Error(`logical must be "And" or "Or", not "${filter.logical}".`);
        }
    }

    await dxm._ensureLoggedIn();
    const cms = dxm._cms;
    const filterExpressions = await buildFilterExpressions(dxm, filters);
    const response = checkResponse(await cms.Util.makeCall(cms, ADVANCED_SEARCH_PATH, {
        limit,
        filterExpressions,
        sortOrder: null,
        baseAssetId,
        additionalBuiltInFields: null,
        responseType: light ? "LightAsset" : "WorklistAsset",
        pageNumber: page,
        pageSize
    }), "Advanced search failed");

    const rows = light
        ? (response.lightSearchResults ?? []).map(a => mapLightAsset(cms, a))
        : (response.searchResults ?? []).map(a => mapAsset(cms, a));
    const total = response.total ?? rows.length;
    return { total, limit, limitReached: total >= limit, page, pageSize, results: rows };
}
