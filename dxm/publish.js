export async function getPublishLinks(dxm, id) {
    await dxm._ensureLoggedIn();
    return await dxm._cms.Asset.getPublishLinks(id);
}

export async function publishAssets(dxm, ids, skipDependencies = false) {
    await dxm._ensureLoggedIn();
    const cms = dxm._cms;
    const idArray = Array.isArray(ids) ? ids : [ids];
    const request = new cms.Asset.PublishRequest(idArray, !!skipDependencies);
    return await cms.Asset.publish(request);
}

export async function republishAssets(dxm, ids, publishingServerId, skipDependencies = false) {
    await dxm._ensureLoggedIn();
    const cms = dxm._cms;
    const idArray = Array.isArray(ids) ? ids : [ids];
    const request = new cms.Asset.PublishRefreshRequest(idArray, publishingServerId, !!skipDependencies);
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
