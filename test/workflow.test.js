import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { listWorkflows, getWorkflow, readWorkflow, routeAsset, executeWorkflowCommand, WORKFLOW_FULL_PATH } from "../dxm/workflow.js";
import { makeFakeCms, makeFakeDxm } from "./_helpers.js";

describe("listWorkflows", () => {
    test("delegates to Workflow.getList", async () => {
        const cms = makeFakeCms({
            Workflow: { getList: async () => ({ resultCode: "conWS_Success", errorMessage: "", internalCode: 0, responseValues: null, cookie: ["AWSALB=secret; Path=/"], isSuccessful: true, workflows: { 0: { id: 1, name: "Editorial" } } }) }
        });
        const result = await listWorkflows(makeFakeDxm(cms));
        assert.deepEqual(result, { workflows: { 0: { id: 1, name: "Editorial" } } }, "same shape, minus cookie and envelope");
    });
});

describe("getWorkflow", () => {
    test("delegates to Workflow.read with the id", async () => {
        let captured;
        const cms = makeFakeCms({
            Workflow: { read: async id => { captured = id; return { resultCode: "conWS_Success", errorMessage: "", internalCode: 0, responseValues: null, cookie: ["AWSALB=secret; Path=/"], isSuccessful: true, workflow: { id, stepCommands: [] } }; } }
        });
        const result = await getWorkflow(makeFakeDxm(cms), 8);
        assert.equal(captured, 8);
        assert.deepEqual(result, { workflow: { id: 8, stepCommands: [] } }, "same shape, minus cookie and envelope");
    });

    test("throws for an unknown workflow instead of returning workflow: null", async () => {
        // Live: Workflow/Read/999999 answers conWS_NotFound with an empty errorMessage.
        const cms = makeFakeCms({
            Workflow: { read: async () => ({ resultCode: "conWS_Success", errorMessage: "", internalCode: 0, responseValues: null, cookie: ["AWSALB=secret; Path=/"], isSuccessful: true, isSuccessful: false, resultCode: "conWS_NotFound", workflow: null }) }
        });
        await assert.rejects(() => getWorkflow(makeFakeDxm(cms), 999999), /Could not read workflow 999999: the CMS returned conWS_NotFound/);
    });
});

