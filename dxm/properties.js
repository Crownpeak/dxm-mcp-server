// The helper exposes no wrapper for /AssetProperties/Versions* or /Asset/RevertToVersion, so the
// version functions call its generic `Util.makeCall` primitive directly — the same primitive
// `AssetProperties.attachments()` and its siblings use internally. Keeping it here rather than
// adding helper methods avoids coupling the MCP server to an unpublished helper build:
// package.json tracks the registry's ^1.2.0, so a fresh `npm install` would not pick up
// locally-added helper methods.
//
// revertToVersion lives in this module with the rest of the version family rather than in
// assets.js (despite its /Asset/ path) both because it shares the version-lookup guard below and
// because this codebase already groups by concept over endpoint path — see routeAsset, which sits
// in workflow.js even though it calls Asset.route.
const VERSIONS_PATH = "/AssetProperties/Versions/";
const VERSION_CONTENT_PATH = "/AssetProperties/Versions/Content";
const REVERT_TO_VERSION_PATH = "/Asset/RevertToVersion";
const VERSIONS_PAGE_SIZE = 50;
// Safety net on the paging loop; `totalCount` is not reliable enough to compute a page count from
// (see fetchVersionPage), so we page until exhaustion instead.
const MAX_VERSION_PAGES = 100;

function mapVersion(v) {
    return {
        versionId: v.versionId,
        assetId: v.assetId,
        label: v.label,
        comment: v.comment,
        // On the wire the field really is `modified_On` (capital O), and `name` is the *user* who
        // made the change, not the asset's name — renamed here so callers can't misread it.
        modifiedOn: v.modified_On,
        modifiedBy: v.name,
        versionType: v.versionType,
        statusId: v.statusId,
        change: v.change,
        storageId: v.storageId,
        mergeId: v.mergeId
    };
}

async function fetchVersionPage(dxm, assetId, currentPage) {
    const cms = dxm._cms;
    const response = await cms.Util.makeCall(cms, VERSIONS_PATH, {
        assetId,
        currentPage,
        pageSize: VERSIONS_PAGE_SIZE
    });
    if (response.isSuccessful === false) {
        throw new Error(
            `Failed to read version history for asset ${assetId}: ${response.errorMessage || response.resultCode}`
        );
    }
    // The endpoint pads the final page with a sentinel row whose versionId is -1. It also reports a
    // `totalCount` that disagrees with the number of real rows depending on pageSize, which is why
    // the caller pages to exhaustion rather than trusting it.
    return (response.assetVersions ?? []).filter(v => v.versionId !== -1);
}

export async function listVersions(dxm, id) {
    await dxm._ensureLoggedIn();
    const all = [];
    // Pages are 1-based: currentPage 0 returns an empty list *with a success result code* rather
    // than an error, so starting at 0 silently looks like "no version history".
    for (let page = 1; page <= MAX_VERSION_PAGES; page++) {
        const rows = await fetchVersionPage(dxm, id, page);
        all.push(...rows.map(mapVersion));
        if (rows.length < VERSIONS_PAGE_SIZE) break;
    }
    return all;
}

// Resolves a requested version id against the asset's real history, throwing if it isn't there.
// This is a correctness guard, not a nicety: /Versions/Content ignores an unknown versionId and
// returns the asset's *current* content with resultCode conWS_Success, so an unvalidated call can
// hand back the wrong version's data with no error at all. RevertToVersion is assumed to be no
// more defensive, and there the cost of guessing wrong is a bad write rather than a bad read.
async function resolveVersion(dxm, id, versionId) {
    const wanted = Number(versionId);
    const versions = await listVersions(dxm, id);
    const version = versions.find(v => v.versionId === wanted);
    if (!version) {
        const known = versions.map(v => v.versionId).join(", ") || "none";
        throw new Error(`Version ${versionId} not found on asset ${id}. Known version IDs: ${known}`);
    }
    return version;
}

export async function getVersion(dxm, id, versionId) {
    await dxm._ensureLoggedIn();
    const cms = dxm._cms;
    const wanted = Number(versionId);
    const version = await resolveVersion(dxm, id, wanted);

    const response = await cms.Util.makeCall(cms, VERSION_CONTENT_PATH, { assetId: id, versionId: wanted });
    if (response.isSuccessful === false) {
        throw new Error(
            `Failed to read version ${versionId} of asset ${id}: ${response.errorMessage || response.resultCode}`
        );
    }
    // Field shape matches listFields() so a caller can diff a version against the live asset.
    return {
        ...version,
        fields: (response.content ?? []).map(f => ({ name: f.name, value: f.value }))
    };
}

export async function revertToVersion(dxm, id, versionId) {
    await dxm._ensureLoggedIn();
    const cms = dxm._cms;
    const wanted = Number(versionId);
    // Same guard as getVersion — reverting to an id the asset has never had should fail loudly
    // rather than let the CMS decide what to do with it.
    const version = await resolveVersion(dxm, id, wanted);

    // `isConfirmed: true` is the "yes, actually do it" path. The API also accepts false, but what
    // that returns is unverified (it was not probed, because probing it means writing to a real
    // asset), so the flag is deliberately not exposed as a tool parameter — the tool does one
    // thing and does it for real.
    const response = await cms.Util.makeCall(cms, REVERT_TO_VERSION_PATH, {
        assetId: id,
        versionId: wanted,
        isConfirmed: true
    });
    if (response.isSuccessful === false) {
        throw new Error(
            `Failed to revert asset ${id} to version ${versionId}: ${response.errorMessage || response.resultCode}`
        );
    }
    // Reverting does not rewrite history — it appends a fresh version whose content is the old
    // one's, so the asset gains a version rather than losing any. Swagger declares this field as
    // PascalCase `NewVersionId` while every other response on this family comes back camelCase on
    // the wire; accept either rather than silently reporting undefined.
    const newVersionId = response.newVersionId ?? response.NewVersionId ?? null;
    return {
        assetId: id,
        revertedTo: version,
        newVersionId
    };
}

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
