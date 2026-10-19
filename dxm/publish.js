import { responseData } from "./util.js";

export async function getPublishLinks(dxm, id) {
    await dxm._ensureLoggedIn();
    return await dxm._cms.Asset.getPublishLinks(id);
}

// Dependencies are only included when asked for. The API's flag is skipDependencies, so it's
// always sent, as the inverse of includeDependencies (the tools used to expose skip_dependencies
// defaulting to false, which included them). The same rule applies to routing and workflow
// commands (dxm/workflow.js).
export async function publishAssets(dxm, ids, includeDependencies = false) {
    await dxm._ensureLoggedIn();
    const cms = dxm._cms;
    const idArray = Array.isArray(ids) ? ids : [ids];
    const request = new cms.Asset.PublishRequest(idArray, !includeDependencies);
    return await cms.Asset.publish(request);
}

export async function republishAssets(dxm, ids, publishingServerId, includeDependencies = false) {
    await dxm._ensureLoggedIn();
    const cms = dxm._cms;
    const idArray = Array.isArray(ids) ? ids : [ids];
    const request = new cms.Asset.PublishRefreshRequest(idArray, publishingServerId, !includeDependencies);
    return await cms.Asset.publishRefresh(request);
}

// The helper has no wrapper for this endpoint, so it goes through the generic `makeCall`.
export const ACTIVITY_SUMMARY_PATH = "/Publish/ActivitySummary";

// Fields copied off each publishing-session row. An allow-list rather than a spread, for the same
// reason as `viewInput`: this goes straight into an LLM context, and the response envelope also
// carries unrelated data (job payloads, preferences, permissions) that a spread would pass along.
function mapSession(s) {
    const done = !s.isActive && !s.isInitializing;
    return {
        id: s.id,
        status: s.displayStatus,
        // "done" is the thing a caller polling for completion actually wants; derive it once here
        // instead of making every caller combine the flags.
        done,
        isSuccessful: s.isSuccessful,
        isCanceled: !!(s.isCanceledByUser || s.isCanceledBySystem),
        stage: s.activeStage,
        action: s.activeAction,
        message: s.activeMessage || null,
        originalAssetId: s.originalAssetId,
        currentAssetId: s.currentAssetId,
        files: s.files,
        documents: s.documents,
        errors: s.errors,
        processed: s.processedPriority,
        total: s.totalPriority,
        processedDependencies: s.processedDependencies,
        totalDependencies: s.totalDependencies,
        startDate: s.startDate,
        // Only meaningful once done: observed live as "0001-01-01T00:00:00Z" while initializing,
        // then as an intermediate stage's timestamp mid-run.
        endDate: done ? s.endDate : null
    };
}

// Publishing activity for the authenticated user — the account every tool here acts as, so this
// covers publishes started by `publish_file`, `republish_file`, and workflow routing alike. Only
// `mySessions` is surfaced; other users' and system sessions are reported as counts. Pass
// `sessionId` to narrow to one session; the CMS returns only recent sessions, so an older id is
// reported as not found rather than as an error. Pass `assetId` to narrow to sessions started for
// that asset — the way to find a publish triggered by routing, since `/Asset/Route` returns no
// session id.
export async function publishingActivitySummary(dxm, { sessionId, assetId } = {}) {
    await dxm._ensureLoggedIn();
    const cms = dxm._cms;
    const response = await cms.Util.makeCall(cms, ACTIVITY_SUMMARY_PATH, {});
    const activity = response.activity ?? {};
    const mine = activity.mySessions ?? {};
    const sessions = (mine.sessions ?? []).map(mapSession);
    const activeCount = sessions.filter(s => !s.done).length;
    const summary = {
        // Derived rather than taken from `mySessions.isPublishing`, which stayed false for the
        // first ~40s of a session that was already "In Progress" in a live run.
        isPublishing: activeCount > 0,
        activeCount,
        otherUserSessionCount: activity.otherUserSessions?.sessions?.length ?? 0,
        systemSessionCount: activity.systemSessions?.sessions?.length ?? 0
    };
    if (sessionId !== undefined && sessionId !== null) {
        const session = sessions.find(s => s.id === sessionId) ?? null;
        return { ...summary, sessionId, found: session !== null, session };
    }
    if (assetId !== undefined && assetId !== null) {
        return { ...summary, assetId, sessions: sessions.filter(s => s.originalAssetId === assetId) };
    }
    return { ...summary, sessions };
}

