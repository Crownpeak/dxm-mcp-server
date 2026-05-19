import { z } from "zod";
import { toolHandler, jsonText, parseIdList } from "./util.js";

export function registerReadTools(server, dxm) {
    server.tool(
        "list_attachments",
        "List the attachments on a DXM asset",
        { id: z.number().describe("The ID of the asset") },
        toolHandler(async ({id}) => jsonText(await dxm.listAttachments(id)))
    );

    server.tool(
        "read_site_root",
        "Get the site-root details for an asset",
        { id: z.number().describe("The ID of the asset (typically a site root)") },
        toolHandler(async ({id}) => jsonText(await dxm.readSiteRoot(id)))
    );
}

export function registerWriteTools(server, dxm) {
    server.tool(
        "set_model",
        "Bind one or more DXM assets to a content model",
        {
            ids: z.string().describe('Asset IDs as a JSON array (e.g. "[12345]") or a single numeric ID'),
            model_id: z.number().describe("The ID of the model")
        },
        toolHandler(async ({ids, model_id}) => {
            await dxm.setModel(parseIdList(ids), model_id);
            return { content: [] };
        })
    );

    server.tool(
        "set_template",
        "Bind one or more DXM assets to a template",
        {
            ids: z.string().describe('Asset IDs as a JSON array (e.g. "[12345]") or a single numeric ID'),
            template_id: z.number().describe("The ID of the template"),
            is_developer_template: z.boolean().optional().describe("When true, use the special developer template (template_id is ignored)")
        },
        toolHandler(async ({ids, template_id, is_developer_template}) => {
            await dxm.setTemplate(parseIdList(ids), template_id, !!is_developer_template);
            return { content: [] };
        })
    );

    server.tool(
        "set_workflow",
        "Bind one or more DXM assets to a workflow",
        {
            ids: z.string().describe('Asset IDs as a JSON array (e.g. "[12345]") or a single numeric ID'),
            workflow_id: z.number().describe("The ID of the workflow")
        },
        toolHandler(async ({ids, workflow_id}) => {
            await dxm.setWorkflow(parseIdList(ids), workflow_id);
            return { content: [] };
        })
    );
}
