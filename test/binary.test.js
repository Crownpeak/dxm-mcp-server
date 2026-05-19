import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { downloadAsset, uploadAsset, attachAsset, viewOutput } from "../dxm/binary.js";
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
