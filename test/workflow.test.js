import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { listWorkflows, getWorkflow, routeAsset, executeWorkflowCommand } from "../dxm/workflow.js";
import { makeFakeCms, makeFakeDxm } from "./_helpers.js";

describe("listWorkflows", () => {
    test("delegates to Workflow.getList", async () => {
        const expected = [{ id: 1, name: "Editorial" }];
        const cms = makeFakeCms({
            Workflow: { getList: async () => expected }
        });
        const result = await listWorkflows(makeFakeDxm(cms));
        assert.equal(result, expected);
    });
});

describe("getWorkflow", () => {
    test("delegates to Workflow.read with the id", async () => {
        let captured;
        const cms = makeFakeCms({
            Workflow: { read: async id => { captured = id; return { id, states: [] }; } }
        });
        const result = await getWorkflow(makeFakeDxm(cms), 8);
        assert.equal(captured, 8);
        assert.deepEqual(result, { id: 8, states: [] });
    });
});

describe("routeAsset", () => {
    test("constructs a RouteRequest with id and stateId, then calls Asset.route", async () => {
        let req;
        const cms = makeFakeCms({
            Asset: {
                RouteRequest: class { constructor(id, stateId) { Object.assign(this, { id, stateId }); } },
                route: async r => { req = r; return { ok: true }; }
            }
        });
        await routeAsset(makeFakeDxm(cms), 100, 200);
        assert.equal(req.id, 100);
        assert.equal(req.stateId, 200);
    });
});

describe("executeWorkflowCommand", () => {
    function recordingCms() {
        let req;
        return {
            get req() { return req; },
            cms: makeFakeCms({
                Asset: {
                    ExecuteWorkflowCommandRequest: class {
                        constructor(assetId, commandId, skipDependencies) {
                            Object.assign(this, { assetId, commandId, skipDependencies });
                        }
                    },
                    executeWorkflowCommand: async r => { req = r; return { ok: true }; }
                }
            })
        };
    }

    test("constructs the request with assetId, commandId, and defaults skip to false", async () => {
        const r = recordingCms();
        await executeWorkflowCommand(makeFakeDxm(r.cms), 100, 5);
        assert.equal(r.req.assetId, 100);
        assert.equal(r.req.commandId, 5);
        assert.equal(r.req.skipDependencies, false);
    });

    test("coerces skipDependencies to a boolean", async () => {
        const r = recordingCms();
        await executeWorkflowCommand(makeFakeDxm(r.cms), 100, 5, "true");
        assert.equal(r.req.skipDependencies, true);
        await executeWorkflowCommand(makeFakeDxm(r.cms), 100, 5, 0);
        assert.equal(r.req.skipDependencies, false);
    });
});
