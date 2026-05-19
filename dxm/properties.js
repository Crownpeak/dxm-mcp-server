export async function listAttachments(dxm, id) {
    await dxm._ensureLoggedIn();
    return await dxm._cms.AssetProperties.attachments(id);
}

export async function readSiteRoot(dxm, id) {
    await dxm._ensureLoggedIn();
    return await dxm._cms.AssetProperties.readSiteRoot(id);
}

export async function setModel(dxm, ids, modelId) {
    await dxm._ensureLoggedIn();
    const idArray = Array.isArray(ids) ? ids : [ids];
    return await dxm._cms.AssetProperties.setModel(idArray, modelId);
}

export async function setTemplate(dxm, ids, templateId, isDeveloperTemplate = false, templateLanguage) {
    await dxm._ensureLoggedIn();
    const cms = dxm._cms;
    const idArray = Array.isArray(ids) ? ids : [ids];
    const langValue = templateLanguage ?? cms.Util.TemplateLanguageType.CSharp;
    return await cms.AssetProperties.setTemplate(idArray, templateId, !!isDeveloperTemplate, langValue);
}

export async function setWorkflow(dxm, ids, workflowId) {
    await dxm._ensureLoggedIn();
    const idArray = Array.isArray(ids) ? ids : [ids];
    return await dxm._cms.AssetProperties.setWorkflow(idArray, workflowId);
}
