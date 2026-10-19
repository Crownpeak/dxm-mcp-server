import { createHash } from "node:crypto";

// What a failed password login looks like, and what the caller is told about it.
//
// Three failed logins lock a DXM account until an administrator resets it, so a failure is never
// retried with the same credentials (see Dxm._ensureLoggedIn). The messages say so, and say what
// to change, because the caller - usually a model - otherwise tends to just try again.
//
// Verified live on CPUK: both rejections below come back as HTTP 400 with JSON, and the helper's
// login() returns that body rather than throwing. A rejected API key is an IIS 403 HTML page,
// which the helper turns into a thrown "Unable to contact CMS" - indistinguishable from a
// network failure.

export const INVALID_CREDENTIALS = "conWS_InvalidUserNameOrPassword"; // internalCode -200, empty errorMessage
export const PASSWORD_EXPIRED = "conWS_PasswordExpired";              // internalCode -400

export class AuthenticationError extends Error {
    constructor(message, { resultCode = null } = {}) {
        super(message);
        this.name = "AuthenticationError";
        this.resultCode = resultCode;
    }
}

// Identifies a set of credentials without keeping them: lets a profile reloaded with unchanged
// values be recognised as the one that was already rejected.
export function credentialFingerprint({ server, instance, username, password, apiKey }) {
    return createHash("sha256").update(JSON.stringify([server, instance, username, password, apiKey])).digest("hex");
}

// How to get working credentials in, depending on where these came from.
function fixHint(creds, what) {
    return creds.profile
        ? `Update the profile from a terminal with "npm run profile -- passwd ${creds.profile}" (it prompts for ${what}), then call login profile=${creds.profile}. Do not call login with this profile again until it has been updated.`
        : `Put ${what} in .env (CMS_USERNAME / CMS_PASSWORD / CMS_API_KEY) and restart the MCP server, or call login with a saved profile.`;
}

// `result` is what the helper's login() returned (the CMS's JSON body), or null when it threw.
export function describeLoginFailure(creds, { result = null, error = null } = {}) {
    const who = `"${creds.username}" on ${creds.server}/${creds.instance}`;
    const noRetry = "These credentials will not be tried again, because repeated failed logins lock the account until an administrator resets it.";
    const code = result?.resultCode ?? null;

    if (code === INVALID_CREDENTIALS) {
        return new AuthenticationError(
            `Authentication failed for ${who}: the CMS rejected the username or password (${code}). ${noRetry} ${fixHint(creds, "the correct password")}`,
            { resultCode: code });
    }
    if (code === PASSWORD_EXPIRED) {
        // A profile means a stdio server, which has login_browser: the CMS page there takes the
        // user through the change and the login completes (verified live). .env credentials may
        // be on the HTTP server, which doesn't offer it.
        const change = creds.profile
            ? `The password must first be changed in the CMS. The quickest way is login_browser server=${creds.server} instance=${creds.instance}: the CMS page asks for a new password and this session is then logged in. Afterwards, so the profile works again: ${fixHint(creds, "the new password")}`
            : `The password must first be changed in the CMS: sign in at https://${creds.server}/${creds.instance}/ in a browser and set a new one. Then: ${fixHint(creds, "the new password")}`;
        return new AuthenticationError(
            `Authentication failed for ${who}: the password has expired (${code}). ${noRetry} ${change}`,
            { resultCode: code });
    }
    if (code) {
        const detail = result.errorMessage ? `${code}: ${result.errorMessage}` : code;
        return new AuthenticationError(
            `Authentication failed for ${who}: the CMS refused the login (${detail}). ${noRetry} ${fixHint(creds, "correct credentials")}`,
            { resultCode: code });
    }
    // The helper threw: unreachable server, or an API key the CMS refused (it can't tell which).
    // Neither is known to count towards a lockout, so an explicit login may try again.
    const retry = creds.profile
        ? `Tool calls will not retry it on their own; once the cause is fixed, call login profile=${creds.profile} to try again.`
        : "Tool calls will not retry it on their own; once the cause is fixed, restart the MCP server or call login with a saved profile.";
    return new AuthenticationError(
        `Could not log in as ${who}: ${error?.message ?? error ?? "unknown error"}. The CMS may be unreachable, or the API key may have been rejected - check the server, instance and API key. ${retry}`);
}