// No helper wrapper for this one either.
export const FTP_SERVERS_PATH = "/settings/publishing/export-ftp";

// The FTP publishing servers (connectors) that packages publish through. Allow-listed: each entry
// also carries the FTP username, and a password field (null on CPUK from this endpoint, but it
// is the same record shape packagessettings returns, so it's never trusted to stay null).
export async function ftpServers(dxm) {
    await dxm._ensureLoggedIn();
    const cms = dxm._cms;
    const data = responseData(await cms.Util.makeCall(cms, FTP_SERVERS_PATH, {}), "Could not read the FTP servers");
    const servers = (Array.isArray(data.ftpServers) ? data.ftpServers : [])
        .filter(s => !s.isDeleted)
        .map(s => ({
            id: s.id,
            name: s.name,
            hostname: s.hostname || null,
            rootPath: s.rootPath || null,
            secureMode: s.secureMode,
            activeMode: s.activeMode,
            safeWrite: s.safeWrite,
            inUse: s.inUse
        }));
    return { ftpServers: servers };
}

// The helper has no wrapper for this endpoint either.
export const PACKAGES_SETTINGS_PATH = "/settings/publishing/packagessettings";

// The lists the packages' ids point into, by the field that points. Connectors (connectorList)
// can be in any of the server lists; the others each have their own.
const CONNECTOR_LISTS = [
    ["ftpServers", "FTP"], ["absServers", "Azure Blob Storage"], ["s3Servers", "S3"],
    ["gcsServers", "Google Cloud Storage"], ["httpServers", "HTTP"], ["odbcServers", "ODBC"]
];

// Only ever { id, name, type } from those lists. The server entries themselves carry secrets
// (verified on CPUK: ftpServers[].password, httpServers[].httpPassword,
// absServers[].azureStorageAccountAccessKey), so nothing else of theirs is copied.
function lookup(response, lists) {
    const byId = new Map();
    for (const [key, type] of lists) {
        for (const s of Array.isArray(response[key]) ? response[key] : []) {
            if (!s?.isDeleted && !byId.has(s.id)) byId.set(s.id, { id: s.id, name: s.name ?? null, type });
        }
    }
    return id => byId.get(id) ?? { id, name: null, type: null };
}

// The publishing packages: where publishing for each site goes (e.g. "... Live" / "... Stage").
// The endpoint is the whole publishing-settings page (~30 KB on CPUK) and most of it must not
// reach a model: the server lists' credentials (see `lookup`), group permissions and user lists.
// So each package is allow-listed (dropping the UI's isInserted/isModified edit flags), and the
// ids it points at are resolved to names.
export async function publishingPackages(dxm) {
    await dxm._ensureLoggedIn();
    const cms = dxm._cms;
    const response = await cms.Util.makeCall(cms, PACKAGES_SETTINGS_PATH, {});
    responseData(response, "Could not read the publishing packages");
    const connector = lookup(response, CONNECTOR_LISTS);
    // 0 and -1 both mean "none" in these fields.
    const optional = (lists, id) => (id > 0 ? lookup(response, lists)(id) : null);
    const packages = (Array.isArray(response.packages) ? response.packages : [])
        .filter(p => !p.isDeleted)
        .map(p => ({
            id: p.id,
            name: p.name,
            enabled: p.enabled,
            hostName: p.configuredHostName || null,
            additionalHostnames: p.additionalHostnames || null,
            path: p.configuredPath || null,
            https: p.domainHTTPS,
            encodeUTF8: p.encodeUTF8,
            includeInAnalytics: p.includeInAnalytics,
            state: p.packageState,
            connectors: (p.connectorList ?? []).filter(c => !c.isDeleted).map(c => connector(c.id)),
            searchG2: optional([["searchG2Servers", "Search G2"]], p.searchG2Id),
            caasCollection: optional([["caaSCollections", "CaaS"]], p.caaSCollectionId),
            smartSearchDataGenerator: optional([["smartSearchDataGenerators", "Smart Search"]], p.smartSearchDataGeneratorId)
        }));
    return { packages };
}
