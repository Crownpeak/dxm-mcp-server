import { toolHandler, jsonText } from "./util.js";

export function registerReadTools(server, dxm) {
    server.tool(
        "publishing_errors",
        "Get a report of any recent publishing errors",
        {},
        toolHandler(async () => jsonText(await dxm.publishingErrors()))
    );

    server.tool(
        "site_summary",
        "Get a summary report of the DXM instance",
        {},
        toolHandler(async () => jsonText(await dxm.siteSummary()))
    );
}
