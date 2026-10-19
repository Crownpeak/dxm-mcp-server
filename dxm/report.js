import { mapAsset, responseData } from "./util.js";

export async function publishingErrors(dxm) {
    await dxm._ensureLoggedIn();
    return (await dxm._cms.Report.publishingErrors()).assetList.map(a => mapAsset(dxm._cms, a));
}

export async function siteSummary(dxm) {
    await dxm._ensureLoggedIn();
    return responseData(await dxm._cms.Report.siteSummary(), "Could not read the site summary");
}

// The system audit history. No helper wrapper, so it goes through the generic `makeCall`.
export const AUDIT_REPORT_PATH = "/Report/auditsystemreport";
// actionId 0 is every action except Custom; Custom (100) - what template code logs - comes back
// only when asked for by itself.
export const AUDIT_ACTION_ALL = 0;
export const AUDIT_ACTION_CUSTOM = 100;
export const AUDIT_MAX_PAGE_SIZE = 500;
const AUDIT_DEFAULT_PAGE_SIZE = 50;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export const AUDIT_ACTIONS_PATH = "/Report/auditactions";

// The audit action ids and names (~150 on CPUK, e.g. 16 "Logged In", 100 "Custom"), as a Map of
// id -> name. They're fixed by the CMS, so they're fetched once and kept on the Dxm instance -
// keyed by server and instance, so switching profiles to another CMS fetches its own list. A
// failed fetch isn't kept, so the next call tries again.
export async function auditActions(dxm) {
    await dxm._ensureLoggedIn();
    const cms = dxm._cms;
    const key = `${cms.host}/${cms.instance}`;
    if (dxm._auditActionsCache?.key !== key) {
        const promise = (async () => {
            const data = responseData(await cms.Util.makeCall(cms, AUDIT_ACTIONS_PATH, {}), "Could not read the audit actions");
            return new Map((Array.isArray(data.actions) ? data.actions : []).map(a => [a.id, a.name]));
        })();
        dxm._auditActionsCache = { key, promise };
        promise.catch(() => { if (dxm._auditActionsCache?.promise === promise) dxm._auditActionsCache = null; });
    }
    return dxm._auditActionsCache.promise;
}

// An action given as an id (number or numeric string) or a name. Names match case-insensitively,
// exactly first, then as a unique part of a name ("login failed" -> 138 "Login Failed",
// "deleted file" -> 25). Returns { id, name }.
export async function resolveAuditAction(dxm, action) {
    const actions = await auditActions(dxm);
    const text = String(action).trim();
    if (/^\d+$/.test(text)) {
        const id = Number(text);
        if (!actions.has(id)) throw new Error(`Unknown audit action id ${id}.`);
        return { id, name: actions.get(id) };
    }
    const wanted = text.toLowerCase();
    const all = [...actions].map(([id, name]) => ({ id, name }));
    const exact = all.filter(a => a.name.toLowerCase() === wanted);
    const matches = exact.length ? exact : all.filter(a => a.name.toLowerCase().includes(wanted));
    if (matches.length === 1) return matches[0];
    if (matches.length === 0) throw new Error(`No audit action is called "${text}".`);
    throw new Error(`"${text}" matches several audit actions: ${matches.map(a => `${a.id} ${a.name}`).join(", ")}. Use the full name or the id.`);
}

// Fields copied off each row: an allow-list, like every other pass-through. Swagger's
// SystemAuditData also has dataFilters and dateString (null on CPUK) - left out. assetId is -1 or
// 0 for entries about no asset (logins, reports), which become null. Numbers are given names:
// action from the action list (the row's own text is inconsistent, e.g. "custom", "refreshed
// site"), assetType from the helper's AssetType.
function mapAuditEntry(e, actionNames, assetTypeNames) {
    return {
        date: e.date,
        action: actionNames.get(e.actionId) ?? e.action,
        actionId: e.actionId,
        description: e.description ?? null,
        extra: e.extra ?? null,
        user: e.user ?? null,
        userId: e.userId ?? null,
        assetId: e.assetId > 0 ? e.assetId : null,
        label: e.label ?? null,
        folderId: e.folderId > 0 ? e.folderId : null,
        assetType: e.assetType === null || e.assetType === undefined ? null : (assetTypeNames[e.assetType] ?? e.assetType),
        assetIsDeleted: e.assetIsDeleted ?? false,
        isContentLoader: e.isContentLoader ?? false
    };
}

// Verified on CPUK:
// - sortOptions is required: without it the CMS answers conWS_GeneralError "Object reference not
//   set to an instance of an object". sortOption itself is ignored (every value, even a bogus
//   one, sorts by date); only isAscending matters.
// - Pages are 1-based: page 0 returns page 1 again.
// - Dates are optional (all history, ~3 million rows on CPUK). The end date includes that whole
//   day: the CMS cuts off at endDate + 24h, so a time of day would push it into the next day.
//   Hence date-only strings.
// - Every call is itself audited, as "Audited System" (72), "Viewed the system's history".
function checkAuditFilters({ startDate, endDate, page = 1, pageSize = AUDIT_DEFAULT_PAGE_SIZE } = {}) {
    for (const [name, value] of [["startDate", startDate], ["endDate", endDate]]) {
        if (value !== undefined && value !== null && !DATE_ONLY.test(value)) {
            throw new Error(`${name} must be a date as YYYY-MM-DD (got "${value}"); the end date includes that whole day.`);
        }
    }
    if (!Number.isInteger(page) || page < 1) throw new Error(`page must be 1 or more (got ${page}); pages are 1-based.`);
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > AUDIT_MAX_PAGE_SIZE) {
        throw new Error(`pageSize must be between 1 and ${AUDIT_MAX_PAGE_SIZE} (got ${pageSize}).`);
    }
}

