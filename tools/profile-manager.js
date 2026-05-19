#!/usr/bin/env node
// CLI for managing DXM MCP credential profiles outside the MCP server.
// Useful for clients that do not yet support MCP elicitation.

import readline from "node:readline";
import * as Profiles from "../dxm/profiles.js";

function usage() {
    process.stderr.write(
        "Usage:\n" +
        "  node tools/profile-manager.js list\n" +
        "  node tools/profile-manager.js add <name>\n" +
        "  node tools/profile-manager.js remove <name>\n"
    );
}

function ask(rl, question) {
    return new Promise(resolve => rl.question(question, answer => resolve(answer)));
}

function askMasked(question) {
    return new Promise((resolve, reject) => {
        const stdin = process.stdin;
        const stdout = process.stdout;
        if (!stdin.isTTY) {
            process.stderr.write("Warning: stdin is not a TTY; input will not be masked.\n");
            const rl = readline.createInterface({ input: stdin, output: stdout });
            rl.question(question, answer => { rl.close(); resolve(answer); });
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
                if (code === 3) { // Ctrl-C
                    stdin.removeListener("data", onData);
                    stdin.setRawMode(wasRaw);
                    stdin.pause();
                    stdout.write("\n");
                    reject(new Error("Cancelled"));
                    return;
                }
                if (code === 8 || code === 127) { // backspace / DEL
                    if (buf.length > 0) {
                        buf = buf.slice(0, -1);
                        stdout.write("\b \b");
                    }
                    continue;
                }
                if (code < 32) continue; // ignore other control chars
                buf += ch;
                stdout.write("*");
            }
        };
        stdin.on("data", onData);
    });
}

async function cmdList() {
    const names = await Profiles.listNames();
    if (names.length === 0) {
        process.stdout.write("(no profiles)\n");
        return;
    }
    for (const n of names) process.stdout.write(n + "\n");
}

async function cmdAdd(name) {
    if (!name) { usage(); process.exit(2); }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
        const server   = (await ask(rl, "Server:   ")).trim();
        const instance = (await ask(rl, "Instance: ")).trim();
        const username = (await ask(rl, "Username: ")).trim();
        rl.close();
        const password = await askMasked("Password: ");
        const apiKey   = await askMasked("API key:  ");
        if (!server || !instance || !username || !password || !apiKey) {
            process.stderr.write("All fields are required.\n");
            process.exit(1);
        }
        await Profiles.saveProfile(name, { server, instance, username, password, apiKey });
        process.stdout.write(`Saved profile "${name}".\n`);
    } finally {
        if (process.stdin.isTTY && process.stdin.isRaw) {
            process.stdin.setRawMode(false);
        }
        try { rl.close(); } catch { /* already closed */ }
    }
}

async function cmdRemove(name) {
    if (!name) { usage(); process.exit(2); }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
        const answer = (await ask(rl, `Delete profile "${name}"? [y/N] `)).trim().toLowerCase();
        if (answer !== "y" && answer !== "yes") {
            process.stdout.write("Aborted.\n");
            return;
        }
        await Profiles.deleteProfile(name);
        process.stdout.write(`Deleted profile "${name}".\n`);
    } finally {
        rl.close();
    }
}

async function main() {
    const [cmd, name] = process.argv.slice(2);
    try {
        switch (cmd) {
            case "list":   await cmdList(); break;
            case "add":    await cmdAdd(name); break;
            case "remove": await cmdRemove(name); break;
            default:       usage(); process.exit(2);
        }
    } catch (e) {
        process.stderr.write(`Error: ${e.message ?? e}\n`);
        if (process.stdin.isTTY && process.stdin.isRaw) {
            process.stdin.setRawMode(false);
        }
        process.exit(1);
    }
}

main();
