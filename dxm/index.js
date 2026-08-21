import CmsApi from "crownpeak-dxm-accessapi-helper";
import { mapAsset } from "./util.js";
import { isDebugEnabled, truncate } from "./debug.js";
import * as Assets from "./assets.js";
import * as Binary from "./binary.js";
import * as Publish from "./publish.js";
import * as Workflow from "./workflow.js";
import * as Build from "./build.js";
import * as Properties from "./properties.js";
import * as Users from "./users.js";
import * as Report from "./report.js";
import * as Profiles from "./profiles.js";

// Mixin: turn every exported `fn(dxm, ...args)` into `target.fn(...args)`.
function mixin(target, mod) {
    for (const [name, fn] of Object.entries(mod)) {
        if (typeof fn === "function") target[name] = (...args) => fn(target, ...args);
    }
}

// Matches header/field names that must never appear in a debug log — e.g. the "password" field
// in the /Auth/Authenticate request body, or a "cookie" field echoed back in a response.
const SECRET_FIELD_RE = /password|api[_-]?key|secret|token|cookie/i;

// Redacts sensitive fields from a JSON-ish string before it hits the log. Non-JSON strings (or
// anything that fails to parse) pass through unredacted — this only ever sees our own request
// bodies and the CMS's JSON responses, never arbitrary user text.
function redactJson(bodyString) {
    if (typeof bodyString !== "string") return bodyString;
    let parsed;
    try {
        parsed = JSON.parse(bodyString);
    } catch {
        return bodyString;
    }
    if (parsed === null || typeof parsed !== "object") return bodyString;
    const redacted = Object.fromEntries(
        Object.entries(parsed).map(([k, v]) => [k, SECRET_FIELD_RE.test(k) ? "<redacted>" : v])
    );
    return JSON.stringify(redacted);
}

// Debug-only: wraps the helper's `fetch` — an instance property (see the CJS package's api.js
// constructor: `this.fetch = require("node-fetch")`), not a module-level import — so this can be
// monkey-patched from here without ever touching node_modules. Logs every request/response for
// every domain object (Asset, Workflow, User, ...), since they all funnel through this one fetch
// via the helper's postRequest/getCmsRequest/getCmsRequestRaw. Redacts secret headers and fields
// (x-api-key, cookie, password, ...) so the log is safe to paste into a bug report — most notably
// the plaintext username/password in the /Auth/Authenticate request body.
function installFetchLogging(cms) {
    const realFetch = cms.fetch;
    cms.fetch = async (url, options) => {
        const headers = { ...options.headers };
        if (headers.cookie) headers.cookie = "<redacted>";
        if (headers["x-api-key"]) headers["x-api-key"] = "<redacted>";
        console.error(`[dxm-http] → ${options.method} ${url} headers=${truncate(headers)} body=${truncate(redactJson(options.body))}`);
        const start = Date.now();
        try {
            const response = await realFetch(url, options);
            const contentType = response.headers.get("content-type") ?? "";
            if (!/json|text/i.test(contentType)) {
                console.error(`[dxm-http] ← ${response.status} (${Date.now() - start}ms) <binary, content-type=${contentType || "unknown"}>`);
                return response;
            }
            // Deliberately NOT response.clone(): node-fetch v2's clone() tees the body into two
            // PassThrough streams. Reading one (for the log) while the caller reads the other
            // later works for small bodies but deadlocks on larger ones — the un-drained tee
            // fills its buffer, backpressure pauses the shared underlying stream, and the tee
            // we're actively reading then stalls waiting for data that never arrives. Instead,
            // read the body ourselves exactly once and hand back a minimal shim exposing only
            // what postRequest/getCmsRequest actually call: .json(), .headers.get(), .status.
            const bodyText = await response.text();
            console.error(`[dxm-http] ← ${response.status} (${Date.now() - start}ms) ${truncate(redactJson(bodyText))}`);
            return {
                status: response.status,
                ok: response.ok,
                headers: response.headers,
                json: async () => JSON.parse(bodyText),
                text: async () => bodyText
            };
        } catch (e) {
            console.error(`[dxm-http] ✗ (${Date.now() - start}ms) ${e?.message ?? e}`);
            throw e;
        }
    };
}

export default class {

    _cms = null;
    _credentials = null;
    _session = null;
    _authenticatedFor = null;

    constructor(env) {
        this._cms = new CmsApi();
        if (isDebugEnabled()) installFetchLogging(this._cms);
        this._credentials = this._readEnv(env);
        for (const mod of [Assets, Binary, Publish, Workflow, Build, Properties, Users, Report]) {
            mixin(this, mod);
        }
    }

    _readEnv(env) {
        const { CMS_SERVER, CMS_INSTANCE, CMS_USERNAME, CMS_PASSWORD, CMS_API_KEY } = env ?? {};
        if (CMS_SERVER && CMS_INSTANCE && CMS_USERNAME && CMS_PASSWORD && CMS_API_KEY) {
            return { server: CMS_SERVER, instance: CMS_INSTANCE, username: CMS_USERNAME, password: CMS_PASSWORD, apiKey: CMS_API_KEY };
        }
        return null;
    }

    setCredentials({ server, instance, username, password, apiKey }) {
        this._credentials = { server, instance, username, password, apiKey };
        this._session = null;
    }

    async loadProfileCredentials(name) {
        const creds = await Profiles.getProfile(name);
        this.setCredentials(creds);
    }

    // Browser-driven session capture. Reference-equality contract: every call
    // assigns a NEW _session object, so _ensureLoggedIn re-applies it on the
    // helper via setSession.
    setSession({ host, instance, apiKey, cookie, username = null }) {
        this._session = { host, instance, apiKey, cookie, username };
        this._credentials = null;
    }

    async openBrowserLogin({ server, instance } = {}) {
        const { runBrowserLogin } = await import("./browser-login.js");
        const captured = await runBrowserLogin({ server, instance });
        this.setSession(captured);
        await this._ensureLoggedIn();
        return this.getAuthState();
    }

    clearCredentials() {
        this._credentials = null;
        this._session = null;
        this._authenticatedFor = null;
        if (typeof this._cms.clearSession === "function") this._cms.clearSession();
    }

    getAuthState() {
        const active = this._session ?? this._credentials;
        if (!active) return { authenticated: false };
        return {
            authenticated: this._authenticatedFor === active,
            server: active.server ?? active.host,
            instance: active.instance,
            username: active.username ?? null,
            mode: this._session ? "session" : "credentials"
        };
    }

    async _ensureLoggedIn() {
        const active = this._session ?? this._credentials;
        if (!active) {
            throw new Error("Not authenticated. Call `login_browser`, `login`, or set CMS_* in .env.");
        }
        if (this._authenticatedFor !== active) {
            if (this._session) {
                this._cms.setSession({
                    host: this._session.host,
                    instance: this._session.instance,
                    apiKey: this._session.apiKey,
                    cookie: this._session.cookie
                });
            } else {
                const c = this._credentials;
                await this._cms.login(c.username, c.password, c.server, c.instance, c.apiKey);
            }
            this._authenticatedFor = active;
        }
    }

    _mapAsset(a) { return mapAsset(this._cms, a); }
}
