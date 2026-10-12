import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { downloadAsset, uploadAsset, attachAsset, viewOutput, viewInput } from "../dxm/binary.js";
import { makeFakeCms, makeFakeDxm } from "./_helpers.js";

describe("downloadAsset", () => {
    test("returns buffer plus extension parsed from the asset label", async () => {
        const cms = makeFakeCms({
            Asset: {
                read: async id => {
                    assert.equal(id, 99);
                    return { asset: { label: "logo.PNG" } };
                },
                DownloadPrepareRequest: class { constructor(ids) { this.ids = ids; } },
                downloadAsBuffer: async req => {
                    assert.deepEqual(req.ids, [99]);
                    return { fileBuffer: Buffer.from([1, 2, 3]) };
                }
            }
        });
        const result = await downloadAsset(makeFakeDxm(cms), 99);
        assert.deepEqual(result.buffer, Buffer.from([1, 2, 3]));
        assert.equal(result.ext, "png", "extension is lowercased");
    });

    test("returns an empty extension when the label has no dot", async () => {
        const cms = makeFakeCms({
            Asset: {
                read: async () => ({ asset: { label: "no-extension" } }),
                DownloadPrepareRequest: class { constructor(ids) { this.ids = ids; } },
                downloadAsBuffer: async () => ({ fileBuffer: Buffer.alloc(0) })
            }
        });
        const result = await downloadAsset(makeFakeDxm(cms), 1);
        assert.equal(result.ext, "");
    });

    test("handles a missing label gracefully", async () => {
        const cms = makeFakeCms({
            Asset: {
                read: async () => ({ asset: {} }),
                DownloadPrepareRequest: class { constructor(ids) { this.ids = ids; } },
                downloadAsBuffer: async () => ({ fileBuffer: Buffer.alloc(0) })
            }
        });
        const result = await downloadAsset(makeFakeDxm(cms), 1);
        assert.equal(result.ext, "");
    });
});

describe("viewOutput", () => {
    test("delegates to cms.Asset.viewOutput and returns the rendered text", async () => {
        const cms = makeFakeCms({
            Asset: {
                viewOutput: async id => {
                    assert.equal(id, 7);
                    return "<html>hi</html>";
                }
            }
        });
        const html = await viewOutput(makeFakeDxm(cms), 7);
        assert.equal(html, "<html>hi</html>");
    });
});

describe("uploadAsset", () => {
    function recordingCms() {
        let req;
        return {
            get req() { return req; },
            cms: makeFakeCms({
                Asset: {
                    UploadRequest: class {
                        constructor(bytes, destinationFolderId, modelId, newName, workflowId) {
                            Object.assign(this, { bytes, destinationFolderId, modelId, newName, workflowId });
                        }
                    },
                    upload: async r => { req = r; return { asset: { id: 9, label: "f.bin", type: 2, fullPath: "/f.bin", statusName: "S", folder_id: 1 } }; }
                }
            })
        };
    }

    test("constructs UploadRequest with positional args in the documented order", async () => {
        const r = recordingCms();
        await uploadAsset(makeFakeDxm(r.cms), "f.bin", 1, "Zm9v");
        assert.equal(r.req.bytes, "Zm9v");
        assert.equal(r.req.destinationFolderId, 1);
        assert.equal(r.req.newName, "f.bin");
    });

    test("defaults modelId=-1 and workflowId=0 when options are omitted", async () => {
        const r = recordingCms();
        await uploadAsset(makeFakeDxm(r.cms), "f.bin", 1, "Zm9v");
        assert.equal(r.req.modelId, -1);
        assert.equal(r.req.workflowId, 0);
    });

    test("honors explicit modelId/workflowId overrides", async () => {
        const r = recordingCms();
        await uploadAsset(makeFakeDxm(r.cms), "f.bin", 1, "Zm9v", { modelId: 5, workflowId: 6 });
        assert.equal(r.req.modelId, 5);
        assert.equal(r.req.workflowId, 6);
    });

    test("returns mapAsset(result.asset) when the helper returned one", async () => {
        const r = recordingCms();
        const result = await uploadAsset(makeFakeDxm(r.cms), "f.bin", 1, "Zm9v");
        assert.equal(result.id, 9);
        assert.equal(result.type, "File");
    });

    test("returns the raw helper response when no asset was attached to it", async () => {
        const cms = makeFakeCms({
            Asset: {
                UploadRequest: class { constructor(...a) { this.a = a; } },
                upload: async () => ({ errorMessage: "nope" })
            }
        });
        const result = await uploadAsset(makeFakeDxm(cms), "f.bin", 1, "Zm9v");
        assert.deepEqual(result, { errorMessage: "nope" });
    });
});

