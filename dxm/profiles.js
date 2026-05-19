import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export function profilesPath() {
    return process.env.DXM_MCP_PROFILES_PATH ?? path.join(os.homedir(), ".dxm-mcp", "profiles.json");
}

export async function readAll() {
    const filePath = profilesPath();
    let raw;
    try {
        raw = await fs.readFile(filePath, "utf8");
    } catch (e) {
        if (e.code === "ENOENT") return {};
        throw e;
    }
    try {
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("not an object");
        }
        return parsed;
    } catch (e) {
        throw new Error(`Profile store is corrupt at ${filePath}: ${e.message}`);
    }
}

export async function listNames() {
    const all = await readAll();
    return Object.keys(all).sort();
}

export async function getProfile(name) {
    const all = await readAll();
    if (!Object.prototype.hasOwnProperty.call(all, name)) {
        throw new Error(`Profile not found: ${name}`);
    }
    const p = all[name];
    return {
        server: p.server,
        instance: p.instance,
        username: p.username,
        password: p.password,
        apiKey: p.apiKey
    };
}

async function writeAll(all) {
    const filePath = profilesPath();
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(all, null, 2), { mode: 0o600 });
    try { await fs.chmod(tmp, 0o600); } catch { /* best-effort on Windows */ }
    await fs.rename(tmp, filePath);
    try { await fs.chmod(filePath, 0o600); } catch { /* best-effort on Windows */ }
}

export async function saveProfile(name, creds) {
    const all = await readAll();
    all[name] = {
        server: creds.server,
        instance: creds.instance,
        username: creds.username,
        password: creds.password,
        apiKey: creds.apiKey
    };
    await writeAll(all);
}

export async function deleteProfile(name) {
    const all = await readAll();
    if (!Object.prototype.hasOwnProperty.call(all, name)) {
        throw new Error(`Profile not found: ${name}`);
    }
    delete all[name];
    await writeAll(all);
}
