import { mapAsset, responseData } from "./util.js";

export async function publishingErrors(dxm) {
    await dxm._ensureLoggedIn();
    return (await dxm._cms.Report.publishingErrors()).assetList.map(a => mapAsset(dxm._cms, a));
}

export async function siteSummary(dxm) {
    await dxm._ensureLoggedIn();
    return responseData(await dxm._cms.Report.siteSummary(), "Could not read the site summary");
}
