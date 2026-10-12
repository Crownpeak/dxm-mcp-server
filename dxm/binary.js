import { mapAsset } from "./util.js";

const INPUT_RENDER_PATH = "/Asset/Input/Render";

export async function downloadAsset(dxm, id) {
    await dxm._ensureLoggedIn();
    const cms = dxm._cms;
    const asset = await cms.Asset.read(id);
    const label = asset.asset.label ?? '';
    const ext = label.includes('.') ? label.split('.').pop().toLowerCase() : '';
    const result = await cms.Asset.downloadAsBuffer(
        new cms.Asset.DownloadPrepareRequest([id])
    );
    return { buffer: result.fileBuffer, ext };
}

export async function uploadAsset(dxm, name, folderId, bytesBase64, { modelId = -1, workflowId = 0 } = {}) {
    await dxm._ensureLoggedIn();
    const cms = dxm._cms;
    const request = new cms.Asset.UploadRequest(bytesBase64, folderId, modelId, name, workflowId);
    const result = await cms.Asset.upload(request);
    return result.asset ? mapAsset(cms, result.asset) : result;
}

export async function attachAsset(dxm, assetId, bytesBase64, originalFilename) {
    await dxm._ensureLoggedIn();
    const cms = dxm._cms;
    const request = new cms.Asset.AttachRequest(assetId, bytesBase64, originalFilename);
    return await cms.Asset.attachv2(request);
}

export async function viewOutput(dxm, id) {
    await dxm._ensureLoggedIn();
    return await dxm._cms.Asset.viewOutput(id);
}

// The input-form view: everything the CMS hands its own editor UI to draw the authoring form for
// an asset. Sits beside viewOutput as the other half of the pair - output is the rendered page a
// visitor sees, input is the form an author sees.
//
// The helper has no wrapper for /Asset/Input/Render, so this goes through its generic public
// Util.makeCall primitive. If a native Asset.inputRender() is ever added to the helper, switch to
// it here the way the version family did.
export async function viewInput(dxm, id) {
    await dxm._ensureLoggedIn();
    const cms = dxm._cms;
    // isNew distinguishes "draw the form for this existing asset" from "draw a blank creation
    // form"; this is a read of an existing asset, so it is always false.
    const response = await cms.Util.makeCall(cms, INPUT_RENDER_PATH, { assetId: id, isNew: false });
    if (response.isSuccessful === false) {
        throw new Error(
            `Failed to render the input form for asset ${id}: ${response.errorMessage || response.resultCode}`
        );
    }
    // Deliberately field-by-field rather than spreading the response and deleting keys: the
    // envelope carries a `cookie` array of live session cookies, and this result goes straight
    // into an LLM context. An allow-list cannot leak a field a future API version adds.
    return {
        assetId: id,
        ui: response.ui ?? null,
        originalFields: response.originalFields ?? {},
        wysiwygConfigs: response.wysiwygConfigs ?? "",
        showSaveEditButton: response.showSaveEditButton ?? null
    };
}
