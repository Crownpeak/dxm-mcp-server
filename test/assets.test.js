import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
    findAsset, getPath, listFolder, listFields,
    setFields, deleteFields, setCode,
    deleteAsset, undeleteAsset, branchAsset,
    moveAsset, renameAsset,
    createAsset, createFolder, createFolderWithModel,
    createProject, createSiteRoot, createLibraryReference,
    logMessage
} from "../dxm/assets.js";
import { makeFakeCms, makeFakeDxm } from "./_helpers.js";

describe("findAsset", () => {
    test("resolves a numeric id via Asset.read and maps the result", async () => {
        const cms = makeFakeCms({
            Asset: {
                read: async id => {
                    assert.equal(id, 42, "should pass through numeric id");
                    return { asset: { id: 42, label: "Home", type: 2, fullPath: "/Site/Home", statusName: "Live", folder_id: 3, error_msg: "" } };
                }
            }
        });
        const result = await findAsset(makeFakeDxm(cms), "42");
        assert.deepEqual(result, { id: 42, label: "Home", type: "File", fullPath: "/Site/Home", status: "Live", folder_id: 3, error_msg: "" });
    });

    test("resolves a path via Asset.exists then Asset.read", async () => {
        let existsArg = null;
        let readArg = null;
        const cms = makeFakeCms({
            Asset: {
                exists: async q => { existsArg = q; return { exists: true, assetId: 99 }; },
                read: async id => { readArg = id; return { asset: { id: 99, label: "Page", type: 2, fullPath: "/Site/Page", statusName: "Live", folder_id: 1 } }; }
            }
        });
        const result = await findAsset(makeFakeDxm(cms), "/Site/Page");
        assert.equal(existsArg, "/Site/Page");
        assert.equal(readArg, 99);
        assert.equal(result.id, 99);
    });

    test("throws when the path does not exist", async () => {
        const cms = makeFakeCms({
            Asset: { exists: async () => ({ exists: false }) }
        });
        await assert.rejects(() => findAsset(makeFakeDxm(cms), "/ghost"), /Asset not found: \/ghost/);
    });

    test("calls _ensureLoggedIn before the read", async () => {
        const cms = makeFakeCms({
            Asset: { read: async () => ({ asset: { id: 1, label: "x", type: 2, fullPath: "/x", statusName: "", folder_id: 0 } }) }
        });
        const dxm = makeFakeDxm(cms);
        await findAsset(dxm, "1");
        assert.equal(dxm.ensureLoginCalls, 1);
    });
});

describe("getPath", () => {
    test("constructs a PathByIdRequest and delegates to pathById", async () => {
        let captured;
        const cms = makeFakeCms({
            Asset: {
                PathByIdRequest: class { constructor(id, withAncestors) { this.id = id; this.withAncestors = withAncestors; } },
                pathById: async req => { captured = req; return { path: "/Site/Home", ancestors: [] }; }
            }
        });
        await getPath(makeFakeDxm(cms), 7, true);
        assert.equal(captured.id, 7);
        assert.equal(captured.withAncestors, true);
    });

    test("coerces includeAncestors to boolean", async () => {
        let captured;
        const cms = makeFakeCms({
            Asset: {
                PathByIdRequest: class { constructor(id, withAncestors) { this.withAncestors = withAncestors; } },
                pathById: async req => { captured = req; return {}; }
            }
        });
        await getPath(makeFakeDxm(cms), 1);
        assert.equal(captured.withAncestors, false);
    });
});

