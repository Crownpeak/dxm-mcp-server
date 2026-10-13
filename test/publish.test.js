import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { getPublishLinks, publishAssets, republishAssets, publishingActivitySummary, ACTIVITY_SUMMARY_PATH } from "../dxm/publish.js";
import { publishingSessionIds, publishResult } from "../dxm/tools/publish.js";
import { makeFakeCms, makeFakeDxm } from "./_helpers.js";

describe("getPublishLinks", () => {
    test("delegates to cms.Asset.getPublishLinks with the id", async () => {
        let captured;
        const cms = makeFakeCms({
            Asset: {
                getPublishLinks: async id => {
                    captured = id;
                    return { urls: [{ path: "https://example.com/", packageName: "live" }] };
                }
            }
        });
        const result = await getPublishLinks(makeFakeDxm(cms), 42);
        assert.equal(captured, 42);
        assert.equal(result.urls.length, 1);
    });

    test("calls _ensureLoggedIn before the request", async () => {
        const cms = makeFakeCms({
            Asset: { getPublishLinks: async () => ({ urls: [] }) }
        });
        const dxm = makeFakeDxm(cms);
        await getPublishLinks(dxm, 1);
        assert.equal(dxm.ensureLoginCalls, 1);
    });
});

describe("publishAssets", () => {
    function recordingCms() {
        let req;
        return {
            get req() { return req; },
            cms: makeFakeCms({
                Asset: {
                    PublishRequest: class { constructor(ids, skip) { Object.assign(this, { ids, skip }); } },
                    publish: async r => { req = r; return { ok: true }; }
                }
            })
        };
    }

    test("wraps a single numeric id in an array", async () => {
        const r = recordingCms();
        await publishAssets(makeFakeDxm(r.cms), 12);
        assert.deepEqual(r.req.ids, [12]);
    });

    test("passes an array through unchanged", async () => {
        const r = recordingCms();
        await publishAssets(makeFakeDxm(r.cms), [1, 2, 3]);
        assert.deepEqual(r.req.ids, [1, 2, 3]);
    });

    test("defaults skipDependencies to false and honors explicit true", async () => {
        const r = recordingCms();
        await publishAssets(makeFakeDxm(r.cms), [1]);
        assert.equal(r.req.skip, false);
        await publishAssets(makeFakeDxm(r.cms), [1], true);
        assert.equal(r.req.skip, true);
    });

    test("coerces truthy/falsy skipDependencies values to booleans", async () => {
        const r = recordingCms();
        await publishAssets(makeFakeDxm(r.cms), [1], "yes");
        assert.equal(r.req.skip, true);
        await publishAssets(makeFakeDxm(r.cms), [1], 0);
        assert.equal(r.req.skip, false);
    });
});

describe("republishAssets", () => {
    test("constructs PublishRefreshRequest with ids array, publishing server id, and skip flag", async () => {
        let req;
        const cms = makeFakeCms({
            Asset: {
                PublishRefreshRequest: class { constructor(ids, serverId, skip) { Object.assign(this, { ids, serverId, skip }); } },
                publishRefresh: async r => { req = r; return { ok: true }; }
            }
        });
        await republishAssets(makeFakeDxm(cms), 7, 99, true);
        assert.deepEqual(req.ids, [7]);
        assert.equal(req.serverId, 99);
        assert.equal(req.skip, true);
    });

    test("wraps single id in array even when skip is omitted", async () => {
        let req;
        const cms = makeFakeCms({
            Asset: {
                PublishRefreshRequest: class { constructor(ids, serverId, skip) { Object.assign(this, { ids, serverId, skip }); } },
                publishRefresh: async r => { req = r; return { ok: true }; }
            }
        });
        await republishAssets(makeFakeDxm(cms), 7, 99);
        assert.deepEqual(req.ids, [7]);
        assert.equal(req.skip, false);
    });
});

