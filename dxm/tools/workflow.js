import { z } from "zod";
import { toolHandler, jsonText } from "./util.js";

export function registerReadTools(server, dxm) {
    server.tool(
        "list_workflows",
        "List the System-level workflows defined on this DXM instance, including their states and commands. Project-scoped workflows are not returned here; inspect those via find_asset on the workflow asset.",
        {},
        toolHandler(async () => jsonText(await dxm.listWorkflows()))
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
        "Route a DXM asset directly to a specific workflow state (lower-level than execute_workflow_command, which clicks a workflow action by ID)",
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
        "Execute a workflow command on an asset (the equivalent of clicking an Approve/Reject-style action button by its command ID)",
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
