export async function siteSummary(dxm) {
    await dxm._ensureLoggedIn();
    return await dxm._cms.Report.siteSummary();
}
