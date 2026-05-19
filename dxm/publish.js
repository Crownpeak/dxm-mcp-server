export async function getPublishLinks(dxm, id) {
    await dxm._ensureLoggedIn();
    return await dxm._cms.Asset.getPublishLinks(id);
}

export async function publishAssets(dxm, ids, skipDependencies = false) {
    await dxm._ensureLoggedIn();
    const cms = dxm._cms;
    const idArray = Array.isArray(ids) ? ids : [ids];
    const request = new cms.Asset.PublishRequest(idArray, !!skipDependencies);
    return await cms.Asset.publish(request);
}

export async function republishAssets(dxm, ids, publishingServerId, skipDependencies = false) {
    await dxm._ensureLoggedIn();
    const cms = dxm._cms;
    const idArray = Array.isArray(ids) ? ids : [ids];
    const request = new cms.Asset.PublishRefreshRequest(idArray, publishingServerId, !!skipDependencies);
    return await cms.Asset.publishRefresh(request);
}
