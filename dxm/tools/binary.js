import { z } from "zod";
import { basename } from "node:path";
import { toolHandler, jsonText, readFileForUpload, IMAGE_MIME_TYPES, FILE_MIME_TYPES } from "./util.js";

export function registerReadTools(server, dxm) {
    server.tool(
        "download_image",
        "Download an image asset from DXM",
        { id: z.number().describe("The ID of the image asset") },
        toolHandler(async ({id}) => {
            const { buffer, ext } = await dxm.downloadAsset(id);
            const mimeType = IMAGE_MIME_TYPES[ext] ?? "image/jpeg";
            return { content: [{ type: "image", data: buffer.toString("base64"), mimeType }] };
        })
    );

    server.tool(
        "download_file",
        "Download any binary file asset from DXM, returning its base64-encoded content and MIME type",
        { id: z.number().describe("The ID of the asset") },
        toolHandler(async ({id}) => {
            const { buffer, ext } = await dxm.downloadAsset(id);
            const mimeType = FILE_MIME_TYPES[ext] ?? "application/octet-stream";
            return jsonText({
                mimeType,
                encoding: "base64",
                data: buffer.toString("base64")
            });
        })
    );

    server.tool(
        "view_output",
        "Render the published HTML output of a DXM asset and return it as text",
        { id: z.number().describe("The ID of the asset to render") },
        toolHandler(async ({id}) => ({
            content: [{ type: "text", text: await dxm.viewOutput(id) }]
        }))
    );
}

export function registerWriteTools(server, dxm) {
    server.tool(
        "upload_file",
        "Upload a new binary file asset to DXM, reading the file from a path on the MCP server's filesystem. The file is read directly by the server and never enters the LLM context. Capped at ~11 MB raw.",
        {
            path: z.string().describe("Filesystem path to the file (must be reachable from the MCP server process)"),
            folder_id: z.number().describe("The ID of the destination folder"),
            name: z.string().optional().describe("Name for the new asset (defaults to the file's basename)"),
            model_id: z.number().optional().describe("Optional model ID to bind to the asset"),
            workflow_id: z.number().optional().describe("Optional workflow ID")
        },
        toolHandler(async ({path: filePath, folder_id, name, model_id, workflow_id}) => {
            const bytes = await readFileForUpload(filePath);
            const assetName = name ?? basename(filePath);
            return jsonText(await dxm.uploadAsset(assetName, folder_id, bytes, {
                modelId: model_id ?? -1,
                workflowId: workflow_id ?? 0
            }));
        })
    );

    server.tool(
        "upload_replace_file",
        "Upload a binary file to DXM to replace an existing file asset, reading the new content from a path on the MCP server's filesystem. The file is read directly by the server and never enters the LLM context. Capped at ~11 MB raw.",
        {
            path: z.string().describe("Filesystem path to the new file content (must be reachable from the MCP server process)"),
            file_id: z.number().describe("The ID of the existing file asset to replace"),
            name: z.string().optional().describe("Name for the replaced asset (defaults to the file's basename)")
        },
        toolHandler(async ({path: filePath, file_id, name}) => {
            const bytes = await readFileForUpload(filePath);
            const assetName = name ?? basename(filePath);
            return jsonText(await dxm.uploadAsset(assetName, file_id, bytes, {
                modelId: -1,
                workflowId: 0
            }));
        })
    );

    server.tool(
        "attach_file",
        "Attach a binary file to an existing DXM asset, reading the file from a path on the MCP server's filesystem. The file is read directly by the server and never enters the LLM context. Capped at ~11 MB raw.",
        {
            asset_id: z.number().describe("The ID of the asset to attach to"),
            path: z.string().describe("Filesystem path to the file (must be reachable from the MCP server process)"),
            original_filename: z.string().optional().describe("Original filename for content-type sniffing on the server (defaults to the file's basename)")
        },
        toolHandler(async ({asset_id, path: filePath, original_filename}) => {
            const bytes = await readFileForUpload(filePath);
            const filename = original_filename ?? basename(filePath);
            return jsonText(await dxm.attachAsset(asset_id, bytes, filename));
        })
    );
}
