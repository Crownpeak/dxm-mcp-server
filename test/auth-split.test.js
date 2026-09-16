import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
    registerWhoami, registerCredentialTools, registerReadTools
} from "../dxm/tools/auth.js";
import {
    registerReadToolsHttp, registerPrompts, registerPromptsHttp
} from "../dxm/tools/index.js";
import { makeFakeCms } from "./_helpers.js";

// Capture tool registrations so we can assert which tools each register* function exposes.
// Also stash handlers so behavior tests can invoke them directly.
function captureServer() {
    const tools = [];
    const prompts = [];
    const handlers = new Map();
    return {
        tools,
        prompts,
        handlers,
        server: {
            tool: (name, _desc, _schema, handler) => { tools.push(name); handlers.set(name, handler); },
            prompt: (name, _desc, _schema, _handler) => prompts.push(name)
        }
    };
}

function fakeDxm() {
    return {
        _cms: makeFakeCms(),
        getAuthState: () => ({ authenticated: false }),
        clearCredentials: () => {},
        setCredentials: () => {},
        loadProfileCredentials: async () => {},
        _ensureLoggedIn: async () => {}
    };
}

describe("auth tool split", () => {
    test("registerWhoami registers exactly whoami", () => {
        const { tools, server } = captureServer();
        registerWhoami(server, fakeDxm());
        assert.deepEqual(tools, ["whoami"]);
    });

    test("registerCredentialTools registers the credential-management tools", () => {
        // save_profile was removed when elicitation support was dropped (the MCP spec forbids
        // requesting sensitive data via elicitation). Profiles are now created via the
        // tools/profile-manager.js CLI only. login_browser was added for in-browser session capture.
        const { tools, server } = captureServer();
        registerCredentialTools(server, fakeDxm());
        assert.deepEqual(tools.sort(), [
            "delete_profile", "list_profiles", "login", "login_browser", "logout"
        ]);
    });

    test("registerReadTools (stdio convenience) covers whoami + all credential tools", () => {
        const { tools, server } = captureServer();
        registerReadTools(server, fakeDxm());
        assert.deepEqual(tools.sort(), [
            "delete_profile", "list_profiles", "login", "login_browser", "logout", "whoami"
        ]);
    });

    test("registerReadToolsHttp excludes every credential-mutation tool including login_browser", () => {
        const { tools, server } = captureServer();
        registerReadToolsHttp(server, fakeDxm());
        // whoami stays; the credential-mutation tools do not.
        assert.ok(tools.includes("whoami"));
        for (const banned of ["login", "login_browser", "logout", "list_profiles", "delete_profile"]) {
            assert.ok(!tools.includes(banned), `expected ${banned} to be absent from HTTP read tools`);
        }
    });

    test("registerReadToolsHttp still exposes every non-auth read tool", () => {
        const { tools, server } = captureServer();
        registerReadToolsHttp(server, fakeDxm());
        // Sanity check the full read surface (whoami + 18 others = 19).
        const expected = [
            "whoami",
            "find_asset", "get_path", "list_folder", "list_fields", "get_code",
            "download_image", "download_file", "view_output",
            "list_links",
            "list_workflows", "get_workflow",
            "list_attachments", "read_site_root", "list_versions", "get_version",
            "list_users",
            "publishing_errors", "site_summary"
        ];
        for (const name of expected) {
            assert.ok(tools.includes(name), `expected ${name} in HTTP read tool set`);
        }
        assert.equal(tools.length, expected.length, `unexpected extras: ${tools.filter(t => !expected.includes(t)).join(", ")}`);
    });
});

