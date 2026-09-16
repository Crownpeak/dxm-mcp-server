import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
    listAttachments, readSiteRoot,
    setModel, setTemplate, setWorkflow,
    listVersions, getVersion, revertToVersion
} from "../dxm/properties.js";
import { makeFakeCms, makeFakeDxm } from "./_helpers.js";

// A row in the shape /AssetProperties/Versions actually returns on the wire: camelCase, with the
// odd `modified_On` capital O, and `name` holding the *user* who made the change.
function versionRow(versionId, overrides = {}) {
    return {
        statusId: 785,
        label: "Home Page",
        comment: "Edited body",
        modified_On: "2024-08-19T08:09:21.133Z",
        name: "Test User",
        change: 0,
        storageId: null,
        mergeId: null,
        versionId,
        assetId: 355355,
        versionType: "Modified",
        ...overrides
    };
}

// Stubs Util.makeCall, recording every call, and dispatching on the endpoint path.
function makeVersionCms({ versionPages = [], content = [], contentResponse, revertResponse } = {}) {
    const calls = [];
    const cms = makeFakeCms({
        Util: {
            makeCall: async (cmsArg, path, body) => {
                calls.push({ path, body, cmsArg });
                if (path === "/AssetProperties/Versions/") {
                    const page = versionPages[body.currentPage - 1];
                    if (page === undefined) return { assetVersions: [], resultCode: "conWS_Success" };
                    return Array.isArray(page)
                        ? { assetVersions: page, totalCount: page.length, resultCode: "conWS_Success" }
                        : page;
                }
                if (path === "/AssetProperties/Versions/Content") {
                    return contentResponse ?? { content, resultCode: "conWS_Success" };
                }
                if (path === "/Asset/RevertToVersion") {
                    return revertResponse ?? { newVersionId: 999999, resultCode: "conWS_Success" };
                }
                throw new Error(`unexpected path ${path}`);
            }
        }
    });
    return { cms, calls };
}