describe("listFolder", () => {
    function makeCmsWithPages(pages, normalCount = null) {
        const requests = [];
        return {
            requests,
            cms: makeFakeCms({
                Asset: {
                    PagedRequest: class {
                        constructor(folderId, _flat, page, _includeFolders, _includeFiles, _orderType, pageSize, _archived, _filter, visibility) {
                            this.folderId = folderId;
                            this.page = page;
                            this.pageSize = pageSize;
                            this.visibility = visibility;
                        }
                    },
                    paged: async req => {
                        requests.push({ page: req.page, visibility: req.visibility });
                        const assets = pages[req.page] ?? [];
                        return {
                            assets,
                            normalCount: normalCount ?? pages.flat().length,
                            deletedCount: 0,
                            hiddenCount: 0
                        };
                    }
                }
            })
        };
    }

    test("returns the first page when total count fits in one page", async () => {
        const { cms, requests } = makeCmsWithPages([[
            { id: 1, label: "A", type: 2, fullPath: "/A", statusName: "Live", folder_id: 9 },
            { id: 2, label: "B", type: 4, fullPath: "/B", statusName: "Live", folder_id: 9 }
        ]]);
        const result = await listFolder(makeFakeDxm(cms), 9);
        assert.equal(result.length, 2);
        assert.equal(result[0].label, "A");
        assert.equal(result[1].type, "Folder");
        assert.equal(requests.length, 1, "no extra pages when count fits");
    });

    test("paginates when the total count exceeds the page size", async () => {
        const page0 = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, label: `A${i}`, type: 2, fullPath: `/A${i}`, statusName: "Live", folder_id: 9 }));
        const page1 = Array.from({ length: 10 }, (_, i) => ({ id: 100 + i, label: `B${i}`, type: 2, fullPath: `/B${i}`, statusName: "Live", folder_id: 9 }));
        const { cms, requests } = makeCmsWithPages([page0, page1], 60);
        const result = await listFolder(makeFakeDxm(cms), 9);
        assert.equal(result.length, 60);
        assert.deepEqual(requests.map(r => r.page), [0, 1]);
    });

    test("applies a case-insensitive substring filter", async () => {
        const { cms } = makeCmsWithPages([[
            { id: 1, label: "Home Page", type: 2, fullPath: "/Home", statusName: "Live", folder_id: 0 },
            { id: 2, label: "About", type: 2, fullPath: "/About", statusName: "Live", folder_id: 0 },
            { id: 3, label: "homepage-styles", type: 2, fullPath: "/h", statusName: "Live", folder_id: 0 }
        ]]);
        const result = await listFolder(makeFakeDxm(cms), 0, { filter: "HOME" });
        assert.deepEqual(result.map(r => r.id), [1, 3]);
    });

    test("translates visibility=deleted to the Deleted enum value", async () => {
        const { cms, requests } = makeCmsWithPages([[]]);
        await listFolder(makeFakeDxm(cms), 0, { visibility: "deleted" });
        assert.equal(requests[0].visibility, cms.Util.VisibilityType.Deleted);
    });

    test("defaults to visibility=normal when not specified", async () => {
        const { cms, requests } = makeCmsWithPages([[]]);
        await listFolder(makeFakeDxm(cms), 0);
        assert.equal(requests[0].visibility, cms.Util.VisibilityType.Normal);
    });
});

describe("listFields", () => {
    test("returns name/value pairs", async () => {
        const cms = makeFakeCms({
            Asset: {
                fields: async id => {
                    assert.equal(id, 5);
                    return { fields: [{ name: "title", value: "Hi" }, { name: "body", value: "..." }] };
                }
            }
        });
        const result = await listFields(makeFakeDxm(cms), 5);
        assert.deepEqual(result, [{ name: "title", value: "Hi" }, { name: "body", value: "..." }]);
    });
});

// Capture-style helper: every write test below builds an UpdateRequest or similar, then
// asserts on the captured fields rather than re-implementing the request body inline.
function capture() {
    const seen = [];
    return { seen, fn: (...args) => seen.push(args) };
}

describe("setFields", () => {
    test("issues an UpdateRequest with the fields and an empty deletions list", async () => {
        let req;
        const cms = makeFakeCms({
            Asset: {
                UpdateRequest: class { constructor(id, fields, deletions) { Object.assign(this, { id, fields, deletions }); } },
                update: async r => { req = r; }
            }
        });
        await setFields(makeFakeDxm(cms), 11, { title: "X", body: "Y" });
        assert.equal(req.id, 11);
        assert.deepEqual(req.fields, { title: "X", body: "Y" });
        assert.deepEqual(req.deletions, []);
    });
});

describe("deleteFields", () => {
    test("issues an UpdateRequest with empty fields and the deletion list", async () => {
        let req;
        const cms = makeFakeCms({
            Asset: {
                UpdateRequest: class { constructor(id, fields, deletions) { Object.assign(this, { id, fields, deletions }); } },
                update: async r => { req = r; }
            }
        });
        await deleteFields(makeFakeDxm(cms), 11, ["a", "b"]);
        assert.deepEqual(req.fields, {});
        assert.deepEqual(req.deletions, ["a", "b"]);
    });
});

