import { z } from "zod";
import { toolHandler, jsonText, parseIdList } from "./util.js";

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
}

export function registerWriteTools(server, dxm) {
    server.tool(
        "publish_file",
        "Publish one or more DXM assets that are not on a workflow",
        {
            ids: z.string().describe('Asset IDs to publish, as a JSON array (e.g. "[12345]") or a single numeric ID'),
            skip_dependencies: z.boolean().optional().describe("When true, do not also publish dependent assets")
        },
        toolHandler(async ({ids, skip_dependencies}) => {
            const idList = parseIdList(ids);
            await dxm.publishAssets(idList, !!skip_dependencies);
            return { content: [] };
        })
    );

    server.tool(
        "republish_file",
        "Republish one or more DXM assets to a specific publishing server",
        {
            ids: z.string().describe('Asset IDs to republish, as a JSON array (e.g. "[12345]") or a single numeric ID'),
            publishing_server_id: z.number().describe("The ID of the publishing server"),
            skip_dependencies: z.boolean().optional().describe("When true, do not also republish dependent assets")
        },
        toolHandler(async ({ids, publishing_server_id, skip_dependencies}) => {
            const idList = parseIdList(ids);
            await dxm.republishAssets(idList, publishing_server_id, !!skip_dependencies);
            return { content: [] };
        })
    );
}