describe("listVersions", () => {
    test("requests 1-based pages and maps the wire shape", async () => {
        const { cms, calls } = makeVersionCms({ versionPages: [[versionRow(536379)]] });
        const dxm = makeFakeDxm(cms);
        const result = await listVersions(dxm, 355355);

        assert.equal(calls.length, 1);
        assert.equal(calls[0].path, "/AssetProperties/Versions/");
        // currentPage must start at 1 — page 0 returns an empty list with a success code.
        assert.deepEqual(calls[0].body, { assetId: 355355, currentPage: 1, pageSize: 50 });
        // makeCall takes the api instance as its first argument.
        assert.equal(calls[0].cmsArg, cms);

        assert.deepEqual(result, [{
            versionId: 536379,
            assetId: 355355,
            label: "Home Page",
            comment: "Edited body",
            modifiedOn: "2024-08-19T08:09:21.133Z",
            modifiedBy: "Test User",
            versionType: "Modified",
            statusId: 785,
            change: 0,
            storageId: null,
            mergeId: null
        }]);
    });

    test("calls _ensureLoggedIn before the request", async () => {
        const { cms } = makeVersionCms({ versionPages: [[versionRow(1)]] });
        const dxm = makeFakeDxm(cms);
        await listVersions(dxm, 1);
        assert.equal(dxm.ensureLoginCalls, 1);
    });

    test("drops the -1 sentinel row the endpoint pads the last page with", async () => {
        const { cms } = makeVersionCms({
            versionPages: [[versionRow(529825), versionRow(-1)]]
        });
        const result = await listVersions(makeFakeDxm(cms), 355355);
        assert.deepEqual(result.map(v => v.versionId), [529825]);
    });

    test("pages until a short page is returned", async () => {
        const full = Array.from({ length: 50 }, (_, i) => versionRow(1000 + i));
        const { cms, calls } = makeVersionCms({
            versionPages: [full, [versionRow(2000), versionRow(2001)]]
        });
        const result = await listVersions(makeFakeDxm(cms), 7);
        assert.equal(result.length, 52);
        assert.deepEqual(calls.map(c => c.body.currentPage), [1, 2]);
    });

    test("stops when a full page is followed by an empty one", async () => {
        const full = Array.from({ length: 50 }, (_, i) => versionRow(i + 1));
        const { cms, calls } = makeVersionCms({ versionPages: [full, []] });
        const result = await listVersions(makeFakeDxm(cms), 7);
        assert.equal(result.length, 50);
        assert.deepEqual(calls.map(c => c.body.currentPage), [1, 2]);
    });

    test("treats a page padded with sentinel rows as the last page", async () => {
        // The endpoint only pads the *final* page with -1 rows, so a page whose real-row count
        // falls below pageSize after filtering ends the walk — no further request is made.
        const padded = [...Array.from({ length: 49 }, (_, i) => versionRow(i + 1)), versionRow(-1)];
        const { cms, calls } = makeVersionCms({ versionPages: [padded, [versionRow(999)]] });
        const result = await listVersions(makeFakeDxm(cms), 7);
        assert.equal(result.length, 49);
        assert.deepEqual(calls.map(c => c.body.currentPage), [1]);
    });

    test("caps runaway paging rather than looping forever", async () => {
        // Every page comes back full, so only MAX_VERSION_PAGES stops the loop.
        const calls = [];
        const cms = makeFakeCms({
            Util: {
                makeCall: async (_cms, _path, body) => {
                    calls.push(body.currentPage);
                    return {
                        assetVersions: Array.from({ length: 50 }, (_, i) => versionRow(body.currentPage * 100 + i)),
                        resultCode: "conWS_Success"
                    };
                }
            }
        });
        const result = await listVersions(makeFakeDxm(cms), 7);
        assert.equal(calls.length, 100);
        assert.equal(result.length, 5000);
    });

    test("returns an empty array when the asset has no history", async () => {
        const { cms } = makeVersionCms({ versionPages: [[]] });
        assert.deepEqual(await listVersions(makeFakeDxm(cms), 42), []);
    });

    test("throws with the CMS error message when the call is unsuccessful", async () => {
        const { cms } = makeVersionCms({
            versionPages: [{ isSuccessful: false, resultCode: "conWS_Failure", errorMessage: "No permission" }]
        });
        await assert.rejects(
            () => listVersions(makeFakeDxm(cms), 99),
            /Failed to read version history for asset 99: No permission/
        );
    });

    test("falls back to the result code when errorMessage is empty", async () => {
        const { cms } = makeVersionCms({
            versionPages: [{ isSuccessful: false, resultCode: "conWS_Failure", errorMessage: "" }]
        });
        await assert.rejects(
            () => listVersions(makeFakeDxm(cms), 99),
            /conWS_Failure/
        );
    });
});

describe("getVersion", () => {
    test("returns the version metadata plus fields in listFields shape", async () => {
        const { cms, calls } = makeVersionCms({
            versionPages: [[versionRow(536379), versionRow(529829)]],
            content: [{ name: "body", value: "<p>Hi</p>" }, { name: "filename", value: "index" }]
        });
        const result = await getVersion(makeFakeDxm(cms), 355355, 529829);

        assert.equal(result.versionId, 529829);
        assert.equal(result.modifiedBy, "Test User");
        assert.equal(result.modifiedOn, "2024-08-19T08:09:21.133Z");
        assert.deepEqual(result.fields, [
            { name: "body", value: "<p>Hi</p>" },
            { name: "filename", value: "index" }
        ]);

        const contentCall = calls.find(c => c.path === "/AssetProperties/Versions/Content");
        assert.deepEqual(contentCall.body, { assetId: 355355, versionId: 529829 });
    });

    test("rejects a version ID that is not in the asset's history", async () => {
        // The endpoint would otherwise return the asset's *current* content with a success code,
        // so validating against the real history is what prevents a silently wrong answer.
        const { cms, calls } = makeVersionCms({
            versionPages: [[versionRow(536379), versionRow(529829)]],
            content: [{ name: "body", value: "current content" }]
        });
        await assert.rejects(
            () => getVersion(makeFakeDxm(cms), 355355, 1),
            /Version 1 not found on asset 355355\. Known version IDs: 536379, 529829/
        );
        // and it must not have asked for content at all
        assert.equal(calls.some(c => c.path === "/AssetProperties/Versions/Content"), false);
    });

    test("reports 'none' when the asset has no version history at all", async () => {
        const { cms } = makeVersionCms({ versionPages: [[]] });
        await assert.rejects(
            () => getVersion(makeFakeDxm(cms), 7, 123),
            /Known version IDs: none/
        );
    });

    test("accepts a numeric string version id", async () => {
        const { cms, calls } = makeVersionCms({
            versionPages: [[versionRow(536379)]],
            content: [{ name: "body", value: "x" }]
        });
        const result = await getVersion(makeFakeDxm(cms), 355355, "536379");
        assert.equal(result.versionId, 536379);
        const contentCall = calls.find(c => c.path === "/AssetProperties/Versions/Content");
        assert.equal(contentCall.body.versionId, 536379);
    });

    test("returns an empty field list when the version has no content", async () => {
        const { cms } = makeVersionCms({
            versionPages: [[versionRow(536379)]],
            contentResponse: { resultCode: "conWS_Success" }
        });
        const result = await getVersion(makeFakeDxm(cms), 355355, 536379);
        assert.deepEqual(result.fields, []);
    });

    test("throws when the content call is unsuccessful", async () => {
        const { cms } = makeVersionCms({
            versionPages: [[versionRow(536379)]],
            contentResponse: { isSuccessful: false, resultCode: "conWS_Failure", errorMessage: "Boom" }
        });
        await assert.rejects(
            () => getVersion(makeFakeDxm(cms), 355355, 536379),
            /Failed to read version 536379 of asset 355355: Boom/
        );
    });
});

