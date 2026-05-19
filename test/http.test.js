import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { z } from "zod";

import { createHttpHandler } from "../dxm/http.js";

// Register a single trivial tool to verify the dispatch chain works without depending on the
// full DXM tool surface (which would require a fake _cms for every domain).
function registerEchoTool(mcp) {
    mcp.tool(
        "echo",
        "Echoes the input back",
        { value: z.string() },
        async ({ value }) => ({ content: [{ type: "text", text: `echo:${value}` }] })
    );
}

let server;
let baseUrl;

async function postJson(body, headers = {}) {
    return await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "accept": "application/json, text/event-stream",
            ...headers
        },
        body: JSON.stringify(body)
    });
}

// SSE responses look like: `event: message\ndata: {...}\n\n`. Extract the JSON.
function parseSse(text) {
    const match = text.match(/^data: (.+)$/m);
    if (!match) throw new Error(`No SSE data frame in: ${text.slice(0, 200)}`);
    return JSON.parse(match[1]);
}

before(async () => {
    await new Promise(resolve => {
        server = http.createServer(createHttpHandler({
            serverName: "http-test",
            serverVersion: "0.0.0",
            registerTools: registerEchoTool,
            host: "127.0.0.1"
        }));
        server.listen(0, "127.0.0.1", () => {
            const { port } = server.address();
            baseUrl = `http://127.0.0.1:${port}`;
            resolve();
        });
    });
});

after(async () => {
    await new Promise(resolve => server.close(resolve));
});

describe("HTTP transport", () => {
    test("rejects unsupported methods with 405", async () => {
        const r = await fetch(`${baseUrl}/mcp`, { method: "PUT" });
        assert.equal(r.status, 405);
    });

    test("rejects paths other than /mcp with 404", async () => {
        const r = await fetch(`${baseUrl}/other`, { method: "POST" });
        assert.equal(r.status, 404);
    });

    test("returns 400 on malformed JSON body", async () => {
        const r = await fetch(`${baseUrl}/mcp`, {
            method: "POST",
            headers: { "content-type": "application/json", "accept": "application/json, text/event-stream" },
            body: "{not valid json"
        });
        assert.equal(r.status, 400);
    });

    test("DNS rebinding protection: rejects non-loopback Host header with 403", async () => {
        // fetch() puts Host on the forbidden-headers list, so use raw http.request.
        const { port } = server.address();
        const status = await new Promise((resolve, reject) => {
            const req = http.request({
                host: "127.0.0.1", port, path: "/mcp", method: "POST",
                headers: {
                    "host": "evil.example.com",
                    "content-type": "application/json",
                    "accept": "application/json, text/event-stream"
                }
            }, res => {
                res.on("data", () => {});
                res.on("end", () => resolve(res.statusCode));
            });
            req.on("error", reject);
            req.setTimeout(5000, () => { req.destroy(new Error("timed out")); });
            req.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "x", version: "0" } } }));
        });
        assert.equal(status, 403);
    });

    test("initialize handshake succeeds and reports server info", async () => {
        const r = await postJson({
            jsonrpc: "2.0", id: 1, method: "initialize",
            params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } }
        });
        assert.equal(r.status, 200);
        const msg = parseSse(await r.text());
        assert.equal(msg.result.serverInfo.name, "http-test");
        assert.equal(msg.result.serverInfo.version, "0.0.0");
    });

    test("tools/list returns the registered tool", async () => {
        const r = await postJson({ jsonrpc: "2.0", id: 2, method: "tools/list" });
        const msg = parseSse(await r.text());
        const names = msg.result.tools.map(t => t.name);
        assert.deepEqual(names, ["echo"]);
    });

    test("tools/call dispatches to the registered handler", async () => {
        const r = await postJson({
            jsonrpc: "2.0", id: 3, method: "tools/call",
            params: { name: "echo", arguments: { value: "hi" } }
        });
        const msg = parseSse(await r.text());
        assert.equal(msg.result.content[0].text, "echo:hi");
    });
});
