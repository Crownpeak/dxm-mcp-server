// Lightweight test helpers. Real `crownpeak-dxm-accessapi-helper` is never instantiated —
// domain functions take a `dxm` object and reach in via `_cms`, so we hand them a stub.

export function makeFakeCms(overrides = {}) {
    // `Util` is merged rather than replaced so a test can override one enum (or stub a `Util`
    // method) without having to restate every other enum constant.
    const { Util: utilOverrides, ...rest } = overrides;
    return {
        Util: {
            AssetType: { File: 2, Folder: 4, Project: 6, Template: 11 },
            VisibilityType: { Normal: 0, Deleted: 1, Hidden: 2 },
            OrderType: { NotSet: 0 },
            // Matches the helper's real value. It was 0 here, which made "set to C#" impossible to
            // tell apart from "left at the 0 default" in the create-template tests.
            TemplateLanguageType: { CSharp: 1 },
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
