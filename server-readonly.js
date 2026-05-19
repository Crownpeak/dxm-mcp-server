import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import * as dotenv from "dotenv";
import Dxm from "./dxm/index.js";
import { registerReadTools, registerPrompts } from "./dxm/tools/index.js";

dotenv.config();
const dxm = new Dxm(process.env);

const server = new McpServer({
    name: "Crownpeak DXM MCP Server (read-only)",
    version: "1.0.0"
});

registerReadTools(server, dxm);
registerPrompts(server);

const transport = new StdioServerTransport();
await server.connect(transport);
