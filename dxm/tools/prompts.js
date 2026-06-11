import { z } from "zod";

function userMessage(text) {
    return { messages: [{ role: "user", content: { type: "text", text } }] };
}

// Prompts whose target tool is only registered on stdio. The credential-management tools mutate
// a shared Dxm singleton, which has no coherent meaning across concurrent stateless HTTP requests,
// so the HTTP composition skips them.
export function registerCredentialPrompts(server) {
    server.prompt(
        "login",
        "Authenticate to a DXM CMS instance using a saved credential profile",
        { profile: z.string().describe("Name of a saved credential profile") },
        ({ profile }) => userMessage(
`Authenticate to DXM using the saved credential profile "${profile}". Call the login tool with profile="${profile}".

If no such profile exists yet, save it first from a terminal with \`npm run profile -- add ${profile}\` — credentials cannot be entered through the chat.`
        )
    );

    server.prompt(
        "login_browser",
        "Log in to DXM by opening a browser window for the CMS login page",
        {
            server: z.string().describe("CMS hostname, e.g. cms.crownpeak.net (no scheme, no path)"),
            instance: z.string().describe("CMS instance name, e.g. CPUK")
        },
        ({ server, instance }) => userMessage(
`Authenticate to DXM by opening a browser window pointed at https://${server}/${instance}/.

Call the login_browser tool with server="${server}" and instance="${instance}". A Chromium window will open — complete the CMS login there using any provider the CMS supports (standard password, SSO, MFA). The MCP server will capture the session cookies and per-instance API key automatically; nothing is persisted to disk.

After login, call whoami to confirm the authenticated state.`
        )
    );

    server.prompt(
        "logout",
        "Clear the current DXM session",
        {},
        () => userMessage(
`Sign out of DXM by calling the logout tool. After logout, subsequent tool calls will fail with "Not authenticated" until login is called again.`
        )
    );

    server.prompt(
        "list_profiles",
        "List the names of saved DXM credential profiles",
        {},
        () => userMessage(
`List the saved DXM credential profile names.

Call the list_profiles tool and display each profile name. Do not attempt to display credential values — only names are returned.`
        )
    );

    server.prompt(
        "delete_profile",
        "Delete a saved DXM credential profile by name",
        { name: z.string().describe("Profile name to delete") },
        ({ name }) => userMessage(
`Delete the saved DXM credential profile named "${name}".

Call the delete_profile tool with name="${name}". Report whether the deletion was successful.`
        )
    );
}

