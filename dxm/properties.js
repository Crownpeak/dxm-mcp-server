// The version family delegates to the helper's `AssetProperties.allVersions` / `versionContent` /
// `revertToVersion` (added in helper 1.3.0), which own the endpoint paths and the API's quirks:
// 1-based paging, stripping the `-1` sentinel row the last page is padded with, ignoring the
// unreliable `totalCount`, and normalising `NewVersionId` to `newVersionId`. Don't reintroduce a
// `Util.makeCall` version of any of this here — it would be a second copy of those workarounds.
//
// revertToVersion lives in this module with the rest of the version family rather than in
// assets.js (despite its /Asset/ path) both because it shares the version-lookup guard below and
// because this codebase already groups by concept over endpoint path — see routeAsset, which sits
// in workflow.js even though it calls Asset.route.
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

export async function listVersions(dxm, id) {
    await dxm._ensureLoggedIn();
    // allVersions() walks every page for us and hands back one versions()-shaped response.
    const response = await dxm._cms.AssetProperties.allVersions(id);
    if (response.isSuccessful === false) {
        throw new Error(
            `Failed to read version history for asset ${id}: ${response.errorMessage || response.resultCode}`
        );
    }
    return (response.assetVersions ?? []).map(mapVersion);
}

// Resolves a requested version id against the asset's real history, throwing if it isn't there.
// This is a correctness guard, not a nicety: /Versions/Content ignores an unknown versionId and
// returns the asset's *current* content with resultCode conWS_Success, so an unvalidated call can
// hand back the wrong version's data with no error at all. RevertToVersion is assumed to be no
// more defensive, and there the cost of guessing wrong is a bad write rather than a bad read.
//
// The helper applies the same guard itself (it returns a failed response rather than throwing),
// but the callers below need the resolved row anyway to describe what they read or restored — so
// they resolve it here and pass `validate: false` to skip the helper's duplicate history fetch.
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

    const response = await cms.AssetProperties.versionContent(id, wanted, false);
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

    // The helper's `isConfirmed` defaults to true — the "yes, actually do it" path. The API also
    // accepts false, but what that returns is unverified (it was not probed, because probing it
    // means writing to a real asset), so the flag is deliberately not exposed as a tool parameter
    // or overridden here — the tool does one thing and does it for real.
    const response = await cms.AssetProperties.revertToVersion(id, wanted, false);
    if (response.isSuccessful === false) {
        throw new Error(
            `Failed to revert asset ${id} to version ${versionId}: ${response.errorMessage || response.resultCode}`
        );
    }
    // Reverting does not rewrite history — it appends a fresh version whose content is the old
    // one's, so the asset gains a version rather than losing any. The helper has already
    // normalised Swagger's PascalCase `NewVersionId` onto `newVersionId`; default to null so the
    // tool reports an explicit absence rather than undefined.
    const newVersionId = response.newVersionId ?? null;
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
