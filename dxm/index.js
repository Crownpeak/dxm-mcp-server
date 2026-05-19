import CmsApi from "crownpeak-dxm-accessapi-helper";
import { mapAsset } from "./util.js";
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

export default class {

    _cms = null;
    _credentials = null;
    _session = null;
    _authenticatedFor = null;

    constructor(env) {
        this._cms = new CmsApi();
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
