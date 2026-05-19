export async function listWorkflows(dxm) {
    await dxm._ensureLoggedIn();
    return await dxm._cms.Workflow.getList();
}

export async function getWorkflow(dxm, id) {
    await dxm._ensureLoggedIn();
    return await dxm._cms.Workflow.read(id);
}

export async function routeAsset(dxm, id, stateId) {
    await dxm._ensureLoggedIn();
    const cms = dxm._cms;
    const request = new cms.Asset.RouteRequest(id, stateId);
    return await cms.Asset.route(request);
}

export async function executeWorkflowCommand(dxm, assetId, commandId, skipDependencies = false) {
    await dxm._ensureLoggedIn();
    const cms = dxm._cms;
    const request = new cms.Asset.ExecuteWorkflowCommandRequest(assetId, commandId, !!skipDependencies);
    return await cms.Asset.executeWorkflowCommand(request);
}
