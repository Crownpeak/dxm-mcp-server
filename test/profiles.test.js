import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let dir;
let profilePath;

before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "dxm-profiles-"));
    profilePath = path.join(dir, "profiles.json");
    process.env.DXM_MCP_PROFILES_PATH = profilePath;
});

after(async () => {
    delete process.env.DXM_MCP_PROFILES_PATH;
    await rm(dir, { recursive: true, force: true });
});

// Reset the file between tests so ordering doesn't matter.
beforeEach(async () => {
    await rm(profilePath, { force: true });
});

// Importing after the env var is set ensures the module reads our temp path.
const Profiles = await import("../dxm/profiles.js");

describe("profile store", () => {
    test("listNames returns [] when the file does not exist", async () => {
        assert.deepEqual(await Profiles.listNames(), []);
    });

    test("saveProfile + getProfile round-trips all five fields", async () => {
        const creds = { server: "s", instance: "i", username: "u", password: "p", apiKey: "k" };
        await Profiles.saveProfile("prod", creds);
        assert.deepEqual(await Profiles.getProfile("prod"), creds);
    });

    test("listNames sorts entries", async () => {
        const creds = { server: "s", instance: "i", username: "u", password: "p", apiKey: "k" };
        await Profiles.saveProfile("zeta", creds);
        await Profiles.saveProfile("alpha", creds);
        await Profiles.saveProfile("mu", creds);
        assert.deepEqual(await Profiles.listNames(), ["alpha", "mu", "zeta"]);
    });

    test("deleteProfile removes a single entry without disturbing others", async () => {
        const creds = { server: "s", instance: "i", username: "u", password: "p", apiKey: "k" };
        await Profiles.saveProfile("a", creds);
        await Profiles.saveProfile("b", creds);
        await Profiles.deleteProfile("a");
        assert.deepEqual(await Profiles.listNames(), ["b"]);
    });

    test("getProfile throws for an unknown name", async () => {
        await assert.rejects(() => Profiles.getProfile("nope"), /Profile not found/);
    });

    test("deleteProfile throws for an unknown name", async () => {
        await assert.rejects(() => Profiles.deleteProfile("nope"), /Profile not found/);
    });

    test("corrupt JSON surfaces a clear error", async () => {
        await writeFile(profilePath, "{not json");
        await assert.rejects(() => Profiles.listNames(), /Profile store is corrupt/);
    });

    test("a non-object JSON file is treated as corrupt", async () => {
        await writeFile(profilePath, "[1,2,3]");
        await assert.rejects(() => Profiles.listNames(), /Profile store is corrupt/);
    });

    test("saveProfile overwrites an existing entry rather than appending", async () => {
        const first = { server: "s1", instance: "i", username: "u", password: "p", apiKey: "k" };
        const second = { server: "s2", instance: "i", username: "u", password: "p", apiKey: "k" };
        await Profiles.saveProfile("dup", first);
        await Profiles.saveProfile("dup", second);
        assert.equal((await Profiles.getProfile("dup")).server, "s2");
        assert.deepEqual(await Profiles.listNames(), ["dup"]);
    });
});