describe("readWorkflow", () => {
    // Trimmed from /Workflow/full/4767 on CPUK (workflow 11, "Basic Workflow").
    const FULL = {
        id: 11, name: "Basic Workflow", assetId: 4767,
        steps: [
            { step: 1, status: 780, taskSubject: "Create a new document", accessFile: "/System/States/Draft",
              commands: [{ id: 2049, command: "Send for Approval", commandDest: 3, commandId: 28 }], actions: [], schedules: [], periodics: [] },
            { step: 2, status: 782, taskSubject: "Rejected", accessFile: "/System/States/Rejected",
              commands: [], actions: [{ actionId: 15, actionDest: 1 }], schedules: [], periodics: [] },
            { step: 3, status: 781, taskSubject: "Review the document", accessFile: "/System/States/Pending",
              commands: [{ id: 2050, command: "Reject", commandDest: 2, commandId: 29 }],
              actions: [], schedules: [{ name: "Live Date", dest: 9, offset: 0 }], periodics: [] }
        ]
    };

    function fullCms() {
        const calls = [];
        const cms = makeFakeCms({
            Util: { makeCall: async (api, path, body) => { calls.push({ path, body }); return { resultCode: "conWS_Success", errorMessage: "", internalCode: 0, responseValues: null, cookie: ["AWSALB=secret; Path=/"], isSuccessful: true, workflow: FULL }; } },
            Workflow: { read: async id => { calls.push({ read: id }); return { resultCode: "conWS_Success", errorMessage: "", internalCode: 0, responseValues: null, cookie: ["AWSALB=secret; Path=/"], isSuccessful: true, workflow: { id, assetId: 4767 } }; } }
        });
        return { cms, calls };
    }

    test("an asset id goes straight to /Workflow/full", async () => {
        const { cms, calls } = fullCms();
        await readWorkflow(makeFakeDxm(cms), { assetId: 4767 });
        assert.deepEqual(calls, [{ path: WORKFLOW_FULL_PATH + "4767", body: {} }]);
    });

    test("a workflow id is first turned into the workflow's asset id", async () => {
        // /Workflow/full takes the asset id: full/11 is "Asset 11 not found" on CPUK.
        const { cms, calls } = fullCms();
        await readWorkflow(makeFakeDxm(cms), { workflowId: 11 });
        assert.deepEqual(calls, [{ read: 11 }, { path: WORKFLOW_FULL_PATH + "4767", body: {} }]);
    });

    test("names each command's, action's and schedule's destination step", async () => {
        const { cms } = fullCms();
        const wf = await readWorkflow(makeFakeDxm(cms), { assetId: 4767 });
        assert.deepEqual(wf.steps[0].commands[0].destination, { step: 3, status: 781, name: "Review the document", state: "Pending" });
        assert.deepEqual(wf.steps[1].actions[0].destination, { step: 1, status: 780, name: "Create a new document", state: "Draft" });
        assert.equal(wf.steps[0].state, "Draft");
        assert.equal(wf.steps[0].commands[0].commandId, 28, "the raw command fields are kept");
        assert.deepEqual(wf.steps[2].schedules[0].destination, { step: 9 }, "an unknown step is reported by number");
    });

    test("never returns the session cookie", async () => {
        const { cms } = fullCms();
        assert.ok(!JSON.stringify(await readWorkflow(makeFakeDxm(cms), { assetId: 4767 })).includes("secret"));
    });

    test("needs exactly one of workflowId and assetId", async () => {
        const { cms } = fullCms();
        await assert.rejects(() => readWorkflow(makeFakeDxm(cms), {}), /exactly one/);
        await assert.rejects(() => readWorkflow(makeFakeDxm(cms), { workflowId: 11, assetId: 4767 }), /exactly one/);
    });

    test("throws the CMS's message for an asset id that is not a workflow", async () => {
        const cms = makeFakeCms({
            Util: { makeCall: async () => ({ resultCode: "conWS_Success", errorMessage: "", internalCode: 0, responseValues: null, cookie: ["AWSALB=secret; Path=/"], isSuccessful: true, isSuccessful: false, resultCode: "conWS_NotFound", errorMessage: "Asset 103 not found." }) }
        });
        await assert.rejects(() => readWorkflow(makeFakeDxm(cms), { assetId: 103 }), /asset id 103: Asset 103 not found/);
    });
});

describe("routeAsset", () => {
    function recordingCms() {
        const calls = [];
        const cms = makeFakeCms({
            Asset: {
                RouteRequest: class {
                    constructor(assetId, stateId) { Object.assign(this, { assetId, stateId }); }
                    toJson() { return { assetId: this.assetId, stateId: this.stateId }; }
                },
                route: async r => { calls.push(r.toJson()); return { isSuccessful: true }; }
            }
        });
        return { calls, cms };
    }

    test("sends PublishDependencies: false unless dependencies are asked for", async () => {
        const r = recordingCms();
        await routeAsset(makeFakeDxm(r.cms), 100, 200);
        await routeAsset(makeFakeDxm(r.cms), 100, 200, true);
        assert.deepEqual(r.calls, [
            { assetId: 100, stateId: 200, PublishDependencies: false },
            { assetId: 100, stateId: 200, PublishDependencies: true }
        ]);
    });

    test("the real helper sends the wrapped body to /Asset/Route", async () => {
        // Only the HTTP POST is stubbed: this is the helper's own RouteRequest and Asset.route.
        const { default: CmsApi } = await import("crownpeak-dxm-accessapi-helper");
        const cms = new CmsApi();
        const posts = [];
        cms.postRequest = async (path, data, onSuccess) => { posts.push({ path, data }); onSuccess({ resultCode: "conWS_Success" }); };
        await routeAsset(makeFakeDxm(cms), 384206, 783, false);
        assert.deepEqual(posts, [{ path: "/Asset/Route/", data: { assetId: 384206, stateId: 783, PublishDependencies: false } }]);
    });

    test("throws when the CMS refuses the route instead of reporting success", async () => {
        const cms = makeFakeCms({
            Asset: {
                RouteRequest: class {},
                route: async () => ({ isSuccessful: false, resultCode: "conWS_Failure", errorMessage: "Not allowed", cookie: ["s"] })
            }
        });
        await assert.rejects(() => routeAsset(makeFakeDxm(cms), 100, 200), /Could not route asset 100 to state 200: Not allowed/);
    });
});

