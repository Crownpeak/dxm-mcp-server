import { z } from "zod";
import { toolHandler, jsonText } from "./util.js";

export function registerReadTools(server, dxm) {
    server.tool(
        "find_asset",
        "Find a DXM asset by numeric ID or full path, returning its metadata",
        { query: z.string().describe("A numeric asset ID (e.g. \"12345\") or a full CMS path (e.g. \"/Site/Folder/Page\")") },
        toolHandler(async ({query}) => jsonText(await dxm.findAsset(query)))
    );

    server.tool(
        "get_path",
        "Get the full CMS path of an asset by its numeric ID, optionally including the chain of ancestor assets",
        {
            id: z.number().describe("The ID of the asset"),
            include_ancestors: z.boolean().optional().describe("When true, include the list of ancestor assets in the response")
        },
        toolHandler(async ({id, include_ancestors}) => jsonText(await dxm.getPath(id, !!include_ancestors)))
    );

    server.tool(
        "list_folder",
        "List the contents of a DXM folder. Optional visibility selects between normal (default), deleted, and hidden assets; optional filter restricts results to labels containing the given substring.",
        {
            id: z.number().describe("The ID of the folder"),
            visibility: z.string().optional().describe("Visibility filter: \"normal\" (default), \"deleted\", or \"hidden\""),
            filter: z.string().optional().describe("Substring to match against asset labels (case-insensitive)")
        },
        toolHandler(async ({id, visibility, filter}) => jsonText(await dxm.listFolder(id, { visibility, filter })))
    );

    server.tool(
        "list_fields",
        "List the fields of a DXM asset",
        { id: z.number().describe("The ID of the asset") },
        toolHandler(async ({id}) => jsonText(await dxm.listFields(id)))
    );

    server.tool(
        "get_code",
        "Get the code in a DXM template file or asset",
        { id: z.number().describe("The ID of the asset") },
        toolHandler(async ({id}) => ({
            content: [{ type: "text", text: (await dxm.listFields(id)).find(f => f.name === "body")?.value ?? "" }]
        }))
    );
}

