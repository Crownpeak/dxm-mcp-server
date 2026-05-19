import { mapAsset } from "./util.js";

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
