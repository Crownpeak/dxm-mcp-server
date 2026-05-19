export async function compileLibrary(dxm, id) {
    await dxm._ensureLoggedIn();
    return await dxm._cms.Tools.recompileLibrary(id);
}

export async function compileProject(dxm, id) {
    await dxm._ensureLoggedIn();
    return await dxm._cms.Tools.recompileProject(id);
}

export async function compileTemplates(dxm, id) {
    await dxm._ensureLoggedIn();
    return await dxm._cms.Tools.recompileTemplates(id);
}
