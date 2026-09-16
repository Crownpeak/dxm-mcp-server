// Lightweight test helpers. Real `crownpeak-dxm-accessapi-helper` is never instantiated —
// domain functions take a `dxm` object and reach in via `_cms`, so we hand them a stub.

export function makeFakeCms(overrides = {}) {
    // `Util` is merged rather than replaced so a test can stub `Util.makeCall` (used by the
    // version-history functions, which call the helper's generic primitive directly) without
    // having to restate every enum constant.
    const { Util: utilOverrides, ...rest } = overrides;
    return {
        Util: {
            AssetType: { File: 2, Folder: 4, Project: 6, Template: 11 },
            VisibilityType: { Normal: 0, Deleted: 1, Hidden: 2 },
            OrderType: { NotSet: 0 },
            TemplateLanguageType: { CSharp: 0 },
            ...utilOverrides
        },
        Asset: {},
        AssetProperties: {},
        Workflow: {},
        User: {},
        Report: {},
        ...rest
    };
}

export function makeFakeDxm(cms = makeFakeCms()) {
    let ensureCalls = 0;
    const dxm = {
        _cms: cms,
        _credentials: { sentinel: true },
        _authenticatedFor: null,
        get ensureLoginCalls() { return ensureCalls; },
        async _ensureLoggedIn() { ensureCalls += 1; }
    };
    return dxm;
}
