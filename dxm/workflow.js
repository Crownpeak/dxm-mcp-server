import { mapAsset, responseData } from "./util.js";

// Both return the helper response minus its envelope (above all the session cookie); the data
// keeps its shape: { workflows } and { workflow }. Note /Workflow/Read returns every workflow on
// the instance, project workflows included (104 on CPUK, about 326,000 characters in all), and
// `workflows` is an object keyed by position, not an array.
export async function listWorkflows(dxm) {
    await dxm._ensureLoggedIn();
    return responseData(await dxm._cms.Workflow.getList(), "Could not list workflows");
}

export async function getWorkflow(dxm, id) {
    await dxm._ensureLoggedIn();
    return responseData(await dxm._cms.Workflow.read(id), `Could not read workflow ${id}`);
}

// The helper has no wrapper for this endpoint, so it goes through the generic makeCall.
export const WORKFLOW_FULL_PATH = "/Workflow/full/";

// The full definition of one workflow: every step with its commands, plus the publishing,
// schedule and action rules get_workflow doesn't include. /Workflow/full/{id} takes the workflow's
// *asset* id (workflow 11 is asset 4767 on CPUK; full/11 is "Asset 11 not found"), so a workflow
// id is first turned into its asset id with /Workflow/Read/{id}.
//
// Commands, schedules and actions name their target by step number (commandDest, dest,
// actionDest), so each gets a `destination` naming that step, sparing the caller the
// cross-reference. `commandId` is the id execute_workflow_command takes.
export async function readWorkflow(dxm, { workflowId, assetId } = {}) {
    if ((workflowId == null) === (assetId == null)) {
        throw new Error("Pass exactly one of workflowId or assetId");
    }
    await dxm._ensureLoggedIn();
    const cms = dxm._cms;
    if (assetId == null) {
        assetId = (await getWorkflow(dxm, workflowId)).workflow?.assetId;
        if (assetId == null) throw new Error(`Workflow ${workflowId} has no asset id`);
    }
    const { workflow } = responseData(
        await cms.Util.makeCall(cms, WORKFLOW_FULL_PATH + assetId, {}),
        `Could not read the workflow with asset id ${assetId}`
    );
    const steps = workflow?.steps ?? [];
    const byStep = new Map(steps.map(s => [s.step, s]));
    const destination = n => {
        const s = byStep.get(n);
        return s ? { step: s.step, status: s.status, name: s.taskSubject, state: stateName(s.accessFile) } : { step: n };
    };
    return {
        ...workflow,
        steps: steps.map(s => ({
            ...s,
            state: stateName(s.accessFile),
            commands: (s.commands ?? []).map(c => ({ ...c, destination: destination(c.commandDest) })),
            schedules: (s.schedules ?? []).map(x => ({ ...x, destination: destination(x.dest) })),
            periodics: (s.periodics ?? []).map(x => ({ ...x, destination: destination(x.dest) })),
            actions: (s.actions ?? []).map(x => ({ ...x, destination: destination(x.actionDest) }))
        }))
    };
}

// "/System/States/Stage" -> "Stage"
function stateName(accessFile) {
    return accessFile ? String(accessFile).split("/").pop() : null;
}

// The helper doesn't throw when the CMS refuses a route; this used to ignore the response, so a
// refused route was reported as a success.
//
// Dependencies are only published when asked for. /Asset/Route takes a PublishDependencies flag
// (Swagger spells it PascalCase, next to camelCase assetId / stateId) that the helper's
// RouteRequest doesn't send, so the request is wrapped and the flag always sent, false unless
// includeDependencies. This works because the helper's Asset.route only calls request.toJson() -
// the same approach as createChildren in dxm/assets.js.
export async function routeAsset(dxm, id, stateId, includeDependencies = false) {
    await dxm._ensureLoggedIn();
    const cms = dxm._cms;
    const base = new cms.Asset.RouteRequest(id, stateId);
    const request = { toJson: () => ({ ...base.toJson(), PublishDependencies: !!includeDependencies }) };
    return responseData(await cms.Asset.route(request), `Could not route asset ${id} to state ${stateId}`);
}

// Runs one of the commands the asset's current workflow step offers (what the CMS UI shows as
// buttons), e.g. "Deploy to Stage". Unlike a route it also runs the step's rules, and it is
// available to users who aren't allowed to route. Live on CPUK (asset 384206, command 38 from
// Draft) the response carried the moved asset and the publish it started:
// { requiredAction: "None", asset, publishingSessionId: 124990 }.
//
// A command the current step doesn't offer - already run, wrong state, or a made-up id - comes
// back as isSuccessful: false, "Workflow command not found!", and the asset doesn't move. The
// helper doesn't throw on that, and this used to ignore the response, so it was reported as a
// success. It now throws, with a pointer to read_workflow.
// Dependencies are only moved along when asked for: skipDependencies is sent as the inverse.
export async function executeWorkflowCommand(dxm, assetId, commandId, includeDependencies = false) {
    await dxm._ensureLoggedIn();
    const cms = dxm._cms;
    const request = new cms.Asset.ExecuteWorkflowCommandRequest(assetId, commandId, !includeDependencies);
    const response = await cms.Asset.executeWorkflowCommand(request);
    if (response?.isSuccessful === false && response.resultCode === "conWS_NotFound") {
        throw new Error(`Command ${commandId} is not available for asset ${assetId} in its current state (${response.errorMessage || response.resultCode}). read_workflow lists the commands each state offers; match the asset's status to a step's status.`);
    }
    const data = responseData(response, `Could not run command ${commandId} on asset ${assetId}`);
    return {
        asset: data.asset ? mapAsset(cms, data.asset) : null,
        // -1 / 0 when the command's step doesn't publish.
        publishingSessionId: data.publishingSessionId > 0 ? data.publishingSessionId : null,
        requiredAction: data.requiredAction ?? null
    };
}
