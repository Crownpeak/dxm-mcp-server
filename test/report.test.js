import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { siteSummary } from "../dxm/report.js";
import { makeFakeCms, makeFakeDxm } from "./_helpers.js";

describe("siteSummary", () => {
    test("delegates to Report.siteSummary", async () => {
        const expected = { totalAssets: 1234 };
        const cms = makeFakeCms({
            Report: { siteSummary: async () => expected }
        });
        const result = await siteSummary(makeFakeDxm(cms));
        assert.equal(result, expected);
    });

    test("calls _ensureLoggedIn before the request", async () => {
        const cms = makeFakeCms({
            Report: { siteSummary: async () => ({}) }
        });
        const dxm = makeFakeDxm(cms);
        await siteSummary(dxm);
        assert.equal(dxm.ensureLoginCalls, 1);
    });
});