describe("executeWorkflowCommand", () => {
    // The response live on CPUK for command 38 ("Deploy to Stage") on asset 384206, trimmed.
    const LIVE_OK = {
        requiredAction: "None", publishingSessionId: 124990,
        asset: { id: 384206, label: "Test", type: 2, fullPath: "/Site/Test", statusName: "Stage", status: 783, folder_id: 275152, branchId: -2, error_msg: null, permissionList: "0100" },
        resultCode: "conWS_Success", errorMessage: "", internalCode: 0, responseValues: null, cookie: ["AWSALB=secret"], isSuccessful: true
    };
    // ...and for the same command once the asset had already moved on.
    const LIVE_NOT_OFFERED = {
        requiredAction: "None", asset: null, publishingSessionId: -1,
        resultCode: "conWS_NotFound", errorMessage: "Workflow command not found!", internalCode: 0, responseValues: null, cookie: ["AWSALB=secret"], isSuccessful: false
    };

    function recordingCms(response = LIVE_OK) {
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
                    executeWorkflowCommand: async r => { req = r; return response; }
                }
            })
        };
    }

    test("skips dependencies unless they are asked for", async () => {
        const r = recordingCms();
        await executeWorkflowCommand(makeFakeDxm(r.cms), 100, 5);
        assert.equal(r.req.assetId, 100);
        assert.equal(r.req.commandId, 5);
        assert.equal(r.req.skipDependencies, true);
        await executeWorkflowCommand(makeFakeDxm(r.cms), 100, 5, true);
        assert.equal(r.req.skipDependencies, false);
    });

    test("sends skipDependencies as a boolean", async () => {
        const r = recordingCms();
        await executeWorkflowCommand(makeFakeDxm(r.cms), 100, 5, 0);
        assert.equal(r.req.skipDependencies, true);
        await executeWorkflowCommand(makeFakeDxm(r.cms), 100, 5, "yes");
        assert.equal(r.req.skipDependencies, false);
    });

    test("returns the moved asset and the publish it started, without the cookie", async () => {
        const r = recordingCms();
        const result = await executeWorkflowCommand(makeFakeDxm(r.cms), 384206, 38, true);
        assert.deepEqual(result, {
            asset: { id: 384206, label: "Test", type: "File", fullPath: "/Site/Test", status: "Stage", folder_id: 275152, branchId: -2, error_msg: null },
            publishingSessionId: 124990,
            requiredAction: "None"
        });
        assert.ok(!JSON.stringify(result).includes("secret"));
    });

    test("reports no session when the command doesn't publish", async () => {
        const r = recordingCms({ ...LIVE_OK, publishingSessionId: -1 });
        assert.equal((await executeWorkflowCommand(makeFakeDxm(r.cms), 1, 2)).publishingSessionId, null);
    });

    test("throws, pointing at read_workflow, when the current state doesn't offer the command", async () => {
        const r = recordingCms(LIVE_NOT_OFFERED);
        await assert.rejects(() => executeWorkflowCommand(makeFakeDxm(r.cms), 384206, 38, true),
            /Command 38 is not available for asset 384206 in its current state \(Workflow command not found!\)\. read_workflow/);
    });

    test("throws the CMS's message for any other failure", async () => {
        const r = recordingCms({ ...LIVE_NOT_OFFERED, resultCode: "conWS_Failure", errorMessage: "Asset is locked" });
        await assert.rejects(() => executeWorkflowCommand(makeFakeDxm(r.cms), 5, 6), /Could not run command 6 on asset 5: Asset is locked/);
    });
});