// Everything else — safe for both transports. Includes the whoami prompt (whoami is a read-only
// tool present in HTTP mode) plus all operational prompts (browse/lookup/edit_asset/etc).
export function registerPromptsHttp(server) {
    server.prompt(
        "lookup",
        "Look up a specific DXM asset by its numeric ID or full path",
        { asset: z.string().describe("A numeric asset ID (e.g. \"12345\") or a full CMS path (e.g. \"/Site/Folder/Page\")") },
        ({ asset }) => userMessage(
`Look up the DXM asset identified by "${asset}".

Use the find_asset tool, passing "${asset}" as the query. It accepts either a numeric ID or a full CMS path.

Display the returned metadata: ID, label, type, fullPath, status, and folder_id.`
        )
    );

    server.prompt(
        "browse",
        "Explore the asset tree under a DXM folder",
        { id: z.string().describe("The ID of the folder to browse") },
        ({ id }) => userMessage(
`Explore the DXM folder tree starting from folder ID ${id}.

Use the list_folder tool to get the contents of folder ${id}. For every item where type is "Folder", recursively call list_folder on that item's ID. Continue until the full tree is explored.

Present the results as an indented tree showing each item's label, ID, and type. For example:
  My Folder (id: 123, Folder)
    My Page (id: 456, File)
    Sub Folder (id: 789, Folder)
      Another Page (id: 101, File)`
        )
    );

    server.prompt(
        "read_asset",
        "Read and display the content fields of a DXM asset",
        { id: z.string().describe("The ID of the asset to read") },
        ({ id }) => userMessage(
`Read and display the content of DXM asset ${id}.

Call list_fields to get all fields for asset ${id}. Present each field name and value clearly. If a field named "body" is present, display its content prominently as the main content of the asset.`
        )
    );

    server.prompt(
        "edit_asset",
        "Read a DXM asset's fields then update them to apply a described change",
        {
            id: z.string().describe("The ID of the asset to edit"),
            change: z.string().describe("A description of the change to make")
        },
        ({ id, change }) => userMessage(
`Update the content fields of DXM asset ${id} to make the following change: ${change}

1. Call list_fields to read the current field values for asset ${id}.
2. Determine the minimum set of fields that need to change.
3. Use set_field to update each field that needs to change. Do not modify fields that are already correct.
4. Call list_fields again to confirm the updates were applied, and report what changed.`
        )
    );

    server.prompt(
        "edit_code",
        "Read, modify and save the code on a DXM template asset, then optionally compile",
        {
            id: z.string().describe("The ID of the template asset to edit"),
            change: z.string().describe("A description of the change to make"),
            folder_id: z.string().optional().describe("The ID of the library or project folder to compile after saving (optional)")
        },
        ({ id, change, folder_id }) => userMessage(
`Update the code in DXM asset ${id} to make the following change: ${change}

1. Call get_code to retrieve the current code from asset ${id}.
2. Apply the change: ${change}
3. Call set_code to save the updated code back to asset ${id}.
${folder_id
    ? `4. Compile folder ${folder_id} using compile_library or compile_project as appropriate. Report any errors.`
    : `4. No folder ID was provided, so skip compilation. Inform the user that they may need to compile manually.`
}
5. Report a summary of what was changed.`
        )
    );

    server.prompt(
        "list_links",
        "List the published URLs for a DXM file asset",
        { asset: z.string().describe("A numeric asset ID or a full CMS path") },
        ({ asset }) => userMessage(
`List the published links for the DXM asset identified by "${asset}".

1. If "${asset}" is not a numeric ID, call find_asset to resolve it to a numeric ID.
2. Call list_links with the numeric ID.
3. Display each published link clearly.`
        )
    );

    server.prompt(
        "delete_file",
        "Delete a DXM asset",
        { asset: z.string().describe("A numeric asset ID or a full CMS path") },
        ({ asset }) => userMessage(
`Delete the DXM asset identified by "${asset}".

1. If "${asset}" is not a numeric ID, call find_asset to resolve it to a numeric ID and confirm the label and path before proceeding.
2. Call delete_file with the numeric ID.
3. Report whether the deletion was successful.`
        )
    );

    server.prompt(
        "undelete_file",
        "Undelete a previously deleted DXM asset",
        { asset: z.string().describe("A numeric asset ID or a full CMS path") },
        ({ asset }) => userMessage(
`Undelete the DXM asset identified by "${asset}".

1. If "${asset}" is not a numeric ID, call find_asset to resolve it to a numeric ID.
2. Call undelete_file with the numeric ID.
3. Report whether the operation was successful.`
        )
    );

    server.prompt(
        "branch_file",
        "Branch a DXM asset to create a draft copy",
        { asset: z.string().describe("A numeric asset ID or a full CMS path") },
        ({ asset }) => userMessage(
`Branch the DXM asset identified by "${asset}".

1. If "${asset}" is not a numeric ID, call find_asset to resolve it to a numeric ID.
2. Call branch_file with the numeric ID.
3. Display the metadata of the newly created branch: ID, label, type, fullPath, and status.`
        )
    );

    server.prompt(
        "route_file",
        "Route a DXM asset to a specific workflow state",
        {
            asset: z.string().describe("A numeric asset ID or a full CMS path"),
            state_id: z.string().describe("The numeric ID or name of the workflow state to route the asset to")
        },
        ({ asset, state_id }) => userMessage(
`Route the DXM asset identified by "${asset}" to workflow state ${state_id}.

1. If "${asset}" is not a numeric ID, call find_asset to resolve it to a numeric ID.
2. Call route_file with the numeric asset ID and state ID ${state_id}.
3. Report the result of the routing operation.`
        )
    );

    server.prompt(
        "create_file_from_model",
        "Create a new DXM file asset using a model",
        {
            name: z.string().describe("The name of the new asset"),
            folder: z.string().describe("A numeric folder ID or full CMS path of the destination folder"),
            model: z.string().describe("A numeric model ID or full CMS path of the model to use")
        },
        ({ name, folder, model }) => userMessage(
`Create a new DXM file asset named "${name}" in folder "${folder}" using model "${model}".

1. If "${folder}" is not a numeric ID, call find_asset to resolve it to a numeric ID.
2. If "${model}" is not a numeric ID, call find_asset to resolve it to a numeric ID.
3. Call create_file_from_model with the name, resolved folder ID, and resolved model ID.
4. Display the metadata of the newly created asset: ID, label, type, fullPath, and status.`
        )
    );

    server.prompt(
        "create_file",
        "Create a new DXM file asset using a template and workflow",
        {
            name: z.string().describe("The name of the new asset"),
            folder: z.string().describe("A numeric folder ID or full CMS path of the destination folder"),
            template: z.string().describe("A numeric template ID or full CMS path of the template to use"),
            workflow_id: z.string().describe("The numeric ID of the workflow to use")
        },
        ({ name, folder, template, workflow_id }) => userMessage(
`Create a new DXM file asset named "${name}" in folder "${folder}" using template "${template}" and workflow ID ${workflow_id}.

1. If "${folder}" is not a numeric ID, call find_asset to resolve it to a numeric ID.
2. If "${template}" is not a numeric ID, call find_asset to resolve it to a numeric ID.
3. Call create_file with the name, resolved folder ID, resolved template ID, and workflow ID ${workflow_id}.
4. Display the metadata of the newly created asset: ID, label, type, fullPath, and status.`
        )
    );

    // ------- new path-or-ID prompts -------

    server.prompt(
        "get_path",
        "Look up the full CMS path of an asset",
        {
            asset: z.string().describe("A numeric asset ID or a full CMS path"),
            include_ancestors: z.string().optional().describe('Set to "true" to include the chain of ancestor assets')
        },
        ({ asset, include_ancestors }) => userMessage(
`Look up the path of the DXM asset identified by "${asset}".

1. If "${asset}" is not a numeric ID, call find_asset to resolve it to a numeric ID.
2. Call get_path with the numeric ID${include_ancestors === "true" ? " and include_ancestors=true" : ""}.
3. Report the full path${include_ancestors === "true" ? " and ancestor chain" : ""}.`
        )
    );

    server.prompt(
        "move_file",
        "Move a DXM asset into a different folder",
        {
            asset: z.string().describe("A numeric asset ID or a full CMS path of the asset to move"),
            destination: z.string().describe("A numeric folder ID or a full CMS path of the destination folder")
        },
        ({ asset, destination }) => userMessage(
`Move the DXM asset identified by "${asset}" into folder "${destination}".

1. If "${asset}" is not a numeric ID, call find_asset to resolve it.
2. If "${destination}" is not a numeric ID, call find_asset to resolve it.
3. Call move_file with the numeric asset ID and destination folder ID.
4. Confirm the move by calling find_asset on the asset and reporting its new fullPath.`
        )
    );

    server.prompt(
        "rename_file",
        "Rename a DXM asset",
        {
            asset: z.string().describe("A numeric asset ID or a full CMS path of the asset to rename"),
            new_name: z.string().describe("The new label for the asset")
        },
        ({ asset, new_name }) => userMessage(
`Rename the DXM asset identified by "${asset}" to "${new_name}".

1. If "${asset}" is not a numeric ID, call find_asset to resolve it.
2. Call rename_file with the numeric ID and new_name "${new_name}".
3. Confirm the rename by calling find_asset on the asset and reporting its new label.`
        )
    );

    server.prompt(
        "set_model",
        "Bind a DXM asset to a content model",
        {
            asset: z.string().describe("A numeric asset ID or a full CMS path"),
            model: z.string().describe("A numeric model ID or a full CMS path of the model")
        },
        ({ asset, model }) => userMessage(
`Bind the DXM asset "${asset}" to the model "${model}".

1. If "${asset}" is not a numeric ID, call find_asset to resolve it.
2. If "${model}" is not a numeric ID, call find_asset to resolve it.
3. Call set_model with ids="[<numericAssetId>]" and model_id=<numericModelId>.
4. Report the result.`
        )
    );

    server.prompt(
        "set_template",
        "Bind a DXM asset to a template",
        {
            asset: z.string().describe("A numeric asset ID or a full CMS path"),
            template: z.string().describe("A numeric template ID or a full CMS path of the template")
        },
        ({ asset, template }) => userMessage(
`Bind the DXM asset "${asset}" to the template "${template}".

1. If "${asset}" is not a numeric ID, call find_asset to resolve it.
2. If "${template}" is not a numeric ID, call find_asset to resolve it.
3. Call set_template with ids="[<numericAssetId>]" and template_id=<numericTemplateId>.
4. Report the result.`
        )
    );

    server.prompt(
        "set_workflow",
        "Bind a DXM asset to a workflow",
        {
            asset: z.string().describe("A numeric asset ID or a full CMS path"),
            workflow: z.string().describe("A numeric workflow ID or a full CMS path of the workflow")
        },
        ({ asset, workflow }) => userMessage(
`Bind the DXM asset "${asset}" to the workflow "${workflow}".

1. If "${asset}" is not a numeric ID, call find_asset to resolve it.
2. If "${workflow}" is not a numeric ID, call find_asset to resolve it.
3. Call set_workflow with ids="[<numericAssetId>]" and workflow_id=<numericWorkflowId>.
4. Report the result.`
        )
    );

    server.prompt(
        "publish_file",
        "Publish a DXM asset that is not on a workflow",
        {
            asset: z.string().describe("A numeric asset ID or a full CMS path"),
            skip_dependencies: z.string().optional().describe('Set to "true" to skip dependent assets')
        },
        ({ asset, skip_dependencies }) => userMessage(
`Publish the DXM asset identified by "${asset}".

1. If "${asset}" is not a numeric ID, call find_asset to resolve it.
2. Call publish_file with ids="[<numericId>]"${skip_dependencies === "true" ? " and skip_dependencies=true" : ""}.
3. Confirm publication by calling list_links on the asset and reporting the published URLs.`
        )
    );

    server.prompt(
        "republish_file",
        "Republish a DXM asset to a specific publishing server",
        {
            asset: z.string().describe("A numeric asset ID or a full CMS path"),
            publishing_server_id: z.string().describe("The numeric ID of the publishing server")
        },
        ({ asset, publishing_server_id }) => userMessage(
`Republish the DXM asset identified by "${asset}" to publishing server ${publishing_server_id}.

1. If "${asset}" is not a numeric ID, call find_asset to resolve it.
2. Call republish_file with ids="[<numericId>]" and publishing_server_id=${publishing_server_id}.
3. Report the result.`
        )
    );

    server.prompt(
        "execute_workflow_command",
        "Execute a workflow command on a DXM asset",
        {
            asset: z.string().describe("A numeric asset ID or a full CMS path"),
            command_id: z.string().describe("The numeric ID of the workflow command")
        },
        ({ asset, command_id }) => userMessage(
`Execute workflow command ${command_id} on the DXM asset identified by "${asset}".

1. If "${asset}" is not a numeric ID, call find_asset to resolve it.
2. Call execute_workflow_command with asset_id=<numericId> and command_id=${command_id}.
3. Report the result of the transition.`
        )
    );

    server.prompt(
        "view_output",
        "Render the published HTML output of a DXM asset",
        { asset: z.string().describe("A numeric asset ID or a full CMS path") },
        ({ asset }) => userMessage(
`Render the published HTML output of the DXM asset identified by "${asset}".

1. If "${asset}" is not a numeric ID, call find_asset to resolve it.
2. Call view_output with the numeric ID.
3. Display the rendered HTML.`
        )
    );

    server.prompt(
        "create_folder",
        "Create a new folder in DXM",
        {
            name: z.string().describe("The name of the new folder"),
            folder: z.string().describe("A numeric folder ID or full CMS path of the parent folder")
        },
        ({ name, folder }) => userMessage(
`Create a new folder named "${name}" inside parent folder "${folder}".

1. If "${folder}" is not a numeric ID, call find_asset to resolve it.
2. Call create_folder with name="${name}" and folder_id=<numericId>.
3. Display the metadata of the new folder.`
        )
    );

    server.prompt(
        "create_folder_with_model",
        "Create a new folder bound to a content model",
        {
            name: z.string().describe("The name of the new folder"),
            folder: z.string().describe("A numeric folder ID or full CMS path of the parent folder"),
            model: z.string().describe("A numeric model ID or full CMS path of the model")
        },
        ({ name, folder, model }) => userMessage(
`Create a new folder named "${name}" inside parent folder "${folder}" bound to model "${model}".

1. If "${folder}" is not a numeric ID, call find_asset to resolve it.
2. If "${model}" is not a numeric ID, call find_asset to resolve it.
3. Call create_folder_with_model with name="${name}", folder_id=<numericFolderId>, and model_id=<numericModelId>.
4. Display the metadata of the new folder.`
        )
    );

    server.prompt(
        "create_project",
        "Create a new DXM project",
        {
            name: z.string().describe("The name of the new project"),
            folder: z.string().describe("A numeric folder ID or full CMS path of the destination folder"),
            library_name: z.string().describe("The name of the library folder to create inside the project")
        },
        ({ name, folder, library_name }) => userMessage(
`Create a new project named "${name}" in folder "${folder}" with a library folder named "${library_name}".

1. If "${folder}" is not a numeric ID, call find_asset to resolve it.
2. Call create_project with name="${name}", folder_id=<numericId>, library_name="${library_name}".
3. Display the metadata of the new project.`
        )
    );

    server.prompt(
        "create_site_root",
        "Create a new DXM site root",
        {
            name: z.string().describe("The name of the new site root"),
            folder: z.string().describe("A numeric folder ID or full CMS path of the destination folder")
        },
        ({ name, folder }) => userMessage(
`Create a new site root named "${name}" in folder "${folder}".

1. If "${folder}" is not a numeric ID, call find_asset to resolve it.
2. Call create_site_root with name="${name}" and folder_id=<numericId>.
3. Display the metadata of the new site root.`
        )
    );

    server.prompt(
        "create_library_reference",
        "Create a new DXM library reference",
        {
            name: z.string().describe("The name of the new library reference"),
            folder: z.string().describe("A numeric folder ID or full CMS path of the destination folder"),
            library: z.string().describe("A numeric library folder ID or full CMS path of the library to reference")
        },
        ({ name, folder, library }) => userMessage(
`Create a new library reference named "${name}" in folder "${folder}" pointing at library "${library}".

1. If "${folder}" is not a numeric ID, call find_asset to resolve it.
2. If "${library}" is not a numeric ID, call find_asset to resolve it.
3. Call create_library_reference with name="${name}", folder_id=<numericFolderId>, library_id=<numericLibraryId>.
4. Display the metadata of the new library reference.`
        )
    );

    server.prompt(
        "whoami",
        "Show the current DXM authentication state",
        {},
        () => userMessage(
`Report the current DXM authentication state.

Call the whoami tool and display the returned fields: authenticated, server, instance, and username. Do not echo any password or API key — whoami deliberately omits them.`
        )
    );

    // ------- read prompts -------

    server.prompt(
        "get_code",
        "Read the code stored on a DXM template asset",
        { asset: z.string().describe("A numeric asset ID or a full CMS path") },
        ({ asset }) => userMessage(
`Read the code stored on the DXM asset identified by "${asset}".

1. If "${asset}" is not a numeric ID, call find_asset to resolve it.
2. Call get_code with the numeric ID.
3. Display the returned code.`
        )
    );

    server.prompt(
        "download_image",
        "Download an image asset from DXM",
        { asset: z.string().describe("A numeric asset ID or a full CMS path") },
        ({ asset }) => userMessage(
`Download the image asset identified by "${asset}".

1. If "${asset}" is not a numeric ID, call find_asset to resolve it.
2. Call download_image with the numeric ID. The result is returned as an MCP image block.`
        )
    );

    server.prompt(
        "download_file",
        "Download a binary file asset from DXM",
        { asset: z.string().describe("A numeric asset ID or a full CMS path") },
        ({ asset }) => userMessage(
`Download the binary file asset identified by "${asset}".

1. If "${asset}" is not a numeric ID, call find_asset to resolve it.
2. Call download_file with the numeric ID. The result is a JSON envelope containing mimeType, encoding ("base64"), and data.`
        )
    );

    server.prompt(
        "list_workflows",
        "List the System-level workflows on this DXM instance",
        {},
        () => userMessage(
`List the System-level workflows on this DXM instance.

Call list_workflows. Present each workflow's name and ID, and summarize its states. Note that project-scoped workflows are not returned by this tool.`
        )
    );

    server.prompt(
        "get_workflow",
        "Show the details of a specific workflow including its states and commands",
        { workflow: z.string().describe("A numeric workflow ID or a full CMS path") },
        ({ workflow }) => userMessage(
`Show the details of the workflow identified by "${workflow}".

1. If "${workflow}" is not a numeric ID, call find_asset to resolve it.
2. Call get_workflow with the numeric ID.
3. Present each state, the commands available from that state, and the transitions they trigger.`
        )
    );

    server.prompt(
        "list_attachments",
        "List the attachments on a DXM asset",
        { asset: z.string().describe("A numeric asset ID or a full CMS path") },
        ({ asset }) => userMessage(
`List the attachments on the DXM asset identified by "${asset}".

1. If "${asset}" is not a numeric ID, call find_asset to resolve it.
2. Call list_attachments with the numeric ID.
3. Display each attachment.`
        )
    );

    server.prompt(
        "read_site_root",
        "Get the site-root details for a DXM asset",
        { asset: z.string().describe("A numeric asset ID or a full CMS path") },
        ({ asset }) => userMessage(
`Get the site-root details for the DXM asset identified by "${asset}".

1. If "${asset}" is not a numeric ID, call find_asset to resolve it.
2. Call read_site_root with the numeric ID.
3. Display the site-root configuration.`
        )
    );

    server.prompt(
        "list_users",
        "List the users visible to the authenticated DXM session",
        {},
        () => userMessage(
`List the DXM users visible to the authenticated session.

Call list_users and present each user's identifying details.`
        )
    );

    server.prompt(
        "publishing_errors",
        "Show a report of any recent DXM publishing errors",
        {},
        () => userMessage(
`Show a report of any recent publishing errors.

Call publishing_errors and present the returned list of assets.`
        )
    );

    server.prompt(
        "site_summary",
        "Show a summary report of the DXM instance",
        {},
        () => userMessage(
`Show a summary report of the DXM instance.

Call site_summary and present the returned summary.`
        )
    );

    // ------- field write prompts -------

    server.prompt(
        "set_field",
        "Set a single field on a DXM asset",
        {
            asset: z.string().describe("A numeric asset ID or a full CMS path"),
            name: z.string().describe("The name of the field to set"),
            value: z.string().describe("The value to write to the field")
        },
        ({ asset, name, value }) => userMessage(
`Set the field "${name}" on the DXM asset identified by "${asset}" to the value: ${value}

1. If "${asset}" is not a numeric ID, call find_asset to resolve it.
2. Call set_field with id=<numericId>, name="${name}", value=<the value above>.
3. Confirm by calling list_fields and reporting the new value of "${name}".`
        )
    );

    server.prompt(
        "set_fields",
        "Set multiple fields on a DXM asset",
        {
            asset: z.string().describe("A numeric asset ID or a full CMS path"),
            fields: z.string().describe('Fields to set as a JSON object, e.g. {"title":"Hello","body":"..."}')
        },
        ({ asset, fields }) => userMessage(
`Set the following fields on the DXM asset identified by "${asset}": ${fields}

1. If "${asset}" is not a numeric ID, call find_asset to resolve it.
2. Call set_fields with id=<numericId> and fields=${fields}.
3. Confirm by calling list_fields and reporting the updated field values.`
        )
    );

    server.prompt(
        "delete_field",
        "Delete a single field from a DXM asset",
        {
            asset: z.string().describe("A numeric asset ID or a full CMS path"),
            name: z.string().describe("The name of the field to delete")
        },
        ({ asset, name }) => userMessage(
`Delete the field "${name}" from the DXM asset identified by "${asset}".

1. If "${asset}" is not a numeric ID, call find_asset to resolve it.
2. Call delete_field with id=<numericId> and name="${name}".
3. Confirm by calling list_fields and reporting that "${name}" is no longer present.`
        )
    );

    server.prompt(
        "delete_fields",
        "Delete multiple fields from a DXM asset",
        {
            asset: z.string().describe("A numeric asset ID or a full CMS path"),
            fields: z.string().describe('Field names to delete as a JSON array, e.g. ["title","body"]')
        },
        ({ asset, fields }) => userMessage(
`Delete the following fields from the DXM asset identified by "${asset}": ${fields}

1. If "${asset}" is not a numeric ID, call find_asset to resolve it.
2. Call delete_fields with id=<numericId> and fields=${fields}.
3. Confirm by calling list_fields and reporting that the named fields are no longer present.`
        )
    );

    server.prompt(
        "set_code",
        "Replace the code stored on a DXM template asset",
        {
            asset: z.string().describe("A numeric asset ID or a full CMS path"),
            code: z.string().describe("The full replacement code to write to the asset")
        },
        ({ asset, code }) => userMessage(
`Replace the code on the DXM asset identified by "${asset}" with the following:

\`\`\`
${code}
\`\`\`

1. If "${asset}" is not a numeric ID, call find_asset to resolve it.
2. Call set_code with id=<numericId> and the code shown above.
3. Confirm by calling get_code and reporting the new content.`
        )
    );

    server.prompt(
        "log_message",
        "Write a message to the DXM log, optionally attached to an asset",
        {
            message: z.string().describe("The message to log"),
            asset: z.string().optional().describe("Optional: a numeric asset ID or full CMS path to attach the log message to")
        },
        ({ message, asset }) => userMessage(
`Write the following message to the DXM log: ${message}
${asset
    ? `\nAttach the message to the asset identified by "${asset}".\n\n1. If "${asset}" is not a numeric ID, call find_asset to resolve it.\n2. Call log_message with message=<the message above> and asset_id=<numericId>.`
    : `\n1. Call log_message with message=<the message above> and no asset_id, so the message goes to the system log.`
}`
        )
    );

    // ------- compile prompts -------

    server.prompt(
        "compile_library",
        "Compile the code in a DXM library folder",
        { folder: z.string().describe("A numeric folder ID or full CMS path of the library folder") },
        ({ folder }) => userMessage(
`Compile the code in the DXM library folder identified by "${folder}".

1. If "${folder}" is not a numeric ID, call find_asset to resolve it.
2. Call compile_library with the numeric ID.
3. Report whether compilation succeeded, and surface any error messages verbatim.`
        )
    );

    server.prompt(
        "compile_project",
        "Compile the code and templates under a DXM project folder",
        { folder: z.string().describe("A numeric folder ID or full CMS path of the project folder") },
        ({ folder }) => userMessage(
`Compile the code and templates under the DXM project folder identified by "${folder}".

1. If "${folder}" is not a numeric ID, call find_asset to resolve it.
2. Call compile_project with the numeric ID.
3. Report whether compilation succeeded, and surface any error messages verbatim.`
        )
    );

    server.prompt(
        "compile_templates",
        "Compile the templates inside a DXM templates folder",
        { folder: z.string().describe("A numeric folder ID or full CMS path of the templates folder") },
        ({ folder }) => userMessage(
`Compile the templates inside the DXM templates folder identified by "${folder}".

1. If "${folder}" is not a numeric ID, call find_asset to resolve it.
2. Call compile_templates with the numeric ID.
3. Report whether compilation succeeded, and surface any error messages verbatim.`
        )
    );

    // ------- binary upload prompts -------

    server.prompt(
        "upload_file",
        "Upload a local file as a new DXM asset",
        {
            path: z.string().describe("Filesystem path to the file (reachable from the MCP server)"),
            folder: z.string().describe("A numeric folder ID or full CMS path of the destination folder"),
            name: z.string().optional().describe("Optional name for the new asset (defaults to the file's basename)")
        },
        ({ path, folder, name }) => userMessage(
`Upload the file at "${path}" as a new DXM asset in folder "${folder}"${name ? ` named "${name}"` : ""}.

1. If "${folder}" is not a numeric ID, call find_asset to resolve it.
2. Call upload_file with path="${path}", folder_id=<numericId>${name ? `, name="${name}"` : ""}.
3. Display the metadata of the newly created asset.`
        )
    );

    server.prompt(
        "attach_file",
        "Attach a local file to an existing DXM asset",
        {
            asset: z.string().describe("A numeric asset ID or full CMS path of the asset to attach to"),
            path: z.string().describe("Filesystem path to the file (reachable from the MCP server)"),
            original_filename: z.string().optional().describe("Optional original filename (defaults to the file's basename)")
        },
        ({ asset, path, original_filename }) => userMessage(
`Attach the file at "${path}" to the DXM asset identified by "${asset}"${original_filename ? ` with original_filename="${original_filename}"` : ""}.

1. If "${asset}" is not a numeric ID, call find_asset to resolve it.
2. Call attach_file with asset_id=<numericId>, path="${path}"${original_filename ? `, original_filename="${original_filename}"` : ""}.
3. Report the result.`
        )
    );

    server.prompt(
        "upload_replace_file",
        "Replace an existing DXM file asset's content with a local file",
        {
            path: z.string().describe("Filesystem path to the new file content (reachable from the MCP server)"),
            asset: z.string().describe("A numeric asset ID or full CMS path of the file asset to replace"),
            name: z.string().optional().describe("Optional name for the replaced asset (defaults to the file's basename)")
        },
        ({ path, asset, name }) => userMessage(
`Replace the content of the DXM file asset identified by "${asset}" with the file at "${path}"${name ? `, naming it "${name}"` : ""}.

1. If "${asset}" is not a numeric ID, call find_asset to resolve it.
2. Call upload_replace_file with file_id=<numericId>, path="${path}"${name ? `, name="${name}"` : ""}.
3. Display the metadata of the updated asset.`
        )
    );
}

// Stdio convenience: every prompt. HTTP entry points should call registerPromptsHttp directly.
export function registerPrompts(server) {
    registerCredentialPrompts(server);
    registerPromptsHttp(server);
}
