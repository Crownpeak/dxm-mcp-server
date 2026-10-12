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

// `postProcess` asks the CMS to run the asset's post_input.aspx and post_save.aspx over the new
// content after storing it. The helper's UpdateRequest exposes these as two separate flags, but
// they are surfaced here (and in the tools) as one: post_input normalises what was submitted and
// post_save acts on the normalised result, so running the second without the first would process
// content the CMS considers un-normalised. A caller that genuinely needs them apart should build
// the UpdateRequest itself rather than widen this.
//
// Defaults to false because post-save handlers are arbitrary template code whose side effects
// reach past this asset — they can rewrite sibling fields, touch other assets, or kick off
// publishing. An edit should only trigger that when the caller asked for it.
export async function setFields(dxm, id, fields, postProcess = false) {
    await dxm._ensureLoggedIn();
    const run = !!postProcess;
    const request = new dxm._cms.Asset.UpdateRequest(id, fields, [], run, run);
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

// The `subtype` sent to /Asset/Create, which marks a new file or folder as a special CMS asset
// (a template, a project, a site root, ...). Mirrors the helper's Util.AssetSubType; it is
// restated here because the tool schemas are built statically at registration time, before any
// CmsApi instance exists to read the helper's copy from. test/assets.test.js asserts the two stay
// identical, so drift in either direction fails the suite.
export const ASSET_SUBTYPE = Object.freeze({
    None: 0,
    DeveloperTemplate: 1,
    TemplateFile: 17,
    Project: 32,
    Library: 64,
    SiteRoot: 128,
    TemplateFolder: 256,
    Template: 512,
    Workflow: 1024,
    State: 2048,
    ModelFolder: 4096,
    ComponentFramework: 8192
});

// Which subtypes are meaningful for which kind of asset. A file can only be an ordinary file or a
// template file of some kind; every other subtype describes a container, so it only applies to a
// folder - and the two template-file subtypes are exactly the ones a folder can't take.
const pick = (...keys) => Object.freeze(Object.fromEntries(keys.map(k => [k, ASSET_SUBTYPE[k]])));
export const FILE_SUBTYPES = pick("None", "DeveloperTemplate", "TemplateFile");
export const FOLDER_SUBTYPES = pick(
    "None", "Project", "Library", "SiteRoot", "TemplateFolder", "Template",
    "Workflow", "State", "ModelFolder", "ComponentFramework"
);

// The tool schemas already restrict `type` to the right subset, but the domain functions are
// also called directly, and the CMS's behaviour on a mismatched subtype (a folder flagged as a
// template file, say) is unknown - so refuse it here rather than find out on a live instance.
function checkSubtype(subtype, allowed, kind) {
    const values = Object.values(allowed);
    if (!values.includes(subtype)) {
        const list = Object.entries(allowed).map(([k, v]) => `${v} (${k})`).join(", ");
        throw new Error(`Subtype ${subtype} is not valid for a ${kind}. Allowed: ${list}`);
    }
}

// Two subtypes create template machinery rather than plain content, and the CMS needs extra
// fields in the /Asset/Create body for each:
//   - a Template File (17) is a code file, so it needs devTemplateLanguage set to C#;
//   - a Template folder (512) also needs devTemplateLanguage, plus createChildren: true, which asks
//     the CMS to create the template's child assets along with the folder.
const NEEDS_TEMPLATE_LANGUAGE = new Set([ASSET_SUBTYPE.TemplateFile, ASSET_SUBTYPE.Template]);
const NEEDS_CHILDREN = new Set([ASSET_SUBTYPE.Template]);

// File creation sends the body of a known-good /Asset/Create call (one that succeeded where the
// helper's defaults failed): modelId 0 rather than -1, devTemplateLanguage -1 when the file is not
// a template (0 is not a TemplateLanguageType value - the helper defines only CSharp = 1), and the
// runNew / createChildren booleans the helper's AssetCreateRequest omits entirely. Swagger confirms
// all four fields exist but documents no defaults, so which difference mattered is unknown -
// change any of these only with a live create to check against.
const FILE_DEFAULT_MODEL_ID = 0;
const FILE_NO_TEMPLATE_LANGUAGE = -1;
const FILE_EXTRA_FIELDS = Object.freeze({ runNew: true, createChildren: false });

// Folders were not reported broken, so they keep their original body: modelId -1,
// devTemplateLanguage 0, and no runNew / createChildren unless the subtype calls for them.
const FOLDER_NO_TEMPLATE_LANGUAGE = 0;

function buildCreateRequest(cms, name, folderId, assetType, { modelId, templateId, workflowId, subtype }, { noLanguage, extraFields = {} }) {
    const devTemplateLanguage = NEEDS_TEMPLATE_LANGUAGE.has(subtype) ? cms.Util.TemplateLanguageType.CSharp : noLanguage;
    const request = new cms.Asset.CreateRequest(
        name, folderId, modelId, assetType, devTemplateLanguage, templateId, workflowId, subtype
    );
    const extra = { ...extraFields, ...(NEEDS_CHILDREN.has(subtype) ? { createChildren: true } : {}) };
    if (Object.keys(extra).length === 0) return request;
    // The helper's AssetCreateRequest has no runNew / createChildren fields, but Asset.create only
    // ever calls request.toJson(), so extend the body it produces rather than re-stating it. If the
    // helper grows these natively, pass them through the constructor instead.
    return { toJson: () => ({ ...request.toJson(), ...extra }) };
}

export async function createAsset(dxm, name, folderId, { modelId = FILE_DEFAULT_MODEL_ID, templateId = 0, workflowId = 0, subtype = 0 } = {}) {
    checkSubtype(subtype, FILE_SUBTYPES, "file");
    await dxm._ensureLoggedIn();
    const cms = dxm._cms;
    const request = buildCreateRequest(cms, name, folderId, 2, { modelId, templateId, workflowId, subtype }, {
        noLanguage: FILE_NO_TEMPLATE_LANGUAGE, extraFields: FILE_EXTRA_FIELDS
    });
    const result = await cms.Asset.create(request);
    return mapAsset(cms, result.asset);
}

export async function createFolder(dxm, name, folderId, { modelId = -1, templateId = 0, workflowId = 0, subtype = 0 } = {}) {
    checkSubtype(subtype, FOLDER_SUBTYPES, "folder");
    await dxm._ensureLoggedIn();
    const cms = dxm._cms;
    const request = buildCreateRequest(cms, name, folderId, 4, { modelId, templateId, workflowId, subtype }, {
        noLanguage: FOLDER_NO_TEMPLATE_LANGUAGE
    });
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
