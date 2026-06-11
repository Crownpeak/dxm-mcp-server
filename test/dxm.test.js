import { test, describe } from "node:test";
import assert from "node:assert/strict";
import Dxm from "../dxm/index.js";

const fullEnv = {
    CMS_SERVER: "cms.example.net",
    CMS_INSTANCE: "INST",
    CMS_USERNAME: "u",
    CMS_PASSWORD: "p",
    CMS_API_KEY: "k"
};

// Replaces the real CmsApi the constructor instantiated with a stub so login/auth flows
// are inspectable without touching the network.
function stubCms(dxm) {
    const calls = [];
    dxm._cms = {
        login: async (username, password, server, instance, apiKey) => {
            calls.push({ kind: "login", username, password, server, instance, apiKey });
        },
        setSession: (args) => {
            calls.push({ kind: "setSession", ...args });
        },
        clearSession: () => {
            calls.push({ kind: "clearSession" });
        }
    };
    return calls;
}

describe("Dxm constructor + env", () => {
    test("seeds credentials when every CMS_* var is present", () => {
        const dxm = new Dxm(fullEnv);
        const state = dxm.getAuthState();
        assert.equal(state.authenticated, false);
        assert.equal(state.server, "cms.example.net");
        assert.equal(state.instance, "INST");
        assert.equal(state.username, "u");
    });

    test("starts unauthenticated when any env var is missing", () => {
        const dxm = new Dxm({ CMS_SERVER: "x" });
        assert.deepEqual(dxm.getAuthState(), { authenticated: false });
    });

    test("getAuthState never returns the password or api key", () => {
        const dxm = new Dxm(fullEnv);
        const state = dxm.getAuthState();
        assert.equal(state.password, undefined);
        assert.equal(state.apiKey, undefined);
    });

    test("attaches read-only domain methods onto the instance", () => {
        const dxm = new Dxm({});
        for (const name of ["findAsset", "getPath", "listFolder", "listFields",
            "downloadAsset", "viewOutput", "getPublishLinks",
            "listWorkflows", "getWorkflow", "listAttachments", "publishingErrors",
            "readSiteRoot", "listUsers", "siteSummary"]) {
            assert.equal(typeof dxm[name], "function", `expected ${name} to be a method`);
        }
    });
});

describe("Dxm credential management", () => {
    test("setCredentials replaces the credential object by reference", () => {
        const dxm = new Dxm({});
        dxm.setCredentials({ server: "s", instance: "i", username: "u", password: "p", apiKey: "k" });
        const first = dxm._credentials;
        dxm.setCredentials({ server: "s2", instance: "i", username: "u", password: "p", apiKey: "k" });
        assert.notEqual(dxm._credentials, first, "expected new credential object reference");
    });

    test("clearCredentials drops state and re-auth marker", () => {
        const dxm = new Dxm(fullEnv);
        dxm._authenticatedFor = dxm._credentials;
        dxm.clearCredentials();
        assert.equal(dxm._credentials, null);
        assert.equal(dxm._authenticatedFor, null);
        assert.deepEqual(dxm.getAuthState(), { authenticated: false });
    });
});

describe("Dxm._ensureLoggedIn", () => {
    test("throws when no credentials are set", async () => {
        const dxm = new Dxm({});
        await assert.rejects(() => dxm._ensureLoggedIn(), /Not authenticated/);
    });

    test("calls cms.login on first use and marks the credential reference as authenticated", async () => {
        const dxm = new Dxm(fullEnv);
        const calls = stubCms(dxm);
        await dxm._ensureLoggedIn();
        assert.equal(calls.length, 1);
        assert.deepEqual(calls[0], {
            kind: "login", username: "u", password: "p", server: "cms.example.net", instance: "INST", apiKey: "k"
        });
        assert.equal(dxm._authenticatedFor, dxm._credentials);
    });

    test("skips a second login when the credential reference is unchanged", async () => {
        const dxm = new Dxm(fullEnv);
        const calls = stubCms(dxm);
        await dxm._ensureLoggedIn();
        await dxm._ensureLoggedIn();
        assert.equal(calls.length, 1);
    });

    test("re-logs in when setCredentials replaces the reference", async () => {
        const dxm = new Dxm(fullEnv);
        const calls = stubCms(dxm);
        await dxm._ensureLoggedIn();
        dxm.setCredentials({ server: "other.example.net", instance: "I2", username: "u2", password: "p2", apiKey: "k2" });
        await dxm._ensureLoggedIn();
        assert.equal(calls.length, 2);
        assert.equal(calls[1].server, "other.example.net");
    });

    test("getAuthState reports authenticated=true once login succeeded", async () => {
        const dxm = new Dxm(fullEnv);
        stubCms(dxm);
        await dxm._ensureLoggedIn();
        assert.equal(dxm.getAuthState().authenticated, true);
    });
});

const fullSession = {
    host: "cms.example.net",
    instance: "INST",
    apiKey: "k",
    cookie: ["ASP.NET_SessionId=abc; Path=/; HttpOnly"],
    username: "richard.lund@example.com"
};