describe("publishingActivitySummary", () => {
    // A session row as observed on a live instance (camelCase on the wire, unlike Swagger).
    const row = (id, overrides = {}) => ({
        activeAction: "Workflow Remove", activeMessage: "", activeName: "Stage", activeStage: "Done",
        currentAssetId: 276861, displayStatus: "Completed", documents: 2, endDate: "2026-10-13T14:15:27.158Z",
        errors: 0, files: 2, id, isActive: false, isCanceledBySystem: false, isCanceledByUser: false,
        isInitializing: false, isStarving: false, isSuccessful: true, kBytes: 0, originalAssetId: 276861,
        originalAssetPath: null, processedDependencies: 0, processedPriority: 2, startDate: "2026-10-13T14:14:20.419Z",
        totalDependencies: 0, totalPriority: 2, userFullName: "Test User", userId: 102,
        ...overrides
    });

    function activityCms(sessions, extra = {}) {
        const calls = [];
        const cms = makeFakeCms({
            Util: {
                makeCall: async (api, path, body) => {
                    calls.push({ path, body });
                    return {
                        activity: {
                            mySessions: { isPublishing: sessions.some(s => s.isActive), sessions },
                            otherUserSessions: { sessions: [row(1)] },
                            systemSessions: { sessions: [] },
                            longRunningActivityDetails: [{ payload: "<RouteAssetRequest>...</RouteAssetRequest>" }]
                        },
                        cookie: ["session=secret"],
                        resultCode: "conWS_Success",
                        ...extra
                    };
                }
            }
        });
        return { cms, calls };
    }

    test("calls the ActivitySummary endpoint after logging in", async () => {
        const { cms, calls } = activityCms([]);
        const dxm = makeFakeDxm(cms);
        await publishingActivitySummary(dxm);
        assert.equal(dxm.ensureLoginCalls, 1);
        assert.deepEqual(calls, [{ path: ACTIVITY_SUMMARY_PATH, body: {} }]);
    });

    test("maps the user's sessions to an allow-listed shape with a derived done flag", async () => {
        const { cms } = activityCms([row(124984), row(124985, { isActive: true, displayStatus: "Publishing", endDate: null })]);
        const result = await publishingActivitySummary(makeFakeDxm(cms));
        assert.equal(result.isPublishing, true);
        assert.equal(result.activeCount, 1);
        assert.equal(result.otherUserSessionCount, 1);
        assert.equal(result.systemSessionCount, 0);
        assert.deepEqual(result.sessions.map(s => [s.id, s.done]), [[124984, true], [124985, false]]);
        assert.deepEqual(result.sessions[0], {
            id: 124984, status: "Completed", done: true, isSuccessful: true, isCanceled: false,
            stage: "Done", action: "Workflow Remove", message: null,
            originalAssetId: 276861, currentAssetId: 276861, files: 2, documents: 2, errors: 0,
            processed: 2, total: 2, processedDependencies: 0, totalDependencies: 0,
            startDate: "2026-10-13T14:14:20.419Z", endDate: "2026-10-13T14:15:27.158Z"
        });
    });

    test("a session still initializing is not done, and its placeholder end date is hidden", async () => {
        const { cms } = activityCms([row(7, { isInitializing: true, endDate: "0001-01-01T00:00:00Z" })]);
        const [session] = (await publishingActivitySummary(makeFakeDxm(cms))).sessions;
        assert.equal(session.done, false);
        assert.equal(session.endDate, null);
    });

    test("isPublishing follows the sessions, not the CMS's lagging flag", async () => {
        // Live: mySessions.isPublishing was false while a session reported "In Progress".
        const sessions = [row(8, { isActive: true, displayStatus: "In Progress" })];
        const cms = makeFakeCms({ Util: { makeCall: async () => ({ activity: { mySessions: { isPublishing: false, sessions } } }) } });
        const result = await publishingActivitySummary(makeFakeDxm(cms));
        assert.deepEqual([result.isPublishing, result.activeCount], [true, 1]);
    });

    test("narrows to the sessions started for one asset", async () => {
        const { cms } = activityCms([row(20, { originalAssetId: 5 }), row(21, { originalAssetId: 6 }), row(22, { originalAssetId: 5 })]);
        const result = await publishingActivitySummary(makeFakeDxm(cms), { assetId: 5 });
        assert.equal(result.assetId, 5);
        assert.deepEqual(result.sessions.map(s => s.id), [20, 22]);
    });

    test("never leaks cookies, job payloads, or user identities", async () => {
        const { cms } = activityCms([row(1)]);
        const text = JSON.stringify(await publishingActivitySummary(makeFakeDxm(cms)));
        assert.ok(!text.includes("secret"));
        assert.ok(!text.includes("RouteAssetRequest"));
        assert.ok(!text.includes("Test User"));
    });

    test("narrows to one session when a session id is given", async () => {
        const { cms } = activityCms([row(10), row(11, { errors: 3, isSuccessful: false })]);
        const result = await publishingActivitySummary(makeFakeDxm(cms), { sessionId: 11 });
        assert.equal(result.found, true);
        assert.equal(result.session.id, 11);
        assert.equal(result.session.errors, 3);
        assert.equal(result.sessions, undefined);
    });

    test("reports an unknown session id as not found rather than throwing", async () => {
        const { cms } = activityCms([row(10)]);
        const result = await publishingActivitySummary(makeFakeDxm(cms), { sessionId: 999 });
        assert.deepEqual([result.found, result.session, result.sessionId], [false, null, 999]);
    });

    test("tolerates a response with no activity", async () => {
        const cms = makeFakeCms({ Util: { makeCall: async () => ({ resultCode: "conWS_Success" }) } });
        const result = await publishingActivitySummary(makeFakeDxm(cms));
        assert.deepEqual(result, { isPublishing: false, activeCount: 0, otherUserSessionCount: 0, systemSessionCount: 0, sessions: [] });
    });
});

