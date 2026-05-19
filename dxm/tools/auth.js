import { z } from "zod";
import { toolHandler, jsonText } from "./util.js";
import * as Profiles from "../profiles.js";

// whoami is safe in every transport mode — it reports current auth state without secrets and
// does not mutate credentials. Split out so the HTTP server can expose it without also exposing
// the credential-management tools (which mutate a shared Dxm singleton — meaningless across
// concurrent stateless HTTP requests).
export function registerWhoami(server, dxm) {
    server.tool(
        "whoami",
        "Report the currently active CMS server, instance, and username (if any)",
        {},
        toolHandler(async () => jsonText(dxm.getAuthState()))
    );
}

// Credential management tools — only mounted on the stdio servers. The MCP elicitation spec
// (2025-06-18) explicitly forbids using elicitation for sensitive data, so credentials cannot be
// entered from inside an MCP chat. Use a saved profile or .env instead. These tools also mutate
// dxm._credentials, which has no coherent meaning across concurrent stateless HTTP requests, so
// they're omitted from the HTTP composition for that reason too.
export function registerCredentialTools(server, dxm) {
    server.tool(
        "login",
        "Authenticate to a DXM CMS instance using a saved credential profile. " +
        "Credentials cannot be entered through the chat — create a profile first with " +
        "`node tools/profile-manager.js add <name>` from a real terminal.",
        // profile is optional in the schema so we can return a helpful "use a profile" message
        // when omitted, instead of letting zod reject the call with a generic "Required" error.
        { profile: z.string().optional().describe("Name of a saved credential profile") },
        toolHandler(async ({ profile }) => {
            if (!profile) {
                throw new Error(
                    "login requires a `profile` argument. Save credentials first with " +
                    "`node tools/profile-manager.js add <name>` (run from a real terminal so the " +
                    "password input can be masked), then call `login profile=<name>`. " +
                    "Alternatively, set CMS_SERVER/CMS_INSTANCE/CMS_USERNAME/CMS_PASSWORD/CMS_API_KEY " +
                    "in `.env` and restart the server — `login` is not needed in that case."
                );
            }
            await dxm.loadProfileCredentials(profile);
            await dxm._ensureLoggedIn();
            return jsonText(dxm.getAuthState());
        })
    );

    server.tool(
        "login_browser",
        "Launch a browser window to log in to a DXM CMS instance. Captures the session cookies " +
        "and per-instance API key from the resulting browser session. Supports every provider the " +
        "CMS web UI supports (standard password, SSO, MFA). Requires the optional `playwright` " +
        "dependency: `npm install playwright && npx playwright install chromium`. " +
        "The captured session lives in memory only — restart the server to drop it.",
        {
            server: z.string().min(1).describe("CMS hostname, e.g. cms.crownpeak.net (no scheme, no path)"),
            instance: z.string().min(1).describe("CMS instance name, e.g. CPUK")
        },
        // Intentionally NOT wrapped in toolHandler — its 30s timeout is too short for an
        // interactive human login (SSO + MFA can easily take longer). The wrapper manages its
        // own 5-minute deadline internally.
        async ({ server: cmsServer, instance }) => {
            try {
                const state = await dxm.openBrowserLogin({ server: cmsServer, instance });
                return jsonText(state);
            } catch (e) {
                return { content: [{ type: "text", text: e?.message ?? String(e) }], isError: true };
            }
        }
    );

    server.tool(
        "logout",
        "Clear the active CMS credentials and session state",
        {},
        toolHandler(async () => {
            dxm.clearCredentials();
            return { content: [] };
        })
    );

    server.tool(
        "list_profiles",
        "List the names of saved credential profiles. Never returns secret values.",
        {},
        toolHandler(async () => jsonText({ profiles: await Profiles.listNames() }))
    );

    server.tool(
        "delete_profile",
        "Delete a saved credential profile by name.",
        { name: z.string().min(1).describe("Profile name to delete") },
        toolHandler(async ({ name }) => {
            await Profiles.deleteProfile(name);
            return jsonText({ deleted: name });
        })
    );
}

// Convenience wrapper so the stdio servers keep their existing composition.
export function registerReadTools(server, dxm) {
    registerWhoami(server, dxm);
    registerCredentialTools(server, dxm);
}