describe("revertToVersion", () => {
    test("sends assetId, versionId and isConfirmed, and reports the new version", async () => {
        const { cms, calls } = makeVersionCms({
            versionPages: [[versionRow(536379), versionRow(529825)]],
            revertResponse: { newVersionId: 540000, resultCode: "conWS_Success" }
        });
        const result = await revertToVersion(makeFakeDxm(cms), 355355, 529825);

        const revertCall = calls.find(c => c.path === "/Asset/RevertToVersion");
        // isConfirmed must be true or the CMS has no mandate to actually perform the revert.
        assert.deepEqual(revertCall.body, { assetId: 355355, versionId: 529825, isConfirmed: true });

        assert.equal(result.assetId, 355355);
        assert.equal(result.newVersionId, 540000);
        // The version reverted *to* is echoed back so the caller can report what was restored.
        assert.equal(result.revertedTo.versionId, 529825);
        assert.equal(result.revertedTo.modifiedBy, "Test User");
    });

    test("calls _ensureLoggedIn before doing anything", async () => {
        const { cms } = makeVersionCms({ versionPages: [[versionRow(1)]] });
        const dxm = makeFakeDxm(cms);
        await revertToVersion(dxm, 5, 1);
        assert.ok(dxm.ensureLoginCalls >= 1);
    });

    test("refuses a version ID absent from the asset's history, without writing", async () => {
        const { cms, calls } = makeVersionCms({
            versionPages: [[versionRow(536379), versionRow(529825)]]
        });
        await assert.rejects(
            () => revertToVersion(makeFakeDxm(cms), 355355, 42),
            /Version 42 not found on asset 355355\. Known version IDs: 536379, 529825/
        );
        // The critical assertion: no revert was attempted.
        assert.equal(calls.some(c => c.path === "/Asset/RevertToVersion"), false);
    });

    test("refuses to revert an asset that has no version history", async () => {
        const { cms, calls } = makeVersionCms({ versionPages: [[]] });
        await assert.rejects(
            () => revertToVersion(makeFakeDxm(cms), 7, 123),
            /Known version IDs: none/
        );
        assert.equal(calls.some(c => c.path === "/Asset/RevertToVersion"), false);
    });

    test("accepts a numeric string version id", async () => {
        const { cms, calls } = makeVersionCms({ versionPages: [[versionRow(529825)]] });
        const result = await revertToVersion(makeFakeDxm(cms), 355355, "529825");
        assert.equal(result.revertedTo.versionId, 529825);
        const revertCall = calls.find(c => c.path === "/Asset/RevertToVersion");
        assert.equal(revertCall.body.versionId, 529825);
    });

    test("accepts the PascalCase NewVersionId that swagger declares", async () => {
        // Swagger says NewVersionId; every other response in this family is camelCase on the wire.
        const { cms } = makeVersionCms({
            versionPages: [[versionRow(529825)]],
            revertResponse: { NewVersionId: 540001, resultCode: "conWS_Success" }
        });
        const result = await revertToVersion(makeFakeDxm(cms), 355355, 529825);
        assert.equal(result.newVersionId, 540001);
    });

    test("reports null rather than undefined when no new version id comes back", async () => {
        const { cms } = makeVersionCms({
            versionPages: [[versionRow(529825)]],
            revertResponse: { resultCode: "conWS_Success" }
        });
        const result = await revertToVersion(makeFakeDxm(cms), 355355, 529825);
        assert.equal(result.newVersionId, null);
    });

    test("throws with the CMS error message when the revert is unsuccessful", async () => {
        const { cms } = makeVersionCms({
            versionPages: [[versionRow(529825)]],
            revertResponse: { isSuccessful: false, resultCode: "conWS_Failure", errorMessage: "Asset is locked" }
        });
        await assert.rejects(
            () => revertToVersion(makeFakeDxm(cms), 355355, 529825),
            /Failed to revert asset 355355 to version 529825: Asset is locked/
        );
    });
});

