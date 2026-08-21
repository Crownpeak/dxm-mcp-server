import * as Auth from "./auth.js";
import * as Asset from "./asset.js";
import * as Binary from "./binary.js";
import * as Publish from "./publish.js";
import * as Workflow from "./workflow.js";
import * as Build from "./build.js";
import * as Properties from "./properties.js";
import * as Users from "./users.js";
import * as Report from "./report.js";
import * as Prompts from "./prompts.js";
import { installDebugLogging } from "./util.js";

export function registerReadTools(server, dxm) {
    installDebugLogging(server);
    Auth.registerReadTools(server, dxm);
    Asset.registerReadTools(server, dxm);
    Binary.registerReadTools(server, dxm);
    Publish.registerReadTools(server, dxm);
    Workflow.registerReadTools(server, dxm);
    Properties.registerReadTools(server, dxm);
    Users.registerReadTools(server, dxm);
    Report.registerReadTools(server, dxm);
}

export function registerWriteTools(server, dxm) {
    installDebugLogging(server);
    Asset.registerWriteTools(server, dxm);
    Binary.registerWriteTools(server, dxm);
    Publish.registerWriteTools(server, dxm);
    Workflow.registerWriteTools(server, dxm);
    Build.registerWriteTools(server, dxm);
    Properties.registerWriteTools(server, dxm);
    Users.registerWriteTools(server, dxm);
}

// HTTP variant: same as registerReadTools but swaps the full auth surface for whoami-only.
// login/logout/list_profiles/delete_profile mutate the shared Dxm singleton, which has no
// coherent meaning across concurrent stateless HTTP requests. Credentials must come from .env.
export function registerReadToolsHttp(server, dxm) {
    installDebugLogging(server);
    Auth.registerWhoami(server, dxm);
    Asset.registerReadTools(server, dxm);
    Binary.registerReadTools(server, dxm);
    Publish.registerReadTools(server, dxm);
    Workflow.registerReadTools(server, dxm);
    Properties.registerReadTools(server, dxm);
    Users.registerReadTools(server, dxm);
    Report.registerReadTools(server, dxm);
}

export function registerPrompts(server) {
    Prompts.registerPrompts(server);
}

// HTTP variant: drops the login/logout/list_profiles/delete_profile prompts since those tools
// are not registered on the HTTP server. Other prompts (including whoami) stay.
export function registerPromptsHttp(server) {
    Prompts.registerPromptsHttp(server);
}
