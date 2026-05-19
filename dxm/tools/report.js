import { toolHandler, jsonText } from "./util.js";

export function registerReadTools(server, dxm) {
    server.tool(
        "site_summary",
        "Get a summary report of the DXM instance",
        {},
        toolHandler(async () => jsonText(await dxm.siteSummary()))
    );
}
