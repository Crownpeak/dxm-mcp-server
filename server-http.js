import * as dotenv from "dotenv";
import Dxm from "./dxm/index.js";
import { registerReadToolsHttp, registerWriteTools, registerPromptsHttp } from "./dxm/tools/index.js";
import { startHttpServer } from "./dxm/http.js";

dotenv.config();
const dxm = new Dxm(process.env);

if (!dxm._credentials) {
    console.error("[Crownpeak DXM MCP Server (HTTP)] WARNING: no CMS_* env vars found — every tool call will fail with \"Not authenticated\" until CMS_SERVER/CMS_INSTANCE/CMS_USERNAME/CMS_PASSWORD/CMS_API_KEY are set and the server is restarted.");
}

startHttpServer({
    serverName: "Crownpeak DXM MCP Server (HTTP)",
    serverVersion: "1.0.0",
    registerTools: server => {
        registerReadToolsHttp(server, dxm);
        registerWriteTools(server, dxm);
        registerPromptsHttp(server);
    }
});
