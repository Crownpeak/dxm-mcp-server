import { z } from "zod";
import { toolHandler, jsonText, parseIdList } from "./util.js";

// `/Asset/Publish` answers with one `publishingSessionId`; `/Asset/PublishRefresh` with a list.
// Swagger declares the latter PascalCase while the wire is camelCase elsewhere, so accept both.
export function publishingSessionIds(response) {
    if (!response) return [];
    const list = response.publishingSessionIds ?? response.PublishingSessionIds;
    const single = response.publishingSessionId ?? response.PublishingSessionId;
    const ids = Array.isArray(list) && list.length ? list : (single ? [single] : []);
    return ids.filter(id => typeof id === "number" && id > 0);
}

// The helper does not throw when the CMS refuses a publish: it hands back
// `{ resultCode: "conWS_HasFailures", isSuccessful: false, publishingSessionId: -1, errorMessage }`
// (observed live for "User is not allowed to publish this asset"). With no session started that is
// a failure and must surface as one; with a session started some assets may still have been
// refused, so the CMS's message travels alongside the ids instead of being dropped.
// `hint` is added when the CMS started nothing without saying why.
export function publishResult(response, hint = null) {
    const ids = publishingSessionIds(response);
    const failed = response?.isSuccessful === false;
    if (ids.length === 0) {
        if (failed && response.errorMessage) throw new Error(response.errorMessage);
        throw new Error(hint ? `The CMS did not start a publishing session. ${hint}` : "The CMS did not start a publishing session.");
    }
    return failed ? { publishingSessionIds: ids, errors: response.errorMessage ?? null } : { publishingSessionIds: ids };
}

export function registerReadTools(server, dxm) {
    server.tool(
        "list_links",
        "Get the published links for a DXM file asset. By default returns only \"live\" or \"prod\" package URLs; pass all=true to bypass the filter.",
        {
            id: z.number().describe("The ID of the asset"),
            all: z.boolean().optional().describe("When true, include every published URL regardless of package name")
        },
        toolHandler(async ({id, all}) => {
            const links = (await dxm.getPublishLinks(id)).urls;
            if (all) return jsonText(links);
            const livePackageNames = ["live", "prod"];
            const liveLinks = links.filter(link =>
                livePackageNames.some(name => link.packageName.toLowerCase().includes(name))
            );
            return { content: [{ type: "text", text: liveLinks.map(link => link.path).join("\r\n") }] };
        })
    );

    server.tool(
        "publishing_activity_summary",
        "Check the progress of publishing started by the authenticated user (via publish_file, republish_file, or a route_file / execute_workflow_command into a publishing step). Each session reports done/isSuccessful/errors plus processed vs total counts; endDate is null until done. Pass session_id (as returned by publish_file / republish_file) to check one session, or asset_id to see the sessions for one asset — use asset_id after routing, which returns no session id. Omit both to list recent sessions. Publishing continues after those tools return and can take a minute or more, so poll this rather than assuming a publish has finished.",
        {
            session_id: z.number().optional().describe("A publishing session ID to narrow the result to"),
            asset_id: z.number().optional().describe("An asset ID; narrows to the sessions started for that asset")
        },
        toolHandler(async ({session_id, asset_id}) =>
            jsonText(await dxm.publishingActivitySummary({ sessionId: session_id, assetId: asset_id })))
    );

    server.tool(
        "publishing_packages",
        "List the CMS's publishing packages: the destinations publishing goes to, typically one per site and environment (e.g. \"... Live\", \"... Stage\"). Each has its id, name, whether it is enabled, the host name and path it publishes to, its connectors (FTP, Azure Blob Storage, ... by id, name and type), and any Search G2 collection, CaaS collection or Smart Search generator it feeds. Deleted packages are omitted. Connection details and credentials are never included. A package's id is what republish_file takes as publishing_server_id, and what a workflow's publishing rules (read_workflow) call publishingServerId.",
        {},
        toolHandler(async () => jsonText(await dxm.publishingPackages()))
    );

    server.tool(
        "ftp_servers",
        "List the CMS's FTP publishing servers: the connectors publishing packages send files through (publishing_packages lists each package's connectors by these ids). Each has its id, name, hostname, root path, secure/active mode, safe-write flag and inUse. Deleted servers are omitted. Usernames and passwords are never included.",
        {},
        toolHandler(async () => jsonText(await dxm.ftpServers()))
    );
}

export function registerWriteTools(server, dxm) {
    server.tool(
        "publish_file",
        "Publish one or more DXM assets that are not on a workflow. Returns the publishingSessionIds started; publishing continues after this returns, so pass one to publishing_activity_summary to see when it finishes.",
        {
            ids: z.string().describe('Asset IDs to publish, as a JSON array (e.g. "[12345]") or a single numeric ID'),
            include_dependencies: z.boolean().optional().describe("When true, also publish the assets these depend on. Default false: only the assets given are published")
        },
        toolHandler(async ({ids, include_dependencies}) => {
            const idList = parseIdList(ids);
            const response = await dxm.publishAssets(idList, include_dependencies === true);
            return jsonText(publishResult(response));
        })
    );

    server.tool(
        "republish_file",
        "Republish one or more DXM assets to one publishing package (the CMS calls it a publishing server). publishing_server_id is a package id from publishing_packages, not an FTP server id from ftp_servers. Returns the publishingSessionIds started; pass one to publishing_activity_summary to see when it finishes.",
        {
            ids: z.string().describe('Asset IDs to republish, as a JSON array (e.g. "[12345]") or a single numeric ID'),
            publishing_server_id: z.number().describe("The id of the publishing package to republish to, from publishing_packages"),
            include_dependencies: z.boolean().optional().describe("When true, also republish the assets these depend on. Default false: only the assets given are republished")
        },
        toolHandler(async ({ids, publishing_server_id, include_dependencies}) => {
            const idList = parseIdList(ids);
            const response = await dxm.republishAssets(idList, publishing_server_id, include_dependencies === true);
            // Verified on CPUK: an id that isn't a package (e.g. an FTP server's) comes back as
            // conWS_Success with publishingSessionId -1 and no message.
            return jsonText(publishResult(response,
                `Check that publishing_server_id (${publishing_server_id}) is a package id from publishing_packages; an id that isn't a package starts nothing and the CMS gives no error.`));
        })
    );
}