describe("listAttachments", () => {
    test("delegates to AssetProperties.attachments", async () => {
        let captured;
        const cms = makeFakeCms({
            AssetProperties: {
                attachments: async id => { captured = id; return [{ name: "thumb.jpg" }]; }
            }
        });
        const result = await listAttachments(makeFakeDxm(cms), 3);
        assert.equal(captured, 3);
        assert.deepEqual(result, [{ name: "thumb.jpg" }]);
    });
});

describe("readSiteRoot", () => {
    test("delegates to AssetProperties.readSiteRoot", async () => {
        let captured;
        const cms = makeFakeCms({
            AssetProperties: {
                readSiteRoot: async id => { captured = id; return { hostname: "example.com" }; }
            }
        });
        const result = await readSiteRoot(makeFakeDxm(cms), 10);
        assert.equal(captured, 10);
        assert.deepEqual(result, { hostname: "example.com" });
    });
});

describe("setModel", () => {
    test("wraps a single id and passes through model id", async () => {
        const calls = [];
        const cms = makeFakeCms({
            AssetProperties: { setModel: async (ids, modelId) => { calls.push({ ids, modelId }); } }
        });
        await setModel(makeFakeDxm(cms), 7, 99);
        await setModel(makeFakeDxm(cms), [1, 2], 99);
        assert.deepEqual(calls[0], { ids: [7], modelId: 99 });
        assert.deepEqual(calls[1], { ids: [1, 2], modelId: 99 });
    });
});

describe("setTemplate", () => {
    test("defaults language to CSharp and developer-template flag to false", async () => {
        let captured;
        const cms = makeFakeCms({
            AssetProperties: {
                setTemplate: async (ids, templateId, isDev, lang) => { captured = { ids, templateId, isDev, lang }; }
            }
        });
        await setTemplate(makeFakeDxm(cms), 7, 42);
        assert.deepEqual(captured.ids, [7]);
        assert.equal(captured.templateId, 42);
        assert.equal(captured.isDev, false);
        assert.equal(captured.lang, cms.Util.TemplateLanguageType.CSharp);
    });

    test("honors developer-template flag and explicit language", async () => {
        let captured;
        const cms = makeFakeCms({
            AssetProperties: {
                setTemplate: async (ids, templateId, isDev, lang) => { captured = { ids, templateId, isDev, lang }; }
            }
        });
        await setTemplate(makeFakeDxm(cms), [1, 2], 0, true, 7);
        assert.deepEqual(captured.ids, [1, 2]);
        assert.equal(captured.isDev, true);
        assert.equal(captured.lang, 7);
    });
});

describe("setWorkflow", () => {
    test("wraps a single id and forwards workflow id", async () => {
        const calls = [];
        const cms = makeFakeCms({
            AssetProperties: { setWorkflow: async (ids, workflowId) => { calls.push({ ids, workflowId }); } }
        });
        await setWorkflow(makeFakeDxm(cms), 7, 5);
        await setWorkflow(makeFakeDxm(cms), [1, 2], 6);
        assert.deepEqual(calls[0], { ids: [7], workflowId: 5 });
        assert.deepEqual(calls[1], { ids: [1, 2], workflowId: 6 });
    });
});
