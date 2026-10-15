import { z } from "zod";
import { toolHandler, jsonText } from "./util.js";

export function registerReadTools(server, dxm) {
    server.tool(
        "list_workflows",
        "List the workflows defined on this DXM instance (System and project workflows alike), including their states and commands. The output is large (hundreds of KB on a big instance); for one workflow use get_workflow or read_workflow.",
        {},
        toolHandler(async () => jsonText(await dxm.listWorkflows()))
    );

    server.tool(
        "read_workflow",
        "Read the full definition of a workflow: every step (state) with the commands available from it, where each command leads (destination: step, status, name, state), and each step's publishing, schedule and action rules. Use it to find which commands an asset can follow from its current state; an asset's status is a step's status. commandId is the id execute_workflow_command takes. Pass workflow_id (e.g. an asset's workflow_id) or asset_id (the workflow's own asset id, as list_workflows gives it).",
        {
            workflow_id: z.number().optional().describe("The workflow's id"),
            asset_id: z.number().optional().describe("The workflow's asset id (not the id of an asset that uses the workflow)")
        },
        toolHandler(async ({workflow_id, asset_id}) =>
            jsonText(await dxm.readWorkflow({ workflowId: workflow_id, assetId: asset_id })))
    );

    server.tool(
        "get_workflow",
        "Get the details of a specific workflow by its ID, including its states and the commands available from each",
        { id: z.number().describe("The ID of the workflow") },
        toolHandler(async ({id}) => jsonText(await dxm.getWorkflow(id)))
    );
}

export function registerWriteTools(server, dxm) {
    server.tool(
        "route_file",
        "Route a DXM asset directly to a specific workflow state (lower-level than execute_workflow_command, which clicks a workflow action by ID). Routing into a publishing state starts a publish but returns no session id: call publishing_activity_summary with asset_id to follow it.",
        {
            id: z.number().describe("The ID of the asset to route"),
            state_id: z.string().describe("The numeric ID or name of the workflow state to route the asset to")
        },
        toolHandler(async ({id, state_id}) => {
            let stateId;
            if (/^\d+$/.test(state_id.trim())) {
                stateId = Number(state_id);
            } else {
                const state = await dxm.findAsset(`/System/States/${state_id}`);
                stateId = state.id;
            }
            await dxm.routeAsset(id, stateId);
            return { content: [] };
        })
    );

    server.tool(
        "execute_workflow_command",
        "Execute a workflow command on an asset (the equivalent of clicking an Approve/Reject-style action button by its command ID). A command whose step publishes starts a publish but returns no session id: call publishing_activity_summary with asset_id to follow it.",
        {
            asset_id: z.number().describe("The ID of the asset"),
            command_id: z.number().describe("The ID of the workflow command to execute"),
            skip_dependencies: z.boolean().optional().describe("When true, do not move dependent assets through workflow")
        },
        toolHandler(async ({asset_id, command_id, skip_dependencies}) => {
            await dxm.executeWorkflowCommand(asset_id, command_id, !!skip_dependencies);
            return { content: [] };
        })
    );
}
