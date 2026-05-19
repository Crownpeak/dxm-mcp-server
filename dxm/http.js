import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

// Vanilla node:http + StreamableHTTPServerTransport in stateless mode. A fresh McpServer + transport
// is built per request — cheap because tool registration is synchronous and the Dxm singleton (which
// holds the helper client and credentials) is shared. Stateless mode means no mcp-session-id headers,
// no server-side session store, and no server-initiated requests (elicitation, sampling).

const SUPPORTED_METHODS = new Set(["POST", "GET", "DELETE"]);

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", chunk => chunks.push(chunk));
        req.on("end", () => {
            if (chunks.length === 0) return resolve(undefined);
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch (e) {
                reject(e);
            }
        });
        req.on("error", reject);
    });
}

function send(res, status, payload) {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
}

// Loopback host check: SDK uses strict string equality on the Host header. We accept any of the
// three loopback aliases against the actual bound port (read at request time from req.socket so
// ephemeral-port test binds work). The check is only enabled when the server bound to a loopback
// address — binding to a public interface implies the operator opted in, so we trust their setup.
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function buildTransport(req, host) {
    const isLoopback = LOOPBACK_HOSTS.has(host);
    if (!isLoopback) {
        return new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    }
    const port = req.socket.localPort;
    return new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableDnsRebindingProtection: true,
        allowedHosts: [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]
    });
}

export function createHttpHandler({ registerTools, serverName, serverVersion, host }) {
    return async (req, res) => {
        if (!SUPPORTED_METHODS.has(req.method)) {
            send(res, 405, { error: "Method not allowed" });
            return;
        }
        // Path-strip query so /mcp?foo=bar still matches.
        const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
        if (url.pathname !== "/mcp") {
            send(res, 404, { error: "Not found" });
            return;
        }

        let body;
        if (req.method === "POST") {
            try {
                body = await readBody(req);
            } catch (e) {
                send(res, 400, { error: "Invalid JSON body", detail: e.message });
                return;
            }
        }

        let mcp;
        let transport;
        try {
            mcp = new McpServer({ name: serverName, version: serverVersion });
            registerTools(mcp);
            transport = buildTransport(req, host);
            res.on("close", () => {
                transport?.close().catch(() => {});
                mcp?.close().catch(() => {});
            });
            await mcp.connect(transport);
            await transport.handleRequest(req, res, body);
        } catch (e) {
            // Guarantee a response on any error, including registration errors that fire before
            // the transport gets to send its own. Otherwise the client just hangs.
            if (!res.headersSent) {
                send(res, 500, { error: "Internal error", detail: e.message });
            }
        }
    };
}

export function startHttpServer({ registerTools, serverName, serverVersion }) {
    const port = Number.parseInt(process.env.PORT ?? "3000", 10);
    const host = process.env.HOST ?? "127.0.0.1";
    const server = http.createServer(
        createHttpHandler({ registerTools, serverName, serverVersion, host })
    );
    server.listen(port, host, () => {
        console.error(`[${serverName}] HTTP MCP server listening on http://${host}:${port}/mcp`);
        if (host === "0.0.0.0") {
            console.error(`[${serverName}] WARNING: bound to 0.0.0.0 — the .env-loaded CMS credentials are reachable from any host that can connect to this port.`);
        }
    });
    return server;
}
