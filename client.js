import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema, ElicitRequestSchema, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import * as readline from "node:readline/promises";
import * as fs from "node:fs";
import * as path from "node:path";
import { isDebugEnabled, truncate } from "./dxm/debug.js";

// Single shared readline interface for the whole process. Creating a second
// readline.Interface while one is already attached to stdin causes every
// keystroke to be echoed twice (both interfaces listen on 'data' in line mode).
let sharedRl = null;
function getReadline() {
    if (!sharedRl) {
        sharedRl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
    }
    return sharedRl;
}

async function cleanup(transport) {
    if (sharedRl) {
        sharedRl.close();
        sharedRl = null;
    }
    if (transport) {
        await transport.close();
    }
}

function askMasked(question) {
    return new Promise((resolve, reject) => {
        const stdin = process.stdin;
        const stdout = process.stdout;
        if (!stdin.isTTY) {
            const rl = readline.createInterface({ input: stdin, output: stdout });
            rl.question(question).then(answer => { rl.close(); resolve(answer); }, reject);
            return;
        }
        stdout.write(question);
        const wasRaw = stdin.isRaw;
        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding("utf8");
        let buf = "";
        const onData = (chunk) => {
            for (const ch of chunk) {
                const code = ch.charCodeAt(0);
                if (ch === "\r" || ch === "\n") {
                    stdin.removeListener("data", onData);
                    stdin.setRawMode(wasRaw);
                    stdin.pause();
                    stdout.write("\n");
                    resolve(buf);
                    return;
                }
                if (code === 3) {
                    stdin.removeListener("data", onData);
                    stdin.setRawMode(wasRaw);
                    stdin.pause();
                    stdout.write("\n");
                    reject(new Error("Cancelled"));
                    return;
                }
                if (code === 8 || code === 127) {
                    if (buf.length > 0) {
                        buf = buf.slice(0, -1);
                        stdout.write("\b \b");
                    }
                    continue;
                }
                if (code < 32) continue;
                buf += ch;
                stdout.write("*");
            }
        };
        stdin.on("data", onData);
    });
}

// Prompts the user via readline for each field in a form-mode elicitation request.
// Password-like fields (where minLength is set or the title hints at a secret) are masked.
async function handleElicitationRequest(request) {
    const params = request.params ?? {};
    if (params.mode !== "form") {
        return { action: "decline", content: {} };
    }
    const schema = params.requestedSchema ?? {};
    const properties = schema.properties ?? {};
    const required = new Set(schema.required ?? []);
    const message = params.message ?? "Please provide the following information:";

    console.log("\n" + message);
    console.log('(Type "cancel" at any prompt to dismiss.)');
    const content = {};
    for (const [key, propSchema] of Object.entries(properties)) {
        const title = propSchema.title ?? key;
        const isSecret = /password|api[_ ]?key|token|secret/i.test(title) || /password|api[_ ]?key|token|secret/i.test(key);
        const promptStr = `${title}${required.has(key) ? "" : " (optional)"}: `;
        let value;
        if (isSecret) {
            // readline puts the TTY in its own raw-mode keypress loop and echoes
            // every char. askMasked installs its own raw-mode listener that writes
            // '*'. If both are live, the user sees both the real char and the star.
            // Fully close the shared readline so its keypress handler detaches; it
            // lazily recreates on the next non-masked prompt.
            if (sharedRl) { sharedRl.close(); sharedRl = null; }
            try {
                value = await askMasked(promptStr);
            } catch {
                return { action: "cancel", content: {} };
            }
        } else {
            value = await getReadline().question(promptStr);
        }
        value = value.trim();
        if (value.toLowerCase() === "cancel") return { action: "cancel", content: {} };
        if (value === "" && !required.has(key)) continue;
        if (propSchema.type === "number" || propSchema.type === "integer") {
            content[key] = Number(value);
        } else if (propSchema.type === "boolean") {
            content[key] = /^(y|yes|true|1)$/i.test(value);
        } else {
            content[key] = value;
        }
    }
    return { action: "accept", content };
}