export function registerWriteTools(server, dxm) {
    server.tool(
        "set_fields",
        "Set field values on a DXM asset",
        {
            id: z.number().describe("The ID of the asset"),
            fields: z.string().describe('Fields to update as a JSON object, e.g. {"fieldName":"value"}')
        },
        toolHandler(async ({id, fields}) => {
            await dxm.setFields(id, JSON.parse(fields));
            return { content: [] };
        })
    );

    server.tool(
        "set_field",
        "Set a single field value on a DXM asset",
        {
            id: z.number().describe("The ID of the asset"),
            name: z.string().describe("The name of the field to set"),
            value: z.string().describe("The value of the field to set"),
        },
        toolHandler(async ({id, name, value}) => {
            await dxm.setFields(id, { [name]: value });
            return { content: [] };
        })
    );

    server.tool(
        "delete_fields",
        "Delete multiple fields from a DXM asset",
        {
            id: z.number().describe("The ID of the asset"),
            fields: z.string().describe('Names of fields to delete as a JSON array, e.g. ["fieldName1","fieldName2"]')
        },
        toolHandler(async ({id, fields}) => {
            await dxm.deleteFields(id, JSON.parse(fields));
            return { content: [] };
        })
    );

    server.tool(
        "delete_field",
        "Delete a single field from a DXM asset",
        {
            id: z.number().describe("The ID of the asset"),
            name: z.string().describe("The name of the field to delete")
        },
        toolHandler(async ({id, name}) => {
            await dxm.deleteFields(id, [name]);
            return { content: [] };
        })
    );

    server.tool(
        "set_code",
        "Set the code in a DXM template file or asset",
        {
            id: z.number().describe("The ID of the asset"),
            code: z.string().describe("The code to be saved on the asset")
        },
        toolHandler(async ({id, code}) => {
            await dxm.setCode(id, code);
            return { content: [] };
        })
    );

    server.tool(
        "delete_file",
        "Delete a DXM asset",
        { id: z.number().describe("The ID of the asset to delete") },
        toolHandler(async ({id}) => {
            await dxm.deleteAsset(id);
            return { content: [] };
        })
    );

    server.tool(
        "undelete_file",
        "Undelete a previously deleted DXM asset",
        { id: z.number().describe("The ID of the asset to undelete") },
        toolHandler(async ({id}) => {
            await dxm.undeleteAsset(id);
            return { content: [] };
        })
    );

    server.tool(
        "branch_file",
        "Branch a DXM asset, creating a draft copy of it",
        { id: z.number().describe("The ID of the asset to branch") },
        toolHandler(async ({id}) => jsonText(await dxm.branchAsset(id)))
    );

    server.tool(
        "move_file",
        "Move a DXM asset into a different folder",
        {
            id: z.number().describe("The ID of the asset to move"),
            destination_folder_id: z.number().describe("The ID of the destination folder")
        },
        toolHandler(async ({id, destination_folder_id}) => {
            await dxm.moveAsset(id, destination_folder_id);
            return { content: [] };
        })
    );

    server.tool(
        "rename_file",
        "Rename a DXM asset",
        {
            id: z.number().describe("The ID of the asset to rename"),
            new_name: z.string().describe("The new label for the asset")
        },
        toolHandler(async ({id, new_name}) => {
            await dxm.renameAsset(id, new_name);
            return { content: [] };
        })
    );

    server.tool(
        "create_file_from_model",
        "Create a new DXM file asset using a model",
        {
            name: z.string().describe("The name of the new asset"),
            folder_id: z.number().describe("The ID of the destination folder"),
            model_id: z.number().describe("The ID of the model to use")
        },
        toolHandler(async ({name, folder_id, model_id}) =>
            jsonText(await dxm.createAsset(name, folder_id, { modelId: model_id }))
        )
    );

    server.tool(
        "create_file",
        "Create a new DXM file asset using a template and workflow",
        {
            name: z.string().describe("The name of the new asset"),
            folder_id: z.number().describe("The ID of the destination folder"),
            template_id: z.number().describe("The ID of the template to use"),
            workflow_id: z.number().describe("The ID of the workflow to use")
        },
        toolHandler(async ({name, folder_id, template_id, workflow_id}) =>
            jsonText(await dxm.createAsset(name, folder_id, { templateId: template_id, workflowId: workflow_id }))
        )
    );

    server.tool(
        "create_folder",
        "Create a new DXM folder asset",
        {
            name: z.string().describe("The name of the new folder"),
            folder_id: z.number().describe("The ID of the parent folder")
        },
        toolHandler(async ({name, folder_id}) => jsonText(await dxm.createFolder(name, folder_id)))
    );

    server.tool(
        "create_folder_with_model",
        "Create a new DXM folder bound to a content model",
        {
            name: z.string().describe("The name of the new folder"),
            folder_id: z.number().describe("The ID of the parent folder"),
            model_id: z.number().describe("The ID of the model to bind to the folder")
        },
        toolHandler(async ({name, folder_id, model_id}) =>
            jsonText(await dxm.createFolderWithModel(name, folder_id, model_id))
        )
    );

    server.tool(
        "create_project",
        "Create a new DXM project, optionally installing the Component Library",
        {
            name: z.string().describe("The name of the new project"),
            folder_id: z.number().describe("The ID of the destination folder"),
            library_name: z.string().describe("The name of the library folder to create inside the project"),
            install_component_library: z.boolean().optional().describe("Install the Component Library (default: false)"),
            component_library_version: z.string().optional().describe("Version of the Component Library to install"),
            rebuild_site: z.boolean().optional().describe("Rebuild the site after installation (default: false)")
        },
        toolHandler(async ({name, folder_id, library_name, install_component_library, component_library_version, rebuild_site}) =>
            jsonText(await dxm.createProject(name, folder_id, library_name, install_component_library, component_library_version ?? "", rebuild_site))
        )
    );

    server.tool(
        "create_site_root",
        "Create a new DXM site root",
        {
            name: z.string().describe("The name of the new site root"),
            folder_id: z.number().describe("The ID of the destination folder"),
            install_component_library: z.boolean().optional().describe("Install the Component Library (default: false)"),
            rebuild_component_library: z.boolean().optional().describe("Rebuild the Component Library after installation"),
            component_library_version: z.string().optional().describe("Version of the Component Library to use")
        },
        toolHandler(async ({name, folder_id, install_component_library, rebuild_component_library, component_library_version}) =>
            jsonText(await dxm.createSiteRoot(name, folder_id, install_component_library, rebuild_component_library, component_library_version ?? ""))
        )
    );

    server.tool(
        "create_library_reference",
        "Create a new DXM library reference pointing at an existing library folder",
        {
            name: z.string().describe("The name of the new library reference"),
            folder_id: z.number().describe("The ID of the destination folder"),
            library_id: z.number().describe("The ID of the library folder to reference")
        },
        toolHandler(async ({name, folder_id, library_id}) =>
            jsonText(await dxm.createLibraryReference(name, folder_id, library_id))
        )
    );

    server.tool(
        "log_message",
        "Write a message to the DXM log. With asset_id the message is attached to that asset; without, it goes to the system log.",
        {
            message: z.string().describe("The message to log"),
            asset_id: z.number().optional().describe("Optional asset ID to attach the message to")
        },
        toolHandler(async ({message, asset_id}) => {
            await dxm.logMessage(message, asset_id);
            return { content: [] };
        })
    );
}
