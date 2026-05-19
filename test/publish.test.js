import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { getPublishLinks, publishAssets, republishAssets } from "../dxm/publish.js";
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
