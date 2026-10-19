import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { publishingErrors, siteSummary, auditReport, customAuditReport, auditActions, resolveAuditAction, assetPublishHistory, AUDIT_REPORT_PATH, AUDIT_ACTIONS_PATH, ASSET_PUBLISH_HISTORY_PATH } from "../dxm/report.js";
import { registerReadTools } from "../dxm/tools/report.js";
import { makeFakeCms, makeFakeDxm } from "./_helpers.js";

describe("publishingErrors", () => {
    test("delegates to Report.publishingErrors", async () => {
        const response = { assetList: [
            { id: 1, label: "A", type: 2, fullPath: "/A", statusName: "Live", folder_id: 9, branchId: 1, error_msg: "Error 1" },
            { id: 2, label: "B", type: 4, fullPath: "/B", statusName: "Live", folder_id: 9, branchId: -2, error_msg: "Error 2" }
        ] };
        const expected = [
            { id: 1, label: "A", type: "File", fullPath: "/A", status: "Live", folder_id: 9, branchId: 1, error_msg: "Error 1" },
            { id: 2, label: "B", type: "Folder", fullPath: "/B", status: "Live", folder_id: 9, branchId: -2, error_msg: "Error 2" }
        ];
        const cms = makeFakeCms({
            Report: { publishingErrors: async () => response }
        });
        const result = await publishingErrors(makeFakeDxm(cms));
        assert.deepEqual(result, expected);
    });

    test("calls _ensureLoggedIn before the request", async () => {
        const response = { assetList: [
            { id: 1, label: "A", type: 2, fullPath: "/A", statusName: "Live", folder_id: 9, error_msg: "Error 1" },
            { id: 2, label: "B", type: 4, fullPath: "/B", statusName: "Live", folder_id: 9, error_msg: "Error 2" }
        ] };
        const cms = makeFakeCms({
            Report: { publishingErrors: async () => response }
        });
        const dxm = makeFakeDxm(cms);
        await publishingErrors(dxm);
        assert.equal(dxm.ensureLoginCalls, 1);
    });
});

describe("siteSummary", () => {
    test("delegates to Report.siteSummary", async () => {
        const cms = makeFakeCms({
            Report: { siteSummary: async () => ({ resultCode: "conWS_Success", errorMessage: "", internalCode: 0, responseValues: null, cookie: ["AWSALB=secret; Path=/"], isSuccessful: true, reportData: { totalAssets: 1234 } }) }
        });
        const result = await siteSummary(makeFakeDxm(cms));
        assert.deepEqual(result, { reportData: { totalAssets: 1234 } }, "data only: no cookie, no envelope");
    });

    test("calls _ensureLoggedIn before the request", async () => {
        const cms = makeFakeCms({
            Report: { siteSummary: async () => ({}) }
        });
        const dxm = makeFakeDxm(cms);
        await siteSummary(dxm);
        assert.equal(dxm.ensureLoginCalls, 1);
    });
});