describe("attachAsset", () => {
    test("constructs AttachRequest and calls attachv2 (not the older attach endpoint)", async () => {
        let req;
        let attachCalled = false;
        const cms = makeFakeCms({
            Asset: {
                AttachRequest: class { constructor(assetId, bytes, original) { Object.assign(this, { assetId, bytes, original }); } },
                attach: async () => { attachCalled = true; throw new Error("attach should not be called"); },
                attachv2: async r => { req = r; return { ok: true }; }
            }
        });
        const result = await attachAsset(makeFakeDxm(cms), 12, "Zm9v", "logo.png");
        assert.equal(req.assetId, 12);
        assert.equal(req.bytes, "Zm9v");
        assert.equal(req.original, "logo.png");
        assert.equal(attachCalled, false);
        assert.deepEqual(result, { ok: true });
    });
});

describe("viewInput", () => {
    // /Asset/Input/Render has no helper wrapper, so viewInput goes through Util.makeCall.
    function makeRenderCms(response) {
        const calls = [];
        const cms = makeFakeCms({
            Util: {
                makeCall: async (cmsArg, path, body) => {
                    calls.push({ cmsArg, path, body });
                    return response;
                }
            }
        });
        return { cms, calls };
    }

    const fullResponse = {
        ui: { type: "Root", controls: [{ type: "TabContainer" }] },
        originalFields: { html_title: "Home", body: "<p>Hi</p>" },
        wysiwygConfigs: "wysiwyg_config^&^0^&^{}",
        showSaveEditButton: true,
        resultCode: "conWS_Success",
        errorMessage: "",
        internalCode: 0,
        responseValues: null,
        cookie: ["ASP.NET_SessionId=secret; Path=/; HttpOnly", "AWSALB=secret2; Path=/"],
        isSuccessful: true
    };

    test("posts assetId with isNew false and returns the render payload", async () => {
        const { cms, calls } = makeRenderCms(fullResponse);
        const result = await viewInput(makeFakeDxm(cms), 355355);

        assert.equal(calls.length, 1);
        assert.equal(calls[0].path, "/Asset/Input/Render");
        assert.equal(calls[0].cmsArg, cms, "makeCall takes the api instance first");
        // isNew false means "the form for this existing asset", not a blank creation form.
        assert.deepEqual(calls[0].body, { assetId: 355355, isNew: false });

        assert.equal(result.assetId, 355355);
        assert.deepEqual(result.ui, fullResponse.ui);
        assert.deepEqual(result.originalFields, fullResponse.originalFields);
        assert.equal(result.wysiwygConfigs, fullResponse.wysiwygConfigs);
        assert.equal(result.showSaveEditButton, true);
    });

    test("never returns the session cookies the envelope carries", async () => {
        // The raw response includes live session cookies. This result goes into an LLM context,
        // so the allow-list in viewInput is a security boundary, not tidying.
        const { cms } = makeRenderCms(fullResponse);
        const result = await viewInput(makeFakeDxm(cms), 1);
        assert.deepEqual(Object.keys(result).sort(), [
            "assetId", "originalFields", "showSaveEditButton", "ui", "wysiwygConfigs"
        ]);
        assert.equal(JSON.stringify(result).includes("secret"), false);
    });

    test("calls _ensureLoggedIn before the request", async () => {
        const { cms } = makeRenderCms(fullResponse);
        const dxm = makeFakeDxm(cms);
        await viewInput(dxm, 1);
        assert.equal(dxm.ensureLoginCalls, 1);
    });

    test("defaults each part of the payload when the response omits it", async () => {
        const { cms } = makeRenderCms({ resultCode: "conWS_Success" });
        const result = await viewInput(makeFakeDxm(cms), 7);
        assert.equal(result.ui, null);
        assert.deepEqual(result.originalFields, {});
        assert.equal(result.wysiwygConfigs, "");
        assert.equal(result.showSaveEditButton, null);
    });

    test("throws with the CMS error message when the render fails", async () => {
        const { cms } = makeRenderCms({
            isSuccessful: false, resultCode: "conWS_Failure", errorMessage: "Asset not found"
        });
        await assert.rejects(
            () => viewInput(makeFakeDxm(cms), 404),
            /Failed to render the input form for asset 404: Asset not found/
        );
    });

    test("falls back to the result code when errorMessage is empty", async () => {
        const { cms } = makeRenderCms({ isSuccessful: false, resultCode: "conWS_Failure", errorMessage: "" });
        await assert.rejects(() => viewInput(makeFakeDxm(cms), 404), /conWS_Failure/);
    });
});
