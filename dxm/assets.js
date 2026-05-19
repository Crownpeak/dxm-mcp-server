import { mapAsset } from "./util.js";

export async function findAsset(dxm, query) {
    await dxm._ensureLoggedIn();
    const cms = dxm._cms;

    const numericId = /^\d+$/.test(String(query).trim()) ? Number(query) : null;
    if (numericId !== null) {
        const result = await cms.Asset.read(numericId);
        return mapAsset(cms, result.asset);
    }

    const exists = await cms.Asset.exists(query);
    if (!exists.exists) throw new Error(`Asset not found: ${query}`);
    const result = await cms.Asset.read(exists.assetId);
    return mapAsset(cms, result.asset);
}

export async function getPath(dxm, id, includeAncestors = false) {
    await dxm._ensureLoggedIn();
    const cms = dxm._cms;
    const request = new cms.Asset.PathByIdRequest(id, !!includeAncestors);
    return await cms.Asset.pathById(request);
}

export async function listFolder(dxm, id, { visibility = "normal", filter = "" } = {}) {
    await dxm._ensureLoggedIn();
    const cms = dxm._cms;
    const visibilityType = (() => {
        const v = String(visibility).toLowerCase();
        if (v === "deleted") return cms.Util.VisibilityType.Deleted;
        if (v === "hidden") return cms.Util.VisibilityType.Hidden;
        return cms.Util.VisibilityType.Normal;
    })();
    const pageSize = 50;
    const makeRequest = page => new cms.Asset.PagedRequest(
        id, 0, page, true, true, cms.Util.OrderType.NotSet, pageSize, false, "", visibilityType
    );

    const firstResult = await cms.Asset.paged(makeRequest(0));
    const filterFn = filter
        ? a => (a.label ?? "").toLowerCase().includes(String(filter).toLowerCase())
        : () => true;

    const counts = {
        normal: firstResult.normalCount,
        deleted: firstResult.deletedCount,
        hidden: firstResult.hiddenCount,
    };
    const totalForVisibility = (() => {
        const v = String(visibility).toLowerCase();
        if (v === "deleted") return counts.deleted ?? firstResult.normalCount;
        if (v === "hidden") return counts.hidden ?? firstResult.normalCount;
        return counts.normal;
    })();

    const all = firstResult.assets.filter(filterFn).map(a => mapAsset(cms, a));
    const totalPages = Math.ceil((totalForVisibility ?? 0) / pageSize);

    for (let page = 1; page < totalPages; page++) {
        const result = await cms.Asset.paged(makeRequest(page));
        all.push(...result.assets.filter(filterFn).map(a => mapAsset(cms, a)));
    }

    return all;
}

export async function listFields(dxm, id) {
    await dxm._ensureLoggedIn();
    const result = await dxm._cms.Asset.fields(id);
    return result.fields.map(f => ({ name: f.name, value: f.value }));
}

export async function setFields(dxm, id, fields) {
    await dxm._ensureLoggedIn();
    const request = new dxm._cms.Asset.UpdateRequest(id, fields, []);
    await dxm._cms.Asset.update(request);
}

export async function deleteFields(dxm, id, fieldNames) {
    await dxm._ensureLoggedIn();
    const request = new dxm._cms.Asset.UpdateRequest(id, {}, fieldNames);
    await dxm._cms.Asset.update(request);
}

export async function setCode(dxm, id, code) {
    await dxm._ensureLoggedIn();
    const request = new dxm._cms.Asset.UpdatePluginBodyRequest(id, code, false);
    await dxm._cms.Asset.updatePluginBody(request);
}

export async function deleteAsset(dxm, id) {
    await dxm._ensureLoggedIn();
    await dxm._cms.Asset.delete(id);
}

export async function undeleteAsset(dxm, id) {
    await dxm._ensureLoggedIn();
    await dxm._cms.Asset.undelete(id);
}

export async function branchAsset(dxm, id) {
    await dxm._ensureLoggedIn();
    const result = await dxm._cms.Asset.branch(id);
    return mapAsset(dxm._cms, result.asset);
}

export async function moveAsset(dxm, id, destinationFolderId) {
    await dxm._ensureLoggedIn();
    const request = new dxm._cms.Asset.MoveRequest(id, destinationFolderId);
    return await dxm._cms.Asset.move(request);
}

export async function renameAsset(dxm, id, newName) {
    await dxm._ensureLoggedIn();
    const request = new dxm._cms.Asset.RenameRequest(id, newName);
    return await dxm._cms.Asset.rename(request);
}

export async function createAsset(dxm, name, folderId, { modelId = -1, templateId = 0, workflowId = 0 } = {}) {
    await dxm._ensureLoggedIn();
    const cms = dxm._cms;
    const request = new cms.Asset.CreateRequest(name, folderId, modelId, 2, 0, templateId, workflowId);
    const result = await cms.Asset.create(request);
    return mapAsset(cms, result.asset);
}

export async function createFolder(dxm, name, folderId, { modelId = -1, templateId = 0, workflowId = 0 } = {}) {
    await dxm._ensureLoggedIn();
    const cms = dxm._cms;
    const request = new cms.Asset.CreateRequest(name, folderId, modelId, 4, 0, templateId, workflowId);
    const result = await cms.Asset.create(request);
    return mapAsset(cms, result.asset);
}

export async function createFolderWithModel(dxm, name, folderId, modelId) {
    await dxm._ensureLoggedIn();
    const cms = dxm._cms;
    const request = new cms.Asset.CreateFolderWithModelRequest(name, folderId, modelId);
    const result = await cms.Asset.createFolderWithModel(request);
    return mapAsset(cms, result.asset);
}

export async function createProject(dxm, name, folderId, libraryName, installComponentLibrary, componentLibraryVersion, rebuildSite) {
    await dxm._ensureLoggedIn();
    const cms = dxm._cms;
    const request = new cms.Asset.CreateProjectRequest(
        name, folderId, libraryName, !!installComponentLibrary, componentLibraryVersion ?? "", !!rebuildSite
    );
    const result = await cms.Asset.createProject(request);
    return mapAsset(cms, result.asset);
}

export async function createSiteRoot(dxm, name, folderId, installCL, rebuildCL, versionCL) {
    await dxm._ensureLoggedIn();
    const cms = dxm._cms;
    const request = new cms.Asset.CreateSiteRootRequest(
        name, folderId, !!installCL, !!rebuildCL, versionCL ?? ""
    );
    const result = await cms.Asset.createSiteRoot(request);
    return mapAsset(cms, result.asset);
}

export async function createLibraryReference(dxm, name, folderId, libraryId) {
    await dxm._ensureLoggedIn();
    const cms = dxm._cms;
    const request = new cms.Asset.CreateLibraryReferenceRequest(name, folderId, libraryId);
    const result = await cms.Asset.createLibraryReference(request);
    return mapAsset(cms, result.asset);
}

export async function logMessage(dxm, message, assetId) {
    await dxm._ensureLoggedIn();
    return await dxm._cms.Asset.log(message, assetId ?? "");
}
