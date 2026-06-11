import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { publishingErrors, siteSummary } from "../dxm/report.js";
import { makeFakeCms, makeFakeDxm } from "./_helpers.js";

describe("publishingErrors", () => {
    test("delegates to Report.publishingErrors", async () => {
        const response = { assetList: [
            { id: 1, label: "A", type: 2, fullPath: "/A", statusName: "Live", folder_id: 9, error_msg: "Error 1" },
            { id: 2, label: "B", type: 4, fullPath: "/B", statusName: "Live", folder_id: 9, error_msg: "Error 2" }
        ] };
        const expected = [
            { id: 1, label: "A", type: "File", fullPath: "/A", status: "Live", folder_id: 9, error_msg: "Error 1" },
            { id: 2, label: "B", type: "Folder", fullPath: "/B", status: "Live", folder_id: 9, error_msg: "Error 2" }
        ];
        const cms = makeFakeCms({
            Report: { publishingErrors: async () => response }
        });
        const result = await publishingErrors(makeFakeDxm(cms));
        assert.deepEqual(result, expected);
    });

    test("calls _ensureLoggedIn before the request", async () => {
        const response = { assetList: [
            { id: 1, label: "A", type: 2, fullPath: "/A", statusName: "Live", folder_id: 9, error_msg: "Error 1" },
            { id: 2, label: "B", type: 4, fullPath: "/B", statusName: "Live", folder_id: 9, error_msg: "Error 2" }
        ] };
        const cms = makeFakeCms({
            Report: { publishingErrors: async () => response }
        });
        const dxm = makeFakeDxm(cms);
        await publishingErrors(dxm);
        assert.equal(dxm.ensureLoginCalls, 1);
    });
});

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
