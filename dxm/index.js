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
import { AuthenticationError, credentialFingerprint, describeLoginFailure } from "./login-failure.js";

const LOGIN_SUCCESS = "conWS_Success";

// Mixin: turn every exported `fn(dxm, ...args)` into `target.fn(...args)`.
function mixin(target, mod) {
    for (const [name, fn] of Object.entries(mod)) {
        if (typeof fn === "function") target[name] = (...args) => fn(target, ...args);
    }
}

// Matches header/field names that must never appear in a debug log — e.g. the "password" field
// in the /Auth/Authenticate request body, or a "cookie" field echoed back in a response. The last
// four cover the notification socket's setup calls (/Sockets/PusherInfo and /Sockets/PusherAuth,
// made by the helper when set_code waits for its compile): `auth` is a signed subscription for
// the user's private channel, and `channel_name` / `ourUniqueId` / `appKey` are what that
// channel is built from. `auth` is anchored so it doesn't swallow unrelated fields like "author".
const SECRET_FIELD_RE = /password|api[_-]?key|secret|token|cookie|^auth$|channel_name|uniqueid|appkey/i;

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
    // The last failed password login: { for, fingerprint, rejected, at, outcome }. Kept across
    // logout on purpose; only a successful login or changed credentials get past it.
    _loginFailure = null;

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

    // `profile` names where the credentials came from (null for .env), so a login failure can say
    // what to update.
    setCredentials({ server, instance, username, password, apiKey }, { profile = null } = {}) {
        this._credentials = { server, instance, username, password, apiKey, profile };
        this._session = null;
    }

    async loadProfileCredentials(name) {
        const creds = await Profiles.getProfile(name);
        this.setCredentials(creds, { profile: name });
    }

    // Browser-driven session capture. Reference-equality contract: every call
    // assigns a NEW _session object, so _ensureLoggedIn re-applies it on the
    // helper via setSession.
    setSession({ host, instance, apiKey, cookie, username = null }) {
        this._session = { host, instance, apiKey, cookie, username };
        this._credentials = null;
    }

    async openBrowserLogin({ server, instance } = {}) {
        const captured = await this._runBrowserLogin({ server, instance });
        this.setSession(captured);
        await this._ensureLoggedIn();
        const state = { ...this.getAuthState(), passwordChanged: captured.passwordChanged === true };
        if (state.passwordChanged) {
            state.note = "The password was changed in the browser during this login (it had probably expired). " +
                "This session works, but any saved copy of the old password is now stale: update a profile with " +
                "`npm run profile -- passwd <name>` from a terminal, or edit CMS_PASSWORD in .env. Otherwise the next " +
                "password login with it will fail, and repeated failures lock the account.";
        }
        return state;
    }

    // Separate so tests can stand in for the headed browser.
    async _runBrowserLogin(args) {
        const { runBrowserLogin } = await import("./browser-login.js");
        return runBrowserLogin(args);
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
        const state = {
            authenticated: this._authenticatedFor === active,
            server: active.server ?? active.host,
            instance: active.instance,
            username: active.username ?? null,
            mode: this._session ? "session" : "credentials"
        };
        if (!this._session) state.profile = active.profile ?? null;
        const failure = this._loginFailureFor(active);
        if (failure) {
            const error = this._loginFailureError(failure, active);
            state.lastError = { resultCode: error.resultCode, message: error.message, at: failure.at };
        }
        return state;
    }

    // The recorded login failure, if it applies to these credentials: the very object that failed
    // (any failure - tool calls never retry on their own), or a new object with the same values
    // when the CMS rejected them (so reloading an unchanged profile, or logout + login, can't
    // retry a rejected password towards a lockout). A failure the helper threw - unreachable
    // server or refused API key - only blocks the object that failed, so an explicit login retries.
    _loginFailureFor(active) {
        const f = this._loginFailure;
        if (!f || !active || this._session) return null;
        if (f.for === active) return f;
        return f.rejected && f.fingerprint === credentialFingerprint(active) ? f : null;
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
                await this._loginWithCredentials(active);
            }
            this._authenticatedFor = active;
        }
    }

    // The helper's login() doesn't throw when the CMS rejects the credentials: it returns the
    // CMS's body (HTTP 400, e.g. conWS_InvalidUserNameOrPassword) and stays unauthenticated. This
    // used to ignore that, mark the credentials authenticated, and let the next tool call fail
    // as something unrelated ("Asset not found"). Every failure is recorded, and never retried
    // with the same credentials: three failed logins lock the account.
    async _loginWithCredentials(c) {
        const previous = this._loginFailureFor(c);
        if (previous) {
            const error = this._loginFailureError(previous, c);
            throw new AuthenticationError(`Not retried (this login already failed at ${previous.at}). ${error.message}`,
                { resultCode: error.resultCode });
        }
        let result = null, thrown = null;
        try {
            result = await this._cms.login(c.username, c.password, c.server, c.instance, c.apiKey);
        } catch (e) {
            thrown = e;
        }
        if (!thrown && result?.resultCode === LOGIN_SUCCESS) {
            this._loginFailure = null;
            return;
        }
        const outcome = { result, error: thrown ?? (result ? null : "the CMS returned no response") };
        this._loginFailure = {
            for: c,
            fingerprint: credentialFingerprint(c),
            rejected: !thrown && !!result?.resultCode,
            at: new Date().toISOString(),
            outcome
        };
        throw describeLoginFailure(c, outcome);
    }

    // Described for the credentials now active, so the advice follows them (e.g. the same values
    // reloaded from a profile get "update the profile", not "edit .env").
    _loginFailureError(failure, creds) {
        return describeLoginFailure(creds, failure.outcome);
    }

    _mapAsset(a) { return mapAsset(this._cms, a); }
}
