import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
    findAsset, getPath, listFolder, listFields,
    setFields, deleteFields, setCode,
    deleteAsset, undeleteAsset, branchAsset,
    moveAsset, renameAsset,
    createAsset, createFolder, createFolderWithModel,
    createProject, createSiteRoot, createLibraryReference,
    logMessage,
    ASSET_SUBTYPE, FILE_SUBTYPES, FOLDER_SUBTYPES, COMPILE_WAIT_MS, isTemplateCode
} from "../dxm/assets.js";
import { TOOL_TIMEOUT_MS } from "../dxm/tools/util.js";
import { makeFakeCms, makeFakeDxm } from "./_helpers.js";

describe("findAsset", () => {
    test("resolves a numeric id via Asset.read and maps the result", async () => {
        const cms = makeFakeCms({
            Asset: {
                read: async id => {
                    assert.equal(id, 42, "should pass through numeric id");
                    return { asset: { id: 42, label: "Home", type: 2, fullPath: "/Site/Home", statusName: "Live", folder_id: 3, branchId: 40, error_msg: "" } };
                }
            }
        });
        const result = await findAsset(makeFakeDxm(cms), "42");
        assert.deepEqual(result, { id: 42, label: "Home", type: "File", fullPath: "/Site/Home", status: "Live", folder_id: 3, branchId: 40, error_msg: "" });
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
    // UpdateRequest's last two constructor args are the helper's separate runPostInput /
    // runPostSave flags, which setFields drives from its single postProcess argument.
    function updateStub() {
        let req;
        const cms = makeFakeCms({
            Asset: {
                UpdateRequest: class {
                    constructor(id, fields, deletions, runPostInput, runPostSave) {
                        Object.assign(this, { id, fields, deletions, runPostInput, runPostSave });
                    }
                },
                update: async r => { req = r; }
            }
        });
        return { cms, get req() { return req; } };
    }

    test("issues an UpdateRequest with the fields and an empty deletions list", async () => {
        const stub = updateStub();
        await setFields(makeFakeDxm(stub.cms), 11, { title: "X", body: "Y" });
        assert.equal(stub.req.id, 11);
        assert.deepEqual(stub.req.fields, { title: "X", body: "Y" });
        assert.deepEqual(stub.req.deletions, []);
    });

    test("leaves post-processing off by default", async () => {
        // The default matters: post_save handlers are arbitrary template code that can reach
        // other assets, so an ordinary edit must not trigger them.
        const stub = updateStub();
        await setFields(makeFakeDxm(stub.cms), 11, { title: "X" });
        assert.equal(stub.req.runPostInput, false);
        assert.equal(stub.req.runPostSave, false);
    });

    test("sets both post-processing flags from the single postProcess argument", async () => {
        const stub = updateStub();
        await setFields(makeFakeDxm(stub.cms), 11, { title: "X" }, true);
        assert.equal(stub.req.runPostInput, true);
        assert.equal(stub.req.runPostSave, true);
    });

    test("coerces a truthy non-boolean postProcess to a real boolean", async () => {
        // The tool layer passes !!post_process, but the domain function is called directly from
        // tests and could be from elsewhere; the helper serialises these straight into the body.
        const stub = updateStub();
        await setFields(makeFakeDxm(stub.cms), 11, { title: "X" }, "yes");
        assert.equal(stub.req.runPostInput, true);
        assert.equal(stub.req.runPostSave, true);
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
    // Asset records as Asset.read returned them live on CPUK. The default is a Library class.
    const LIBRARY_CLASS = { id: 384196, label: "ZZVersionTest.cs", subtype: 17, extension: "cs" };
    const TEMPLATE_FILE = { id: 384200, label: "output.aspx", subtype: 17, extension: "aspx" };
    const DEVELOPER_TEMPLATE = { id: 384201, label: "ZZ Scratch", subtype: 1, extension: "" };

    function codeCms(response, asset = LIBRARY_CLASS) {
        const calls = [];
        const reads = [];
        const cms = makeFakeCms({
            Asset: {
                UpdatePluginBodyRequest: class { constructor(id, code, isCommitted) { Object.assign(this, { id, code, isCommitted }); } },
                updatePluginBody: async (...args) => { calls.push(args); return response; },
                read: async id => {
                    reads.push(id);
                    if (asset instanceof Error) throw asset;
                    return { asset };
                }
            }
        });
        return { cms, calls, reads };
    }

    test("issues an UpdatePluginBodyRequest with the code and isCommitted=false", async () => {
        const { cms, calls } = codeCms({ isSuccessful: true });
        await setCode(makeFakeDxm(cms), 22, "<html>hi</html>");
        const [req] = calls[0];
        assert.equal(req.id, 22);
        assert.equal(req.code, "<html>hi</html>");
        assert.equal(req.isCommitted, false);
    });

    test("always waits for template code: .aspx template files and Developer Templates", async () => {
        for (const asset of [TEMPLATE_FILE, DEVELOPER_TEMPLATE]) {
            const { cms, calls } = codeCms({ isSuccessful: true, compilation: { succeeded: true } }, asset);
            assert.equal((await setCode(makeFakeDxm(cms), asset.id, "x")).status, "succeeded", asset.label);
            assert.equal(calls[0][1], true, asset.label);
            // Even an explicit "don't wait" is overridden for templates.
            const off = codeCms({ isSuccessful: true, compilation: { succeeded: true } }, asset);
            await setCode(makeFakeDxm(off.cms), asset.id, "x", { waitForCompilation: false });
            assert.equal(off.calls[0][1], true, asset.label + " with wait off");
        }
    });

    test("tells template files from Library classes by extension, since both are subtype 17", () => {
        assert.equal(isTemplateCode(TEMPLATE_FILE), true);
        assert.equal(isTemplateCode({ ...TEMPLATE_FILE, extension: "ASPX" }), true);
        assert.equal(isTemplateCode(DEVELOPER_TEMPLATE), true);
        assert.equal(isTemplateCode(LIBRARY_CLASS), false);
        assert.equal(isTemplateCode({ subtype: 17, extension: "css" }), false);
        assert.equal(isTemplateCode({ subtype: 0, extension: "aspx" }), false);
        assert.equal(isTemplateCode(undefined), false);
    });

    test("skips the asset read when the caller already asked to wait", async () => {
        const { cms, reads } = codeCms({ isSuccessful: true, compilation: { succeeded: true } });
        await setCode(makeFakeDxm(cms), 1, "x", { waitForCompilation: true });
        assert.deepEqual(reads, []);
    });

    test("still saves, without waiting, when the asset read fails", async () => {
        const { cms, calls } = codeCms({ isSuccessful: true }, new Error("read failed"));
        assert.equal(await setCode(makeFakeDxm(cms), 1, "x"), null);
        assert.equal(calls.length, 1);
        assert.equal(calls[0][1], false);
    });

    test("does not wait by default for a Library class, whose compiles can outlast the wait", async () => {
        const { cms, calls } = codeCms({ isSuccessful: true });
        assert.equal(await setCode(makeFakeDxm(cms), 1, "x"), null);
        assert.equal(calls[0][1], false);
    });

    test("waits on request, within the tool's time budget", async () => {
        const { cms, calls } = codeCms({ isSuccessful: true });
        await setCode(makeFakeDxm(cms), 1, "x", { waitForCompilation: true });
        assert.deepEqual(calls[0].slice(1), [true, COMPILE_WAIT_MS]);
        assert.ok(COMPILE_WAIT_MS < TOOL_TIMEOUT_MS, "the socket connect and the save need room inside the tool timeout too");
    });

    test("reports a successful compile", async () => {
        const { cms } = codeCms({ isSuccessful: true, compilation: { succeeded: true, message: "CompilationSucceeded", rawData: null, serverNumber: "WEB-3", timedOut: false } });
        assert.deepEqual(await setCode(makeFakeDxm(cms), 1, "x", { waitForCompilation: true }), { status: "succeeded", output: null, reason: null });
    });

    test("reports a failed compile with the compiler output", async () => {
        // rawData as a live CPUK compile returned it.
        const rawData = "Errors compiling Library /Site/Project/Library/ (275154)\r\n error CS0116: A namespace cannot directly contain members such as fields or methods in ZZVersionTest.cs at line: 11, column: 5-5\r\n";
        const { cms } = codeCms({ isSuccessful: true, compilation: { succeeded: false, message: "CompilationFailed", rawData, serverNumber: "WEB-3", timedOut: false } });
        assert.deepEqual(await setCode(makeFakeDxm(cms), 1, "x", { waitForCompilation: true }), { status: "failed", output: rawData, reason: null });
    });

    test("reports a timed-out wait as unknown, not as a failure", async () => {
        const { cms } = codeCms({ isSuccessful: true, compilation: { succeeded: null, message: null, rawData: null, serverNumber: null, timedOut: true } });
        assert.deepEqual(await setCode(makeFakeDxm(cms), 1, "x", { waitForCompilation: true }), { status: "unknown", output: null, reason: "No compile result arrived before the wait ended" });
    });

    test("reports an unavailable channel as unknown with the reason, never as a failure", async () => {
        // Helper 1.4.0's shape when the socket could not connect, or dropped mid-wait: the save
        // still happened, succeeded is null, and the reason is in error.
        const { cms } = codeCms({ isSuccessful: true, compilation: {
            succeeded: null, message: null, rawData: null, serverNumber: null, timedOut: false,
            unavailable: true, error: "Notification socket closed: 1006"
        } });
        assert.deepEqual(await setCode(makeFakeDxm(cms), 1, "x", { waitForCompilation: true }), {
            status: "unknown", output: null, reason: "Could not listen for the compile result: Notification socket closed: 1006"
        });
    });

    test("throws when the CMS refuses the save instead of reporting success", async () => {
        const { cms } = codeCms({ isSuccessful: false, resultCode: "conWS_AssetLocked", errorMessage: "Asset is locked" });
        await assert.rejects(() => setCode(makeFakeDxm(cms), 1, "x"), /Asset is locked/);
        const bare = codeCms({ isSuccessful: false, resultCode: "conWS_Failure" });
        await assert.rejects(() => setCode(makeFakeDxm(bare.cms), 1, "x"), /conWS_Failure/);
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
                    constructor(name, folderId, modelId, type, devTemplateLanguage, templateId, workflowId, subtype) {
                        Object.assign(this, { name, folderId, modelId, type, devTemplateLanguage, templateId, workflowId, subtype });
                    }
                    // Same field names the helper's AssetCreateRequest.toJson() produces.
                    toJson() {
                        return {
                            destinationFolderId: this.folderId, devTemplateLanguage: this.devTemplateLanguage,
                            modelId: this.modelId, newName: this.name, subtype: this.subtype,
                            templateId: this.templateId, type: this.type, workflowId: this.workflowId
                        };
                    }
                },
                // Asset.create in the helper only ever calls request.toJson(), so assert on that
                // body - it is what goes over the wire.
                create: async r => {
                    req = r.toJson();
                    return { asset: { id: 1, label: req.newName, type: req.type, fullPath: "/x", statusName: "S", folder_id: req.destinationFolderId } };
                }
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
        assert.equal(r.req.modelId, 0);
        assert.equal(r.req.devTemplateLanguage, -1, "an ordinary file has no template language");
        assert.equal(r.req.runNew, true);
        assert.equal(r.req.createChildren, false);
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

    test("create_file sends exactly the body of a known-good /Asset/Create call", async () => {
        // Captured from a direct API call that succeeded where the helper's defaults (modelId -1,
        // devTemplateLanguage 0, no runNew/createChildren) made create_file fail. Pinned whole so a
        // later "tidy-up" of any one field can't silently reintroduce the failure.
        const r = recordingCms();
        await createAsset(makeFakeDxm(r.cms), "Test", 384101, { templateId: 384111, workflowId: 0 });
        assert.deepEqual(r.req, {
            newName: "Test", destinationFolderId: 384101, modelId: 0, type: 2, subtype: 0,
            devTemplateLanguage: -1, templateId: 384111, workflowId: 0, runNew: true, createChildren: false
        });
    });

    test("createFolder keeps its original body - folders were not reported broken", async () => {
        const r = recordingCms();
        await createFolder(makeFakeDxm(r.cms), "sub", 10);
        assert.equal(r.req.modelId, -1);
        assert.equal(r.req.devTemplateLanguage, 0);
        assert.equal("runNew" in r.req, false);
        assert.equal("createChildren" in r.req, false);
    });

    test("createFolder uses type=4 (Folder)", async () => {
        const r = recordingCms();
        await createFolder(makeFakeDxm(r.cms), "subfolder", 10);
        assert.equal(r.req.type, 4);
    });

    test("both default the subtype to 0 (no special type)", async () => {
        const f = recordingCms();
        await createAsset(makeFakeDxm(f.cms), "doc.txt", 10);
        assert.equal(f.req.subtype, 0);
        const d = recordingCms();
        await createFolder(makeFakeDxm(d.cms), "sub", 10);
        assert.equal(d.req.subtype, 0);
    });

    test("createAsset passes each file subtype through to the request", async () => {
        for (const subtype of [0, 1, 17]) {
            const r = recordingCms();
            await createAsset(makeFakeDxm(r.cms), "t.aspx", 10, { subtype });
            assert.equal(r.req.subtype, subtype);
            assert.equal(r.req.type, 2, "the asset type stays File whatever the subtype");
        }
    });

    test("createFolder passes each folder subtype through to the request", async () => {
        for (const subtype of [0, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192]) {
            const r = recordingCms();
            await createFolder(makeFakeDxm(r.cms), "f", 10, { subtype });
            assert.equal(r.req.subtype, subtype);
            assert.equal(r.req.type, 4, "the asset type stays Folder whatever the subtype");
        }
    });

    test("createAsset refuses a folder-only subtype, before any request", async () => {
        const r = recordingCms();
        const dxm = makeFakeDxm(r.cms);
        await assert.rejects(
            () => createAsset(dxm, "x", 10, { subtype: 256 }),
            { message: "Subtype 256 is not valid for a file. Allowed: 0 (None), 1 (DeveloperTemplate), 17 (TemplateFile)" }
        );
        assert.equal(r.req, undefined, "no create call was made");
        assert.equal(dxm.ensureLoginCalls, 0, "validation happens before login");
    });

    test("createFolder refuses the two template-file subtypes", async () => {
        for (const subtype of [1, 17]) {
            const r = recordingCms();
            await assert.rejects(
                () => createFolder(makeFakeDxm(r.cms), "x", 10, { subtype }),
                new RegExp(`Subtype ${subtype} is not valid for a folder`)
            );
            assert.equal(r.req, undefined);
        }
    });

    test("a Template File (17) also sets devTemplateLanguage to C# (1)", async () => {
        const r = recordingCms();
        await createAsset(makeFakeDxm(r.cms), "output.aspx", 10, { subtype: 17 });
        assert.equal(r.req.subtype, 17);
        assert.equal(r.req.devTemplateLanguage, 1);
        assert.equal(r.req.createChildren, false, "createChildren is only true for template folders");
    });

    test("a Template folder (512) sets devTemplateLanguage to 1 and createChildren to true", async () => {
        const r = recordingCms();
        await createFolder(makeFakeDxm(r.cms), "Article", 10, { subtype: 512 });
        assert.equal(r.req.type, 4);
        assert.equal(r.req.subtype, 512);
        assert.equal(r.req.devTemplateLanguage, 1);
        assert.equal(r.req.createChildren, true);
        // and the rest of the helper's body survives the extension untouched
        assert.equal(r.req.newName, "Article");
        assert.equal(r.req.destinationFolderId, 10);
        assert.equal(r.req.modelId, -1);
    });

    test("no other subtype gets a template language or createChildren", async () => {
        for (const subtype of [0, 1]) {
            const r = recordingCms();
            await createAsset(makeFakeDxm(r.cms), "x", 10, { subtype });
            assert.equal(r.req.devTemplateLanguage, -1, `file subtype ${subtype}`);
            assert.equal(r.req.createChildren, false, `file subtype ${subtype}`);
        }
        for (const subtype of [0, 32, 64, 128, 256, 1024, 2048, 4096, 8192]) {
            const r = recordingCms();
            await createFolder(makeFakeDxm(r.cms), "x", 10, { subtype });
            assert.equal(r.req.devTemplateLanguage, 0, `folder subtype ${subtype}`);
            assert.equal("createChildren" in r.req, false, `folder subtype ${subtype}`);
        }
    });

    test("both refuse a value that is not a subtype at all", async () => {
        await assert.rejects(() => createAsset(makeFakeDxm(recordingCms().cms), "x", 10, { subtype: 3 }), /not valid for a file/);
        await assert.rejects(() => createFolder(makeFakeDxm(recordingCms().cms), "x", 10, { subtype: 3 }), /not valid for a folder/);
    });
});

describe("asset subtype tables", () => {
    test("ASSET_SUBTYPE mirrors the helper's Util.AssetSubType exactly", async () => {
        // The tool schemas need the table statically, so it is restated in dxm/assets.js; this
        // catches drift in either direction if the helper ever adds, renames or renumbers one.
        const util = (await import("crownpeak-dxm-accessapi-helper/common/util.js")).default;
        assert.deepEqual({ ...ASSET_SUBTYPE }, util.AssetSubType);
    });

    test("files and folders split the subtypes with only None in common", () => {
        const file = Object.values(FILE_SUBTYPES);
        const folder = Object.values(FOLDER_SUBTYPES);
        assert.deepEqual(file, [0, 1, 17]);
        assert.deepEqual(file.filter(v => folder.includes(v)), [0]);
        // together they cover every subtype the helper knows about
        assert.deepEqual([...new Set([...file, ...folder])].sort((a, b) => a - b),
            Object.values(ASSET_SUBTYPE).sort((a, b) => a - b));
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