describe("audit reports", () => {
    // Rows as the CMS returned them live on CPUK. Note the row's own action text ("custom") differs
    // from the action list's name ("Custom").
    const LOGIN = { action: "Logged In", actionId: 16, assetIsDeleted: false, assetType: null, description: "Logged in from 10.0.0.1 using api/Access", extra: null, folderId: 0, assetId: -1, date: "2026-10-19T08:29:51.301Z", label: "N/A", user: "Richard Lund", userId: 102, isContentLoader: false, dataFilters: null, dateString: null };
    const CUSTOM = { action: "custom", actionId: 100, assetIsDeleted: false, assetType: 2, description: "Point 2", extra: null, folderId: 0, assetId: 384069, date: "2026-10-06T10:46:13.828Z", label: "_FirstSpirit Settings", user: "Richard Lund", userId: 102, isContentLoader: false, dataFilters: null, dateString: null };
    const ENVELOPE = { resultCode: "conWS_Success", errorMessage: "", internalCode: 0, responseValues: null, cookie: ["AWSALB=COOKIE-SECRET"], isSuccessful: true };
    // A slice of the live /Report/auditactions list.
    const ACTIONS = [
        { id: 0, name: "--Any--" }, { id: 16, name: "Logged In" }, { id: 138, name: "Login Failed" }, { id: 118, name: "Logged Out" },
        { id: 25, name: "Deleted File" }, { id: 26, name: "Deleted Folder" }, { id: 100, name: "Custom" }, { id: 72, name: "Audited System" }
    ];

    function fake({ rows = [LOGIN], total = 4204, actions = () => ({ ...ENVELOPE, actions: ACTIONS }), host = "cms.example.net", instance = "INST" } = {}) {
        const calls = [];
        const cms = makeFakeCms({
            Util: {
                makeCall: async (c, path, body) => {
                    calls.push({ path, body });
                    if (path === AUDIT_ACTIONS_PATH) return actions();
                    return { ...ENVELOPE, responseData: rows, total };
                }
            }
        });
        cms.host = host;
        cms.instance = instance;
        const dxm = makeFakeDxm(cms);
        return { calls, dxm, cms, reports: () => calls.filter(c => c.path === AUDIT_REPORT_PATH), lookups: () => calls.filter(c => c.path === AUDIT_ACTIONS_PATH) };
    }

    test("always sends sortOptions (the CMS errors without it), 1-based page and newest first by default", async () => {
        const f = fake();
        await auditReport(f.dxm);
        assert.deepEqual(f.reports(), [{ path: "/Report/auditsystemreport", body: { actionId: 0, currentPage: 1, pageSize: 50, sortOptions: { sortOption: "Date", isAscending: false } } }]);
    });

    test("passes every filter through under the CMS's names", async () => {
        const f = fake();
        await customAuditReport(f.dxm, { startDate: "2026-05-01", endDate: "2026-06-01", userId: 102, assetId: 384069, label: "_FirstSpirit Settings", search: "Point", page: 3, pageSize: 10, oldestFirst: true });
        assert.deepEqual(f.reports()[0].body, {
            actionId: 100, currentPage: 3, pageSize: 10, sortOptions: { sortOption: "Date", isAscending: true },
            startDate: "2026-05-01", endDate: "2026-06-01", userId: 102, assetId: 384069, label: "_FirstSpirit Settings", searchTerm: "Point"
        });
    });

    test("allow-lists each entry, names its action and asset type, and nulls 'no asset' ids", async () => {
        const f = fake({ rows: [LOGIN, CUSTOM] });
        f.cms.Util.AssetType = { File: 2, Folder: 4 };
        const result = await customAuditReport(f.dxm, { pageSize: 2 });
        assert.deepEqual(result, {
            total: 4204, page: 1, pageSize: 2,
            entries: [
                { date: "2026-10-19T08:29:51.301Z", action: "Logged In", actionId: 16, description: "Logged in from 10.0.0.1 using api/Access", extra: null, user: "Richard Lund", userId: 102, assetId: null, label: "N/A", folderId: null, assetType: null, assetIsDeleted: false, isContentLoader: false },
                { date: "2026-10-06T10:46:13.828Z", action: "Custom", actionId: 100, description: "Point 2", extra: null, user: "Richard Lund", userId: 102, assetId: 384069, label: "_FirstSpirit Settings", folderId: null, assetType: "File", assetIsDeleted: false, isContentLoader: false }
            ]
        });
        assert.doesNotMatch(JSON.stringify(result), /SECRET|dataFilters|dateString/);
    });

    test("keeps the CMS's own action text when the action list can't be read", async () => {
        const f = fake({ rows: [CUSTOM], actions: () => ({ resultCode: "conWS_GeneralError", errorMessage: "boom", isSuccessful: false }) });
        const { entries } = await customAuditReport(f.dxm);
        assert.equal(entries[0].action, "custom");
    });

    describe("action by name or id", () => {
        test("a name resolves case-insensitively, and the result says which action it was", async () => {
            const f = fake();
            const result = await auditReport(f.dxm, { action: "login failed" });
            assert.equal(f.reports()[0].body.actionId, 138);
            assert.deepEqual(result.action, { id: 138, name: "Login Failed" });
        });

        test("a unique part of a name is enough", async () => {
            const f = fake();
            assert.deepEqual(await resolveAuditAction(f.dxm, "deleted file"), { id: 25, name: "Deleted File" });
            assert.deepEqual(await resolveAuditAction(f.dxm, "Audited"), { id: 72, name: "Audited System" });
        });

        test("an exact name wins over longer names containing it", async () => {
            const f = fake();
            assert.deepEqual(await resolveAuditAction(f.dxm, "Logged In"), { id: 16, name: "Logged In" });
        });

        test("an ambiguous name lists the candidates; an unknown one says so", async () => {
            const f = fake();
            await assert.rejects(() => auditReport(f.dxm, { action: "deleted" }), /"deleted" matches several audit actions: 25 Deleted File, 26 Deleted Folder\. Use the full name or the id\./);
            await assert.rejects(() => auditReport(f.dxm, { action: "Teleported" }), /No audit action is called "Teleported"/);
            assert.equal(f.reports().length, 0);
        });

        test("an id works as a number or a numeric string, and must exist", async () => {
            const f = fake();
            assert.deepEqual((await auditReport(f.dxm, { action: 16 })).action, { id: 16, name: "Logged In" });
            assert.deepEqual((await auditReport(f.dxm, { action: "138" })).action, { id: 138, name: "Login Failed" });
            await assert.rejects(() => auditReport(f.dxm, { action: 9999 }), /Unknown audit action id 9999/);
        });

        test("no action, or 0, is everything except Custom", async () => {
            const f = fake({ rows: [] });
            for (const action of [undefined, 0, "0", ""]) {
                const result = await auditReport(f.dxm, { action });
                assert.equal(result.action, undefined);
            }
            assert.deepEqual(f.reports().map(c => c.body.actionId), [0, 0, 0, 0]);
        });

        test("Custom is refused, by name or id, pointing at custom_audit_report", async () => {
            const f = fake();
            for (const action of [100, "Custom", "custom"]) {
                await assert.rejects(() => auditReport(f.dxm, { action }), /custom_audit_report/);
            }
            assert.equal(f.reports().length, 0);
        });
    });

    describe("action list cache", () => {
        test("is fetched once per instance, however many reports run", async () => {
            const f = fake();
            await auditReport(f.dxm, { action: "Logged In" });
            await auditReport(f.dxm, { action: 138 });
            await customAuditReport(f.dxm);
            assert.equal(f.lookups().length, 1);
            assert.deepEqual(f.lookups()[0].body, {});
        });

        test("concurrent first calls share one fetch", async () => {
            const f = fake();
            await Promise.all([auditActions(f.dxm), auditActions(f.dxm), auditReport(f.dxm, { action: 16 })]);
            assert.equal(f.lookups().length, 1);
        });

        test("is fetched again for a different CMS instance", async () => {
            const f = fake();
            await auditActions(f.dxm);
            f.cms.instance = "OTHER";
            await auditActions(f.dxm);
            assert.equal(f.lookups().length, 2);
        });

        test("a failed fetch is not kept", async () => {
            let fail = true;
            const f = fake({ actions: () => (fail ? { resultCode: "conWS_GeneralError", errorMessage: "boom", isSuccessful: false } : { ...ENVELOPE, actions: ACTIONS }) });
            await assert.rejects(() => auditActions(f.dxm), /Could not read the audit actions: boom/);
            fail = false;
            assert.equal((await auditActions(f.dxm)).get(16), "Logged In");
            assert.equal(f.lookups().length, 2);
        });
    });

    test("rejects a time of day, page 0 and oversized pages before calling the CMS", async () => {
        const f = fake();
        await assert.rejects(() => auditReport(f.dxm, { endDate: "2026-10-18T08:00:00Z" }), /endDate must be a date as YYYY-MM-DD/);
        await assert.rejects(() => customAuditReport(f.dxm, { page: 0 }), /pages are 1-based/);
        await assert.rejects(() => auditReport(f.dxm, { pageSize: 501 }), /between 1 and 500/);
        assert.equal(f.calls.length, 0);
        assert.equal(f.dxm.ensureLoginCalls, 0);
    });

    test("throws the CMS's message on failure, e.g. the null-reference it gives without sortOptions", async () => {
        const cms = makeFakeCms({ Util: { makeCall: async () => ({ resultCode: "conWS_GeneralError", errorMessage: "Object reference not set to an instance of an object.", isSuccessful: false, total: 0 }) } });
        await assert.rejects(() => customAuditReport(makeFakeDxm(cms)), /Could not read the audit report: Object reference not set/);
    });
});