describe("login tool behavior (no elicitation)", () => {
    test("returns a helpful error when called without a profile", async () => {
        const { handlers, server } = captureServer();
        registerCredentialTools(server, fakeDxm());
        const result = await handlers.get("login")({});
        assert.equal(result.isError, true);
        const text = result.content[0].text;
        assert.match(text, /login requires a `profile` argument/);
        assert.match(text, /profile-manager\.js add/);
        assert.match(text, /\.env/);
    });

    test("loads the named profile and authenticates when called with profile", async () => {
        const { handlers, server } = captureServer();
        const calls = { loadProfile: [], ensureLoggedIn: 0 };
        const dxm = {
            ...fakeDxm(),
            loadProfileCredentials: async name => { calls.loadProfile.push(name); },
            _ensureLoggedIn: async () => { calls.ensureLoggedIn++; },
            getAuthState: () => ({ authenticated: true, server: "s", instance: "i", username: "u" })
        };
        registerCredentialTools(server, dxm);
        const result = await handlers.get("login")({ profile: "prod" });
        assert.equal(result.isError, undefined);
        assert.deepEqual(calls.loadProfile, ["prod"]);
        assert.equal(calls.ensureLoggedIn, 1);
        assert.match(result.content[0].text, /"authenticated":true/);
    });
});

describe("login_browser tool behavior", () => {
    test("forwards server/instance to dxm.openBrowserLogin and returns the auth state", async () => {
        const { handlers, server } = captureServer();
        const calls = [];
        const dxm = {
            ...fakeDxm(),
            openBrowserLogin: async ({ server: s, instance: i }) => {
                calls.push({ server: s, instance: i });
                return { authenticated: true, server: s, instance: i, username: "tester", mode: "session" };
            }
        };
        registerCredentialTools(server, dxm);
        const result = await handlers.get("login_browser")({ server: "cms.example.net", instance: "INST" });
        assert.equal(result.isError, undefined);
        assert.deepEqual(calls, [{ server: "cms.example.net", instance: "INST" }]);
        const parsed = JSON.parse(result.content[0].text);
        assert.equal(parsed.authenticated, true);
        assert.equal(parsed.mode, "session");
        assert.equal(parsed.username, "tester");
    });

    test("surfaces errors from openBrowserLogin as isError: true", async () => {
        const { handlers, server } = captureServer();
        const dxm = {
            ...fakeDxm(),
            openBrowserLogin: async () => { throw new Error("playwright not installed"); }
        };
        registerCredentialTools(server, dxm);
        const result = await handlers.get("login_browser")({ server: "cms.example.net", instance: "INST" });
        assert.equal(result.isError, true);
        assert.match(result.content[0].text, /playwright not installed/);
    });
});

describe("prompt split", () => {
    // save_profile prompt was removed along with the save_profile tool when elicitation was dropped.
    // login_browser prompt is credential-mutating like login, so it stays stdio-only too.
    const CREDENTIAL_PROMPTS = ["login", "login_browser", "logout", "list_profiles", "delete_profile"];

    test("registerPromptsHttp omits every credential-mutation prompt", () => {
        const { prompts, server } = captureServer();
        registerPromptsHttp(server);
        for (const banned of CREDENTIAL_PROMPTS) {
            assert.ok(!prompts.includes(banned), `expected ${banned} prompt to be absent over HTTP`);
        }
        // save_profile prompt should also be gone (extra safety against regression).
        assert.ok(!prompts.includes("save_profile"), "save_profile prompt should not exist anywhere");
    });

    test("registerPromptsHttp keeps the whoami prompt", () => {
        const { prompts, server } = captureServer();
        registerPromptsHttp(server);
        assert.ok(prompts.includes("whoami"), "whoami prompt should be present over HTTP");
    });

    test("registerPrompts (stdio) registers every credential prompt plus everything else", () => {
        const stdioCapture = captureServer();
        registerPrompts(stdioCapture.server);
        const httpCapture = captureServer();
        registerPromptsHttp(httpCapture.server);
        for (const required of CREDENTIAL_PROMPTS) {
            assert.ok(stdioCapture.prompts.includes(required), `stdio should include ${required}`);
        }
        // stdio = http + the 4 credential prompts.
        assert.equal(stdioCapture.prompts.length, httpCapture.prompts.length + CREDENTIAL_PROMPTS.length);
    });
});