async function processQuery(client, query) {
    if (!client) {
        throw new Error("Client not connected");
    }

    const toolsResponse = await client.request(
        { method: "tools/list" },
        ListToolsResultSchema
    );
    const tools = toolsResponse.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema
    }));

    const parts = [];
    let i = 0;
    while (i < query.length) {
        while (i < query.length && query[i] === ' ') i++;
        if (i >= query.length) break;
        if (query[i] === '"' || query[i] === "'") {
            const quote = query[i++];
            let token = '';
            while (i < query.length && query[i] !== quote) token += query[i++];
            if (i < query.length) i++;
            parts.push(token);
        } else {
            let token = '';
            while (i < query.length && query[i] !== ' ') token += query[i++];
            parts.push(token);
        }
    }
    const tool = tools.find(t => t.name === parts[0]);
    if (!tool) {
        return `Unknown tool "${parts[0]}". Available tools: ${tools.map(t => t.name).join(", ")}`;
    }

    const paramNames = Object.keys(tool.input_schema.properties ?? {});
    const arguments_ = {};
    for (let i = 0; i < paramNames.length; i++) {
        const name = paramNames[i];
        const schema = tool.input_schema.properties[name];
        const raw = parts[i + 1];
        if (raw === undefined) break;
        if (schema.type === "number" || schema.type === "integer") {
            arguments_[name] = Number(raw);
        } else if (schema.type === "boolean") {
            arguments_[name] = raw === "true";
        } else {
            arguments_[name] = raw;
        }
    }

    if (isDebugEnabled()) console.error(`[dxm-mcp-client] → ${tool.name} ${truncate(arguments_)}`);
    const start = Date.now();
    const result = await client.request(
        { method: "tools/call", params: { name: tool.name, arguments: arguments_ } },
        CallToolResultSchema
    );
    if (isDebugEnabled()) console.error(`[dxm-mcp-client] ← ${tool.name} (${Date.now() - start}ms) ${truncate(result)}`);

    const block = result.content[0];
    if (!block) return "OK";
    if (block.type === "image") {
        const ext = block.mimeType?.split("/")[1] ?? "bin";
        const filename = `download.${ext}`;
        fs.writeFileSync(filename, Buffer.from(block.data, "base64"));
        return `Image saved to ${path.resolve(filename)} (${block.mimeType})`;
    }
    return block.text ?? "OK";
}

async function chatLoop(client) {
    const ask = async () => {
        // Re-fetch each iteration: the elicitation handler may have closed and
        // nulled the shared readline (to release stdin for masked input).
        const query = await getReadline().question("\nQuery: ");
        if (query.toLowerCase() === "quit") return;
        const response = await processQuery(client, query);
        console.log("\n" + response);
        await ask();
    }
    await ask();
}

async function main() {
    if (process.argv.length < 3) {
        console.log("Usage: node client.js <path_to_server_script>");
        process.exit(1);
    }

    const command = "node";
    const transport = new StdioClientTransport({
        command,
        "args": [process.argv[2]],
        // StdioClientTransport only inherits a security allowlist of env vars by default (PATH,
        // USERPROFILE, etc. — see the SDK's getDefaultEnvironment) — not the full process env. So
        // DXM_MCP_DEBUG set in the shell running this client wouldn't otherwise reach the spawned
        // server process; forward it explicitly so one flag turns on logging on both ends.
        ...(isDebugEnabled() ? { env: { DXM_MCP_DEBUG: process.env.DXM_MCP_DEBUG } } : {}),
    });

    const client = new Client(
        {
            name: "mcp-client",
            version: "1.0.0",
        },
        {
            capabilities: {
                elicitation: { form: {} }
            },
        }
    );

    client.setRequestHandler(ElicitRequestSchema, handleElicitationRequest);

    await client.connect(transport);

    const response = await client.request(
        { method: "tools/list" },
        ListToolsResultSchema
    );

    console.log("Connected to server with tools: " + response.tools.map(t => t.name));

    // for (let tool of response.tools) {
    //     console.log(`Tool: ${tool.name}, ${tool.description} + ${JSON.stringify(tool.inputSchema)}`);
    // }

    console.log("\nMCP Client Started!");
    console.log("Type your queries or 'quit' to exit.");

    await chatLoop(client);

    await cleanup(transport);

    process.exit(1);
};

main();

// See https://modelcontextprotocol.info/docs/tutorials/building-a-client-node/
// and https://github.com/lucianoayres/mcp-server-node/blob/main/mcp-server.js
// and https://modelcontextprotocol.io/docs/develop/build-server