describe("audit_report / custom_audit_report tools", () => {
    function register() {
        const handlers = new Map(), calls = [];
        const dxm = {
            auditReport: async args => { calls.push({ tool: "audit", ...args }); return { total: 0, page: 1, pageSize: 50, entries: [] }; },
            customAuditReport: async args => { calls.push({ tool: "custom", ...args }); return { total: 0, page: 1, pageSize: 50, entries: [] }; }
        };
        registerReadTools({ tool: (name, ...rest) => handlers.set(name, rest.at(-1)) }, dxm);
        return { handlers, calls };
    }

    test("audit_report passes the action, by name or id, with the filters", async () => {
        const { handlers, calls } = register();
        await handlers.get("audit_report")({ action: "Login Failed", start_date: "2026-10-01", user_id: 102 });
        await handlers.get("audit_report")({ action: 16 });
        assert.equal(calls[0].tool, "audit");
        assert.equal(calls[0].action, "Login Failed");
        assert.equal(calls[0].startDate, "2026-10-01");
        assert.equal(calls[0].userId, 102);
        assert.equal(calls[1].action, 16);
    });

    test("custom_audit_report goes to customAuditReport with the filters", async () => {
        const { handlers, calls } = register();
        await handlers.get("custom_audit_report")({ asset_id: 384069, search: "Point", page: 2, page_size: 10, oldest_first: true });
        assert.deepEqual(calls[0], { tool: "custom", startDate: undefined, endDate: undefined, userId: undefined, assetId: 384069, label: undefined, search: "Point", page: 2, pageSize: 10, oldestFirst: true });
    });
});

