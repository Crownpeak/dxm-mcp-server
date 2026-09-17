import { z } from "zod";
import { toolHandler, jsonText, parseIdList, SLOW_TOOL_TIMEOUT_MS } from "./util.js";

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

    server.tool(
        "list_versions",
        "List the version history of a DXM asset, newest first. Each entry gives the version ID, the user who made the change, when it was made, the change comment, and the version type.",
        { id: z.number().describe("The ID of the asset") },
        toolHandler(async ({id}) => jsonText(await dxm.listVersions(id)))
    );

    server.tool(
        "get_version",
        "Get the stored field values of one specific version of a DXM asset, in the same shape as list_fields so it can be compared against the live asset. version_id must come from list_versions — an unknown ID is rejected rather than silently returning the asset's current content.",
        {
            id: z.number().describe("The ID of the asset"),
            version_id: z.number().describe("The version ID to retrieve, as returned by list_versions")
        },
        toolHandler(async ({id, version_id}) => jsonText(await dxm.getVersion(id, version_id)))
    );
}

export function registerWriteTools(server, dxm) {
    server.tool(
        "revert_to_version",
        "Revert a DXM asset's content back to an earlier stored version. This modifies the asset: it appends a new version whose content is the old one's (no history is lost). version_id must come from list_versions — an unknown ID is rejected. Consider calling get_version first to confirm what the revert will restore.",
        {
            id: z.number().describe("The ID of the asset to revert"),
            version_id: z.number().describe("The version ID to revert the asset's content to, as returned by list_versions")
        },
        // The CMS takes its time over this one — routinely more than the standard 30s cap — and
        // it is a write, so a timeout here is worse than on a read: the revert may well have
        // landed, leaving the caller unsure whether to retry. Hence the extended ceiling.
        toolHandler(
            async ({id, version_id}) => jsonText(await dxm.revertToVersion(id, version_id)),
            SLOW_TOOL_TIMEOUT_MS
        )
    );

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