describe("setCode", () => {
    test("issues an UpdatePluginBodyRequest with the code and isCommitted=false", async () => {
        let req;
        const cms = makeFakeCms({
            Asset: {
                UpdatePluginBodyRequest: class { constructor(id, code, isCommitted) { Object.assign(this, { id, code, isCommitted }); } },
                updatePluginBody: async r => { req = r; }
            }
        });
        await setCode(makeFakeDxm(cms), 22, "<html>hi</html>");
        assert.equal(req.id, 22);
        assert.equal(req.code, "<html>hi</html>");
        assert.equal(req.isCommitted, false);
    });
});

describe("deleteAsset", () => {
    test("delegates to Asset.delete with the id", async () => {
        const c = capture();
        const cms = makeFakeCms({ Asset: { delete: async (...args) => c.fn(...args) } });
        await deleteAsset(makeFakeDxm(cms), 33);
        assert.deepEqual(c.seen, [[33]]);
    });
});

describe("undeleteAsset", () => {
    test("delegates to Asset.undelete with the id", async () => {
        const c = capture();
        const cms = makeFakeCms({ Asset: { undelete: async (...args) => c.fn(...args) } });
        await undeleteAsset(makeFakeDxm(cms), 34);
        assert.deepEqual(c.seen, [[34]]);
    });
});

describe("branchAsset", () => {
    test("maps the asset returned by Asset.branch", async () => {
        const cms = makeFakeCms({
            Asset: {
                branch: async id => {
                    assert.equal(id, 41);
                    return { asset: { id: 99, label: "Branched", type: 2, fullPath: "/x", statusName: "Draft", folder_id: 1 } };
                }
            }
        });
        const result = await branchAsset(makeFakeDxm(cms), 41);
        assert.equal(result.id, 99);
        assert.equal(result.status, "Draft");
        assert.equal(result.type, "File");
    });
});

describe("moveAsset", () => {
    test("constructs a MoveRequest with id and destinationFolderId", async () => {
        let req;
        const cms = makeFakeCms({
            Asset: {
                MoveRequest: class { constructor(id, dest) { Object.assign(this, { id, dest }); } },
                move: async r => { req = r; return { ok: true }; }
            }
        });
        await moveAsset(makeFakeDxm(cms), 51, 52);
        assert.equal(req.id, 51);
        assert.equal(req.dest, 52);
    });
});

describe("renameAsset", () => {
    test("constructs a RenameRequest with id and new name", async () => {
        let req;
        const cms = makeFakeCms({
            Asset: {
                RenameRequest: class { constructor(id, name) { Object.assign(this, { id, name }); } },
                rename: async r => { req = r; return { ok: true }; }
            }
        });
        await renameAsset(makeFakeDxm(cms), 61, "renamed");
        assert.equal(req.id, 61);
        assert.equal(req.name, "renamed");
    });
});

describe("createAsset / createFolder", () => {
    function recordingCms() {
        let req;
        const cms = makeFakeCms({
            Asset: {
                CreateRequest: class {
                    constructor(name, folderId, modelId, type, _flag, templateId, workflowId) {
                        Object.assign(this, { name, folderId, modelId, type, templateId, workflowId });
                    }
                },
                create: async r => { req = r; return { asset: { id: 1, label: r.name, type: r.type, fullPath: "/x", statusName: "S", folder_id: r.folderId } }; }
            }
        });
        return {
            cms,
            get req() { return req; }
        };
    }

    test("createAsset uses type=2 (File) and applies default model/template/workflow ids", async () => {
        const r = recordingCms();
        await createAsset(makeFakeDxm(r.cms), "doc.txt", 10);
        assert.equal(r.req.type, 2);
        assert.equal(r.req.modelId, -1);
        assert.equal(r.req.templateId, 0);
        assert.equal(r.req.workflowId, 0);
    });

    test("createAsset honors explicit modelId/templateId/workflowId", async () => {
        const r = recordingCms();
        await createAsset(makeFakeDxm(r.cms), "doc.txt", 10, { modelId: 7, templateId: 8, workflowId: 9 });
        assert.equal(r.req.modelId, 7);
        assert.equal(r.req.templateId, 8);
        assert.equal(r.req.workflowId, 9);
    });

    test("createFolder uses type=4 (Folder)", async () => {
        const r = recordingCms();
        await createFolder(makeFakeDxm(r.cms), "subfolder", 10);
        assert.equal(r.req.type, 4);
    });
});