describe("assetPublishHistory", () => {
    // Rows as the CMS returned them live on CPUK for asset 384206 (out of date order, as live).
    const row = over => ({
        action: "HTML file(2)", duration: 1, endDate: "2026-10-15T13:10:54.07Z", errorText: "",
        filename: "/wwwroot-demo/cpuk/stage/richard-lund/surety-test-2021-10-22/test.aspx", packageName: "Stage Site",
        pubHostName: "USE1-CMS-PUB-1", reason: "Queue workflow command without dependencies(148)", sessionId: 124990, subReason: "",
        transferSize: 15, assetId: 384206, date: "2026-10-15T13:10:53.07Z", label: null, user: null, userId: 0,
        connectorId: 35, connectorName: "Server W1", ...over
    });
    const ERROR = row({ action: "Template Error(7)", duration: 0, errorText: "error CS0246: The type or namespace name 'Surety_Test_2021_10_22' could not be found", filename: "/Richard Lund/Surety Test 2021-10-22/Test", sessionId: 124988, transferSize: 0, date: "2026-10-15T13:08:25.325Z", endDate: "2026-10-15T13:08:25.325Z", pubHostName: "USE1-CMS-PUB-7" });
    const LATER = row({ sessionId: 124994, date: "2026-10-15T13:25:16.449Z", reason: "Queue workflow command(138)" });
    const W2 = row({ connectorId: 36, connectorName: "Server W2" });
    const ENVELOPE = { resultCode: "conWS_Success", errorMessage: "", internalCode: 0, responseValues: null, cookie: ["AWSALB=COOKIE-SECRET"], isSuccessful: true };
    function fake(history = [ERROR, row(), LATER, W2]) {
        const calls = [];
        const cms = makeFakeCms({ Util: { makeCall: async (c, path, body) => { calls.push({ path, body }); return { ...ENVELOPE, history, total: 0 }; } } });
        return { calls, dxm: makeFakeDxm(cms) };
    }

    test("posts only the filters given", async () => {
        const f = fake();
        await assetPublishHistory(f.dxm, { assetId: 384206 });
        await assetPublishHistory(f.dxm, { sessionId: 124990, fileName: "test.aspx" });
        assert.deepEqual(f.calls, [
            { path: "/Report/asset-publish-history-all", body: { assetId: 384206 } },
            { path: ASSET_PUBLISH_HISTORY_PATH, body: { sessionId: 124990, fileName: "test.aspx" } }
        ]);
    });

    test("allow-lists each row, sorts newest first, and keeps one row per connector", async () => {
        const result = await assetPublishHistory(fake().dxm, { assetId: 384206 });
        assert.equal(result.total, 4);
        assert.equal(result.truncated, false);
        assert.deepEqual(result.history.map(h => `${h.sessionId}/${h.connectorName}`), ["124994/Server W1", "124990/Server W1", "124990/Server W2", "124988/Server W1"]);
        assert.deepEqual(result.history[1], {
            date: "2026-10-15T13:10:53.07Z", endDate: "2026-10-15T13:10:54.07Z", durationSeconds: 1, sessionId: 124990, assetId: 384206,
            action: "HTML file(2)", reason: "Queue workflow command without dependencies(148)", subReason: null, errorText: null,
            filename: "/wwwroot-demo/cpuk/stage/richard-lund/surety-test-2021-10-22/test.aspx", packageName: "Stage Site",
            connectorId: 35, connectorName: "Server W1", transferSize: 15, publisher: "USE1-CMS-PUB-1", label: null, user: null, userId: null
        });
        assert.match(result.history[3].errorText, /CS0246/);
        assert.doesNotMatch(JSON.stringify(result), /SECRET/);
    });

    test("oldest_first reverses the order; limit caps it and says so", async () => {
        const f = fake();
        assert.equal((await assetPublishHistory(f.dxm, { assetId: 1, oldestFirst: true })).history[0].sessionId, 124988);
        const capped = await assetPublishHistory(f.dxm, { assetId: 1, limit: 2 });
        assert.deepEqual([capped.total, capped.returned, capped.truncated, capped.history.length], [4, 2, true, 2]);
    });

    test("needs a filter, and a sane limit, before calling the CMS", async () => {
        const f = fake();
        await assert.rejects(() => assetPublishHistory(f.dxm, {}), /at least one of assetId, sessionId or fileName/);
        await assert.rejects(() => assetPublishHistory(f.dxm, { fileName: "" }), /at least one of/);
        await assert.rejects(() => assetPublishHistory(f.dxm, { assetId: 1, limit: 1001 }), /between 1 and 1000/);
        assert.equal(f.calls.length, 0);
        assert.equal(f.dxm.ensureLoginCalls, 0);
    });

    test("an asset with no history (history: [] or null) is empty, not an error", async () => {
        for (const history of [[], null]) {
            assert.deepEqual(await assetPublishHistory(fake(history).dxm, { assetId: 999999999 }), { total: 0, returned: 0, truncated: false, history: [] });
        }
    });

    test("throws the CMS's message on failure", async () => {
        const cms = makeFakeCms({ Util: { makeCall: async () => ({ resultCode: "conWS_GeneralError", errorMessage: "boom", isSuccessful: false }) } });
        await assert.rejects(() => assetPublishHistory(makeFakeDxm(cms), { assetId: 1 }), /Could not read the asset publish history: boom/);
    });

    test("the tool maps its arguments", async () => {
        const handlers = new Map(), calls = [];
        registerReadTools({ tool: (name, ...rest) => handlers.set(name, rest.at(-1)) }, { assetPublishHistory: async a => { calls.push(a); return {}; } });
        await handlers.get("asset_publish_history")({ asset_id: 384206, session_id: 124990, file_name: "test", limit: 5, oldest_first: true });
        assert.deepEqual(calls, [{ assetId: 384206, sessionId: 124990, fileName: "test", limit: 5, oldestFirst: true }]);
    });
});