describe("Dxm.setSession + _session", () => {
    test("setSession stores _session and clears _credentials", () => {
        const dxm = new Dxm(fullEnv);
        assert.notEqual(dxm._credentials, null);
        dxm.setSession(fullSession);
        assert.equal(dxm._credentials, null);
        assert.equal(dxm._session.host, "cms.example.net");
        assert.equal(dxm._session.username, "richard.lund@example.com");
    });

    test("setSession defaults username to null when omitted", () => {
        const dxm = new Dxm({});
        dxm.setSession({ host: "h", instance: "i", apiKey: "k", cookie: ["c"] });
        assert.equal(dxm._session.username, null);
    });

    test("setSession assigns a new object reference each call", () => {
        const dxm = new Dxm({});
        dxm.setSession(fullSession);
        const first = dxm._session;
        dxm.setSession(fullSession);
        assert.notEqual(dxm._session, first, "expected new session object reference");
    });

    test("setCredentials clears any active session", () => {
        const dxm = new Dxm({});
        dxm.setSession(fullSession);
        dxm.setCredentials({ server: "s", instance: "i", username: "u", password: "p", apiKey: "k" });
        assert.equal(dxm._session, null);
        assert.notEqual(dxm._credentials, null);
    });

    test("getAuthState reports mode: 'session' when only _session is set", () => {
        const dxm = new Dxm({});
        dxm.setSession(fullSession);
        const state = dxm.getAuthState();
        assert.equal(state.mode, "session");
        assert.equal(state.server, "cms.example.net");
        assert.equal(state.instance, "INST");
        assert.equal(state.username, "richard.lund@example.com");
        assert.equal(state.authenticated, false); // not yet applied to _cms
    });

    test("getAuthState reports mode: 'credentials' when only _credentials is set", () => {
        const dxm = new Dxm(fullEnv);
        const state = dxm.getAuthState();
        assert.equal(state.mode, "credentials");
        assert.equal(state.server, "cms.example.net");
        assert.equal(state.username, "u");
    });
});

describe("Dxm._ensureLoggedIn with sessions", () => {
    test("calls _cms.setSession on first use when _session is active", async () => {
        const dxm = new Dxm({});
        const calls = stubCms(dxm);
        dxm.setSession(fullSession);
        await dxm._ensureLoggedIn();
        const sessionCalls = calls.filter(c => c.kind === "setSession");
        assert.equal(sessionCalls.length, 1);
        assert.equal(sessionCalls[0].host, "cms.example.net");
        assert.equal(sessionCalls[0].apiKey, "k");
        assert.deepEqual(sessionCalls[0].cookie, ["ASP.NET_SessionId=abc; Path=/; HttpOnly"]);
        // NB: username is intentionally not forwarded to _cms.setSession (helper doesn't need it).
        assert.equal(sessionCalls[0].username, undefined);
    });

    test("skips a second _cms.setSession when the session reference is unchanged", async () => {
        const dxm = new Dxm({});
        const calls = stubCms(dxm);
        dxm.setSession(fullSession);
        await dxm._ensureLoggedIn();
        await dxm._ensureLoggedIn();
        const sessionCalls = calls.filter(c => c.kind === "setSession");
        assert.equal(sessionCalls.length, 1);
    });

    test("re-applies _cms.setSession when setSession is called again", async () => {
        const dxm = new Dxm({});
        const calls = stubCms(dxm);
        dxm.setSession(fullSession);
        await dxm._ensureLoggedIn();
        dxm.setSession({ ...fullSession, apiKey: "k2" });
        await dxm._ensureLoggedIn();
        const sessionCalls = calls.filter(c => c.kind === "setSession");
        assert.equal(sessionCalls.length, 2);
        assert.equal(sessionCalls[1].apiKey, "k2");
    });

    test("switches from credentials to session without calling cms.login again", async () => {
        const dxm = new Dxm(fullEnv);
        const calls = stubCms(dxm);
        await dxm._ensureLoggedIn();
        dxm.setSession(fullSession);
        await dxm._ensureLoggedIn();
        const loginCalls = calls.filter(c => c.kind === "login");
        const sessionCalls = calls.filter(c => c.kind === "setSession");
        assert.equal(loginCalls.length, 1);
        assert.equal(sessionCalls.length, 1);
    });

    test("getAuthState.authenticated becomes true after _ensureLoggedIn applies the session", async () => {
        const dxm = new Dxm({});
        stubCms(dxm);
        dxm.setSession(fullSession);
        await dxm._ensureLoggedIn();
        assert.equal(dxm.getAuthState().authenticated, true);
        assert.equal(dxm.getAuthState().mode, "session");
    });

    test("error message names all three auth paths when nothing is set", async () => {
        const dxm = new Dxm({});
        await assert.rejects(() => dxm._ensureLoggedIn(),
            /login_browser.*login.*CMS_.*\.env/);
    });
});

describe("Dxm.clearCredentials with sessions", () => {
    test("clears both _credentials and _session", () => {
        const dxm = new Dxm(fullEnv);
        dxm.setSession(fullSession);
        // setSession already cleared _credentials; restore via setCredentials
        dxm.setCredentials({ server: "s", instance: "i", username: "u", password: "p", apiKey: "k" });
        // setCredentials cleared _session — set it back so we can verify clearCredentials drops both
        dxm._session = { ...fullSession };
        dxm.clearCredentials();
        assert.equal(dxm._credentials, null);
        assert.equal(dxm._session, null);
        assert.equal(dxm._authenticatedFor, null);
    });

    test("calls _cms.clearSession when available", () => {
        const dxm = new Dxm(fullEnv);
        const calls = stubCms(dxm);
        dxm.clearCredentials();
        assert.equal(calls.filter(c => c.kind === "clearSession").length, 1);
    });

    test("does not throw when _cms lacks clearSession (older helper version)", () => {
        const dxm = new Dxm(fullEnv);
        dxm._cms = { login: async () => {} }; // no clearSession field
        assert.doesNotThrow(() => dxm.clearCredentials());
    });
});

describe("Dxm._mapAsset", () => {
    test("delegates to mapAsset with the instance's _cms", () => {
        const dxm = new Dxm({});
        dxm._cms = {
            Util: { AssetType: { File: 2 } }
        };
        const mapped = dxm._mapAsset({ id: 1, label: "x", type: 2, fullPath: "/x", statusName: "S", folder_id: 0 });
        assert.equal(mapped.type, "File");
    });
});