async function runAuditReport(dxm, actionId, {
    startDate, endDate, userId, assetId, label, search,
    page = 1, pageSize = AUDIT_DEFAULT_PAGE_SIZE, oldestFirst = false
} = {}) {
    const cms = dxm._cms;
    const body = {
        actionId,
        currentPage: page,
        pageSize,
        sortOptions: { sortOption: "Date", isAscending: !!oldestFirst }
    };
    if (startDate) body.startDate = startDate;
    if (endDate) body.endDate = endDate;
    if (userId !== undefined && userId !== null) body.userId = userId;
    if (assetId !== undefined && assetId !== null) body.assetId = assetId;
    if (label) body.label = label;
    if (search) body.searchTerm = search;
    const data = responseData(await cms.Util.makeCall(cms, AUDIT_REPORT_PATH, body), "Could not read the audit report");
    // Names are a convenience: if the action list can't be read, entries keep the CMS's own text.
    const actionNames = await auditActions(dxm).catch(() => new Map());
    const assetTypeNames = Object.fromEntries(Object.entries(cms.Util.AssetType ?? {}).map(([k, v]) => [v, k]));
    const entries = Array.isArray(data.responseData) ? data.responseData.map(e => mapAuditEntry(e, actionNames, assetTypeNames)) : [];
    return { total: data.total ?? entries.length, page, pageSize, entries };
}

// Every action except Custom, or one action by id or name. Custom (100) is refused here because
// actionId 0 never includes it and customAuditReport is the way to it.
export async function auditReport(dxm, { action, ...filters } = {}) {
    checkAuditFilters(filters);
    await dxm._ensureLoggedIn();
    if (action === undefined || action === null || action === "" || String(action).trim() === String(AUDIT_ACTION_ALL)) {
        return runAuditReport(dxm, AUDIT_ACTION_ALL, filters);
    }
    const resolved = await resolveAuditAction(dxm, action);
    if (resolved.id === AUDIT_ACTION_CUSTOM) {
        throw new Error("Custom entries (action 100) come from custom_audit_report, which takes the same filters.");
    }
    return { action: resolved, ...(await runAuditReport(dxm, resolved.id, filters)) };
}

// The Custom entries: what log_message writes, and what template code logs with Util.Log.
export async function customAuditReport(dxm, filters = {}) {
    checkAuditFilters(filters);
    await dxm._ensureLoggedIn();
    return runAuditReport(dxm, AUDIT_ACTION_CUSTOM, filters);
}

// What publishing did with an asset, file by file. No helper wrapper. The "-all" variant takes
// only these three filters and has no paging; /Report/assetpublishhistory is the paged one.
export const ASSET_PUBLISH_HISTORY_PATH = "/Report/asset-publish-history-all";
export const PUBLISH_HISTORY_DEFAULT_LIMIT = 100;
export const PUBLISH_HISTORY_MAX_LIMIT = 1000;

// Allow-listed. "" becomes null; userId 0 (every CPUK row, alongside null user and label)
// becomes null. duration is in seconds (endDate - date), transferSize in bytes.
function mapPublishHistory(h) {
    return {
        date: h.date,
        endDate: h.endDate ?? null,
        durationSeconds: h.duration ?? null,
        sessionId: h.sessionId,
        assetId: h.assetId,
        action: h.action ?? null,
        reason: h.reason || null,
        subReason: h.subReason || null,
        errorText: h.errorText || null,
        filename: h.filename || null,
        packageName: h.packageName || null,
        connectorId: h.connectorId ?? null,
        connectorName: h.connectorName || null,
        transferSize: h.transferSize ?? null,
        publisher: h.pubHostName || null,
        label: h.label || null,
        user: h.user || null,
        userId: h.userId > 0 ? h.userId : null
    };
}

// Verified on CPUK:
// - With no filter the CMS returns history: null, so one of the three is required.
// - fileName is a case-insensitive substring of the row's filename: the published path (e.g.
//   /wwwroot-demo/.../test.aspx), or the CMS path for a template error.
// - Rows come back in no useful order (not by date, not by session), so they're sorted here,
//   newest first. One file published through two connectors is two rows, one per connector.
// - There's no paging and an asset's history only grows, so `limit` caps what's returned;
//   total says how many there were.
export async function assetPublishHistory(dxm, { assetId, sessionId, fileName, limit = PUBLISH_HISTORY_DEFAULT_LIMIT, oldestFirst = false } = {}) {
    const has = v => v !== undefined && v !== null && v !== "";
    if (!has(assetId) && !has(sessionId) && !has(fileName)) {
        throw new Error("Give at least one of assetId, sessionId or fileName: with none the CMS returns nothing.");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > PUBLISH_HISTORY_MAX_LIMIT) {
        throw new Error(`limit must be between 1 and ${PUBLISH_HISTORY_MAX_LIMIT} (got ${limit}).`);
    }
    await dxm._ensureLoggedIn();
    const cms = dxm._cms;
    const body = {};
    if (has(assetId)) body.assetId = assetId;
    if (has(sessionId)) body.sessionId = sessionId;
    if (has(fileName)) body.fileName = fileName;
    const data = responseData(await cms.Util.makeCall(cms, ASSET_PUBLISH_HISTORY_PATH, body), "Could not read the asset publish history");
    const rows = (Array.isArray(data.history) ? data.history : []).map(mapPublishHistory);
    const time = r => Date.parse(r.date) || 0;
    rows.sort((a, b) => (oldestFirst ? time(a) - time(b) : time(b) - time(a)) || (oldestFirst ? a.sessionId - b.sessionId : b.sessionId - a.sessionId));
    const history = rows.slice(0, limit);
    return { total: rows.length, returned: history.length, truncated: rows.length > limit, history };
}
