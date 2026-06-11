import { mapAsset } from "./util.js";

export async function publishingErrors(dxm) {
    await dxm._ensureLoggedIn();
    return (await dxm._cms.Report.publishingErrors()).assetList.map(a => mapAsset(dxm._cms, a));
}

export async function siteSummary(dxm) {
    await dxm._ensureLoggedIn();
    return await dxm._cms.Report.siteSummary();
}