describe("publishingSessionIds", () => {
    test("reads the single id /Asset/Publish returns", () => {
        assert.deepEqual(publishingSessionIds({ publishingSessionId: 124990 }), [124990]);
    });

    test("prefers the list /Asset/PublishRefresh returns, in either casing", () => {
        assert.deepEqual(publishingSessionIds({ publishingSessionIds: [1, 2], publishingSessionId: 1 }), [1, 2]);
        assert.deepEqual(publishingSessionIds({ PublishingSessionIds: [3], PublishingSessionId: 3 }), [3]);
    });

    test("drops zero/missing ids and copes with no response", () => {
        assert.deepEqual(publishingSessionIds({ publishingSessionId: 0 }), []);
        assert.deepEqual(publishingSessionIds(undefined), []);
    });
});

describe("publishResult", () => {
    test("returns the started session ids on success", () => {
        assert.deepEqual(publishResult({ publishingSessionId: 124990, isSuccessful: true }), { publishingSessionIds: [124990] });
    });

    test("throws the CMS's message when the publish was refused outright", () => {
        // The exact response a live instance gave for an asset the user may not publish.
        const refused = {
            publishingSessionId: -1, resultCode: "conWS_HasFailures", isSuccessful: false,
            errorMessage: "The following error(s) occurred while processing the request:\r\n276861: User is not allowed to publish this asset."
        };
        assert.throws(() => publishResult(refused), /User is not allowed to publish this asset/);
    });

    test("throws when no session started even without an error message", () => {
        assert.throws(() => publishResult({ publishingSessionId: 0 }), /did not start a publishing session/);
        assert.throws(() => publishResult(undefined), /did not start a publishing session/);
    });

    test("keeps the ids and passes the errors along on a partial failure", () => {
        assert.deepEqual(
            publishResult({ publishingSessionIds: [5], isSuccessful: false, errorMessage: "2: refused" }),
            { publishingSessionIds: [5], errors: "2: refused" }
        );
    });
});