describe("createFolderWithModel", () => {
    test("constructs CreateFolderWithModelRequest and returns mapAsset(result.asset)", async () => {
        let req;
        const cms = makeFakeCms({
            Asset: {
                CreateFolderWithModelRequest: class { constructor(name, folderId, modelId) { Object.assign(this, { name, folderId, modelId }); } },
                createFolderWithModel: async r => { req = r; return { asset: { id: 70, label: "F", type: 4, fullPath: "/F", statusName: "S", folder_id: 1 } }; }
            }
        });
        const result = await createFolderWithModel(makeFakeDxm(cms), "F", 1, 99);
        assert.equal(req.name, "F");
        assert.equal(req.folderId, 1);
        assert.equal(req.modelId, 99);
        assert.equal(result.type, "Folder");
    });
});

describe("createProject", () => {
    test("constructs CreateProjectRequest and coerces booleans + defaults version", async () => {
        let req;
        const cms = makeFakeCms({
            Asset: {
                CreateProjectRequest: class {
                    constructor(name, folderId, libraryName, installCL, versionCL, rebuildSite) {
                        Object.assign(this, { name, folderId, libraryName, installCL, versionCL, rebuildSite });
                    }
                },
                createProject: async r => { req = r; return { asset: { id: 1, label: "P", type: 6, fullPath: "/P", statusName: "S", folder_id: 0 } }; }
            }
        });
        await createProject(makeFakeDxm(cms), "P", 0, "Lib");
        assert.equal(req.installCL, false);
        assert.equal(req.versionCL, "");
        assert.equal(req.rebuildSite, false);

        await createProject(makeFakeDxm(cms), "P", 0, "Lib", 1, "v2", "yes");
        assert.equal(req.installCL, true);
        assert.equal(req.versionCL, "v2");
        assert.equal(req.rebuildSite, true);
    });
});

describe("createSiteRoot", () => {
    test("constructs CreateSiteRootRequest with coerced booleans and defaults version to empty string", async () => {
        let req;
        const cms = makeFakeCms({
            Asset: {
                CreateSiteRootRequest: class {
                    constructor(name, folderId, installCL, rebuildCL, versionCL) {
                        Object.assign(this, { name, folderId, installCL, rebuildCL, versionCL });
                    }
                },
                createSiteRoot: async r => { req = r; return { asset: { id: 1, label: "S", type: 2, fullPath: "/S", statusName: "S", folder_id: 0 } }; }
            }
        });
        await createSiteRoot(makeFakeDxm(cms), "S", 0);
        assert.equal(req.installCL, false);
        assert.equal(req.rebuildCL, false);
        assert.equal(req.versionCL, "");
    });
});

describe("createLibraryReference", () => {
    test("constructs CreateLibraryReferenceRequest with name/folderId/libraryId", async () => {
        let req;
        const cms = makeFakeCms({
            Asset: {
                CreateLibraryReferenceRequest: class { constructor(name, folderId, libraryId) { Object.assign(this, { name, folderId, libraryId }); } },
                createLibraryReference: async r => { req = r; return { asset: { id: 1, label: "L", type: 2, fullPath: "/L", statusName: "S", folder_id: 0 } }; }
            }
        });
        await createLibraryReference(makeFakeDxm(cms), "L", 7, 8);
        assert.equal(req.name, "L");
        assert.equal(req.folderId, 7);
        assert.equal(req.libraryId, 8);
    });
});

describe("logMessage", () => {
    test("calls Asset.log with message and the supplied asset id", async () => {
        const c = capture();
        const cms = makeFakeCms({ Asset: { log: async (...args) => c.fn(...args) } });
        await logMessage(makeFakeDxm(cms), "hi", 42);
        assert.deepEqual(c.seen[0], ["hi", 42]);
    });

    test("falls back to an empty-string asset id when none is provided", async () => {
        const c = capture();
        const cms = makeFakeCms({ Asset: { log: async (...args) => c.fn(...args) } });
        await logMessage(makeFakeDxm(cms), "hi");
        assert.deepEqual(c.seen[0], ["hi", ""]);
    });
});
