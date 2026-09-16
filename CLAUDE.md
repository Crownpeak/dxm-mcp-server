# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

An MCP (Model Context Protocol) server that exposes Crownpeak DXM CMS operations as tools and prompts for AI clients. Four server variants share a single tool registry — two transports × two permission scopes:

- `server.js` — stdio, full read + write tools.
- `server-readonly.js` — stdio, read-only subset, safe for exploratory/AI agents.
- `server-http.js` — HTTP, full read + write tools (HTTP-incompatible auth tools omitted; see "HTTP transport" below).
- `server-readonly-http.js` — HTTP, read-only subset.

## Commands

```bash
npm run server                # start the full MCP server (stdio transport)
npm run server:readonly       # start the read-only MCP server (stdio)
npm run server:http           # start the full MCP server (HTTP transport, http://127.0.0.1:3000/mcp)
npm run server:readonly:http  # start the read-only MCP server (HTTP)
npm run client <server>       # run the interactive test client against a server script
npm test                      # run the unit-test suite (node:test, no network)
```

HTTP servers honor `PORT` (default `3000`) and `HOST` (default `127.0.0.1`) env vars.

The test client (`client.js`) is a quote-aware REPL for invoking tools by name with positional arguments. It auto-converts numeric/boolean params based on the tool's input schema and writes returned `image` content to disk as `download.<ext>`.

## Tests

`test/` holds the unit-test suite, run with `node --test` (Node's built-in runner — no extra dependencies). Tests cover every domain function in `dxm/*.js`, both read and write, because no real `CmsApi` is ever constructed — `test/_helpers.js` exposes `makeFakeCms` / `makeFakeDxm` which stub the `_cms` surface (Asset, AssetProperties, Workflow, User, Report, Tools, plus the `Util` enums). Test files are organized one-per-domain (`assets.test.js`, `binary.test.js`, `publish.test.js`, `workflow.test.js`, `properties.test.js`, `users.test.js`, `report.test.js`, `build.test.js`) plus cross-cutting suites (`util.test.js`, `dxm.test.js`, `profiles.test.js`). Profile-store tests redirect `DXM_MCP_PROFILES_PATH` to a per-run temp dir so they never touch `~/.dxm-mcp/profiles.json`. Write-tool tests assert on the request bodies handed to the helper (e.g. `UpdateRequest` shape, `CreateRequest` type=2 for files vs type=4 for folders, `createUser`'s inverted-flag fix-up).

## Environment

`.env` (gitignored) is a development-convenience default. If all five keys — `CMS_SERVER`, `CMS_INSTANCE`, `CMS_USERNAME`, `CMS_PASSWORD`, `CMS_API_KEY` — are present at startup, the `Dxm` instance is seeded with them and the first tool call will auto-authenticate. If any key is missing the server still starts; the first tool call will fail with a clear "Not authenticated" error and the client must call the `login` tool.

## Debugging

Set `DXM_MCP_DEBUG=1` (any truthy value) to get a full trace of both traffic legs to stderr — never stdout, since stdout is the MCP JSON-RPC wire for the stdio servers and any stray write there corrupts the protocol stream. Three chokepoints, one env var:

- **`installDebugLogging(server)`** (`dxm/tools/util.js`) monkey-patches `server.tool` so every tool call logs `[dxm-mcp] → name args` / `← name (Nms) result`. It's called once per server instance from `registerReadTools`/`registerWriteTools`/`registerReadToolsHttp` in `dxm/tools/index.js` (idempotent via a flag on the server object, since the full `server.js` calls two of those on the same server). Wrapping at the `server.tool` level — rather than inside `toolHandler` — means every tool is covered from one place regardless of which domain file registers it, and it also covers `login_browser`, which intentionally isn't wrapped in `toolHandler`.
- **`installFetchLogging(cms)`** (`dxm/index.js`) monkey-patches `cms.fetch` — an *instance property* on the helper's `api` class (`this.fetch = require("node-fetch")`), not a module-level import — so this hooks every HTTP call the helper makes without ever touching `node_modules`. Every domain object (`Asset`, `Workflow`, `User`, ...) funnels through this one `fetch` via the helper's `postRequest`/`getCmsRequest`/`getCmsRequestRaw`, so one patch point covers all of them. Logs `[dxm-http] → METHOD url headers body` / `← status (Nms) body`; binary responses (by content-type) log a `<binary, content-type=...>` placeholder instead of dumping bytes.
- `client.js` logs `[dxm-mcp-client] → name args` / `← name (Nms) result` around each `tools/call` request, gated the same way.

**Redaction is mandatory, not optional.** `x-api-key` and `cookie` headers are redacted, and any JSON body field matching `/password|api[_-]?key|secret|token|cookie/i` is redacted before logging (`redactJson` in `dxm/index.js`) — this is what keeps the `/Auth/Authenticate` request body's plaintext password out of the log. Debug output is meant to be safe to paste into a bug report; never add a new logged field without checking it against that regex first.

**Env var propagation gotcha.** `StdioClientTransport` only inherits a security allowlist of env vars by default (`PATH`, `USERPROFILE`, etc. — see the SDK's `getDefaultEnvironment`), not the full parent `process.env`. `client.js` explicitly forwards `DXM_MCP_DEBUG` into the spawned server's `env` for this reason — the same applies to any other custom env var a future feature might need to pass through.

`dxm/debug.js` holds the shared `isDebugEnabled()` / `truncate()` helpers used by all three chokepoints above.

## Authentication

Six tools (`login`, `login_browser`, `logout`, `whoami`, `list_profiles`, `delete_profile`) live in `registerReadTools` (in `dxm/tools/auth.js`) so both stdio server variants expose them. Credentials enter the process only from `.env` (env vars), from a named local **profile**, or from a **browser-captured session** — never typed into an MCP chat. The MCP elicitation spec (2025-06-18) explicitly forbids using elicitation for sensitive data, so the LLM-context-bypassing "client UI prompts for password" path was removed; profiles, `.env`, and `login_browser` cover the same use cases without violating the spec.

- `login(profile)` — loads stored credentials by name and authenticates. `profile` is optional in the schema but required at runtime; calling `login` with no argument returns a clear error pointing at `tools/profile-manager.js` and `.env`. Returns `getAuthState()`.
- `login_browser(server, instance)` — launches a headed Chromium window (via the optional `playwright` dependency) pointed at `https://{server}/{instance}/`. The user completes the CMS login there using any provider (standard, SSO, MFA). The server observes the `/auth/authenticate` response and captures `x-api-key` from the in-flight XHR plus cookies from the browser context, then calls `dxm.setSession({...})`. Session lives in memory only; restart drops it. Returns `getAuthState()` with `mode: "session"`.
- `logout()` — clears `_credentials`, `_session`, and `_authenticatedFor` so subsequent tool calls produce the "Not authenticated" error until the client logs in again. Also calls `cms.clearSession()` when present.
- `whoami()` — returns `{ authenticated, server, instance, username, mode }` (the `mode` field is `"credentials"` or `"session"`). Deliberately omits `password` and `apiKey` so it is safe to echo into the model context. `username` may be `null` after `login_browser` if the best-effort DOM scrape couldn't find it.
- `list_profiles()` — returns the names of saved profiles. **Never returns values.**
- `delete_profile(name)` — removes the named profile.

Re-authentication uses **reference equality** on `_authenticatedFor`: `setCredentials`/`setSession` each assign a new active-auth object, and `_ensureLoggedIn` notices the reference changed and re-applies it to the helper (either via `cms.login(...)` for credentials or via `cms.setSession({...})` for captured sessions). No dirty flag needed. The active auth is `_session ?? _credentials`; setting one clears the other (so they can't fight). Switching CMS instances mid-session is a second `login profile=<other>` or `login_browser server=<x> instance=<y>` call — the underlying `CmsApi` is re-used because the library's `login()`/`setSession()` overwrite `host`/`instance`/`apiKey` in place. `loadProfileCredentials` (on the `Dxm` class) routes through `setCredentials` for exactly this reason — do not mutate `_credentials` in place when loading a profile.

### Credential profiles

Profiles live in `process.env.DXM_MCP_PROFILES_PATH ?? ~/.dxm-mcp/profiles.json`, which is per-OS-user, written via atomic `<path>.tmp` + `rename` with mode `0o600` (best-effort on Windows; the parent dir under `$HOME` already restricts access). The file holds `{ [name]: { server, instance, username, password, apiKey } }`. No encryption — filesystem permissions are the security boundary, consistent with how `.env` already works. The `dxm/profiles.js` module never logs values; only `listNames()` is callable from contexts where leakage matters.

Profiles are created from a real terminal with `npm run profile -- add <name>` (or `node tools/profile-manager.js add <name>`), which prompts via `readline` with the password field masked. The CLI writes only to `$HOME` — never to the repo. There is intentionally no in-chat tool that takes a password.

All auth tools have prompt companions — `login` is safe because `profile` is a non-secret alias and the actual credentials live in the profile store; `login_browser` is safe because `server`/`instance` are non-secret and credentials never enter chat (they're typed into the real browser window). `upload_file`, `upload_replace_file`, and `attach_file` also have prompt companions now that they take a filesystem `path` rather than inlined base64. The only prompt companion intentionally not provided is for `create_user`, because it takes a password argument.

### Browser-based login

`login_browser` is implemented in `dxm/browser-login.js`. It dynamic-imports `playwright` (declared in `optionalDependencies` so installs that don't need it don't pay the ~300 MB Chromium download), launches Chromium with `headless: false`, navigates to `https://{server}/{instance}/`, and attaches two listeners:

- `page.on("request")` sniffs `x-api-key` off any `/cpt_webservice/AccessAPI/` XHR. The key is per-instance, not per-user, and identical across every authenticated request — the first one we see is the one we keep.
- `page.on("response")` watches for `/auth/authenticate` with status 200 and `resultCode === "conWS_Success"`. Setting that signal terminates the wait loop.

After both signals fire, `context.cookies("https://{server}")` is mapped to the array-of-strings shape `set-cookie-parser.splitCookiesString` produces (which is what the helper's `postRequest` already consumes). The browser is closed via `try/finally`. A best-effort `page.evaluate` scrapes the username from the post-login UI; failure returns `null` (it's just for display in `whoami`).

The login deadline is 5 minutes (vs. the standard 30-second `TOOL_TIMEOUT_MS`) because human SSO/MFA can be slow — `login_browser` is intentionally **not** wrapped in `toolHandler`; it open-codes the error envelope so the standard timeout doesn't kill an in-progress login. After login completes, normal tool calls go back to using `toolHandler` and its 30-second guard.

Users need a one-time `npx playwright install chromium` after `npm install` to pull the browser binary. If `playwright` itself isn't installed (e.g. `--no-optional`), the tool returns a clear error naming the install command.

**Cookie-header bug fix in the helper.** While wiring up browser-based login we found and fixed an underlying bug in `crownpeak-dxm-accessapi-helper`'s `postRequest`. The old code did `options.headers.cookie = this.cookie` (assigning the raw array directly), which causes `node-fetch` to comma-join the elements — producing a malformed Cookie header like `name1=val1; Path=/; HttpOnly,name2=val2; Path=/; Secure`. Splitting that on `;` (the proper cookie delimiter) corrupts every cookie name after the first (e.g. `HttpOnly,name2` becomes the apparent cookie name). The password-login path happens to capture only 1 cookie typically, so the bug never bit anyone. The browser-login path captures every cookie on the CMS origin (often 3–5+), so the bug shows up immediately as "auth succeeded but follow-up tool calls fail". The fix mirrors what `getCmsRequest` already did: `options.headers.cookie = this.cookie.map(c => c.split(";")[0]).join("; ")`. Shipped in helper `1.2.0` alongside `setSession`.

## HTTP transport

`server-http.js` / `server-readonly-http.js` wrap the same tool registry in MCP's Streamable HTTP transport via `dxm/http.js`. Vanilla `node:http`, **stateless** mode (`sessionIdGenerator: undefined`), bound to `127.0.0.1:3000` by default — override with `HOST` / `PORT` env vars. A fresh `McpServer` + `StreamableHTTPServerTransport` is built per request; the `Dxm` singleton (and its `_cms` helper instance) is shared across requests so authentication is amortized.

**Credentials must come from `.env`.** The HTTP entry points construct `Dxm(process.env)` once at startup and never accept new credentials. `login`, `login_browser`, `logout`, `list_profiles`, and `delete_profile` are deliberately excluded from the HTTP composition because they mutate the shared `Dxm` singleton, which has no coherent meaning across concurrent stateless requests. (`login_browser` is also fundamentally a per-user-machine action — launching a browser from a shared HTTP server makes no sense.) `whoami` is kept (read-only, safe). The split lives in `dxm/tools/auth.js` as `registerWhoami` vs `registerCredentialTools`; `dxm/tools/index.js` exposes `registerReadToolsHttp` which uses only the former. If `.env` is missing the server still starts but logs a startup warning — every tool call will then fail with "Not authenticated".

**Security defaults.** Bind defaults to `127.0.0.1` because the process holds CMS credentials reachable by anyone who can reach the port. When `HOST=127.0.0.1`/`localhost`/`::1`, the SDK transport's `enableDnsRebindingProtection` is turned on with an `allowedHosts` list of the loopback addresses on the chosen port — a browser on the same machine submitting requests with a non-loopback `Host` header gets a 403. Binding to `0.0.0.0` disables that check (caller opt-in) and logs an explicit warning at startup. No TLS in-process — terminate at a reverse proxy if you need it.

**Prompts.** The HTTP composition uses `registerPromptsHttp`, which excludes the prompts whose target tools aren't exposed (`login` / `login_browser` / `logout` / `list_profiles` / `delete_profile`). `whoami` and every operational prompt stay. The split lives in `dxm/tools/prompts.js` as `registerCredentialPrompts` vs `registerPromptsHttp`; `registerPrompts` is a stdio wrapper that calls both.

## Architecture

Three layers, all in ES Modules (`"type": "module"`):

1. **`dxm/`** — the `Dxm` class shell plus per-domain wrapper modules. The shell holds credentials, `_ensureLoggedIn`, `_mapAsset`, and mixes every exported domain function in as a class method via a small `mixin(target, mod)` helper, so tools keep calling `dxm.findAsset(...)` etc. without knowing which domain file the implementation lives in.

   ```
   dxm/
     index.js       Dxm class shell (~70 lines)
     util.js        mapAsset helper (no dxm reference; takes cms as arg)
     assets.js      findAsset, getPath, listFolder/Fields, set/deleteFields, setCode,
                    create*, branch/delete/undelete, move/rename, logMessage
     binary.js      downloadAsset, uploadAsset, attachAsset, viewOutput
     publish.js     getPublishLinks, publishAssets, republishAssets
     workflow.js    listWorkflows, getWorkflow, routeAsset, executeWorkflowCommand
     build.js       compileLibrary, compileProject, compileTemplates
     properties.js  listAttachments, readSiteRoot, listVersions, getVersion,
                    revertToVersion, setModel, setTemplate, setWorkflow
     users.js       listUsers, createUser
     report.js      siteSummary, publishingErrors
     profiles.js    read/write/list/delete credential profiles in ~/.dxm-mcp/profiles.json
     debug.js       isDebugEnabled/truncate shared by the DXM_MCP_DEBUG logging (see "Debugging")
   ```

   Each domain module exports plain `function name(dxm, ...args)` functions — no class, no `this`. They call `await dxm._ensureLoggedIn()` first and use `mapAsset(dxm._cms, raw)` from `dxm/util.js` for any returned asset.

2. **`dxm/tools/`** — MCP tool and prompt registration, split per domain.

   ```
   dxm/tools/
     index.js       Composes registerReadTools / registerWriteTools / registerPrompts
                    from the per-domain registers. The only thing server.js imports.
     util.js        toolHandler, TOOL_TIMEOUT_MS, MIME tables, parseIdList, checkBase64Size, readFileForUpload
     auth.js        login, logout, whoami, list_profiles, delete_profile (all read-side so both stdio servers expose them; HTTP exposes only whoami)
     asset.js       find/list/get/set, all create_*, move/rename, delete/undelete, branch, log_message
     binary.js      download_image, download_file, view_output, upload_file, attach_file
     publish.js     list_links, publish_file, republish_file
     workflow.js    list_workflows, get_workflow, route_file, execute_workflow_command
     build.js       compile_library, compile_project, compile_templates
     properties.js  list_attachments, read_site_root, list_versions, get_version,
                    revert_to_version, set_model, set_template, set_workflow
     users.js       list_users, create_user
     report.js      site_summary, publishing_errors
     prompts.js     All server.prompt(...) registrations in one place
   ```

3. **`server.js` / `server-readonly.js`** — thin entry points that wire up the `McpServer`, `StdioServerTransport`, and the appropriate registration calls.

### Read vs write decision rule

Anything that **mutates server state** lives in `registerWriteTools` and is only mounted by `server.js`. Inspection-only operations live in `registerReadTools` and are mounted by both servers. `route_file` lives in `dxm/tools/workflow.js` (workflow domain), not `asset.js`, because it manipulates workflow state.

### Key patterns

- **`mapAsset(cms, a)`** in `dxm/util.js` is the canonical asset shape returned to clients: `{ id, label, type, fullPath, status, folder_id, error_msg }`. The numeric `type` is decoded to its name via `Util.AssetType`. `Dxm._mapAsset(a)` is a thin shim that calls it with `this._cms`. Use this for any new method that returns an asset.

- **`toolHandler(fn)`** in `dxm/tools/util.js` wraps every tool to (a) race against a 30 s timeout (`TOOL_TIMEOUT_MS`) and (b) catch errors into `{ content: [...], isError: true }`. The timeout exists because the underlying CJS library has a recursive 429 retry whose `attempt` counter resets each call, causing infinite recursion / stack overflow — `Promise.race` is the guardrail. Always wrap new tool handlers with it.

- **Path-or-ID inputs**: tools that accept a numeric asset ID typically have a companion prompt that accepts either a numeric ID or a full CMS path (e.g. `/Site/Folder/Page`). The prompt instructs the model to call `find_asset` first to resolve a path to an ID. `findAsset` itself uses `Asset.exists` (which returns `{ exists, assetId }` — flat, not nested) for path lookups and `Asset.read` for numeric IDs.

- **Multi-ID write tools** (`set_model`, `set_template`, `set_workflow`, `publish_file`, `republish_file`) take an `ids` string parameter that is a JSON array (e.g. `"[12345]"`). `parseIdList(input)` in `dxm/tools/util.js` accepts a JSON array, a bare numeric string, or a number, and returns an array.

- **`AssetCreateRequest`** params for `create_file_*` tools: `type=2` is File, `type=4` is Folder; `modelId=-1` and `templateId=0` / `workflowId=0` are the neutral defaults. `createAsset(...)` produces files, `createFolder(...)` produces folders, and the *_with_model variants use the dedicated helper endpoints.

- **`list_links`** by default filters published URLs to those whose `packageName` (case-insensitive) contains "live" or "prod"; pass `all: true` to bypass the filter.

- **Binary downloads**: MCP only has an `image` content type for binary. `download_image` returns `{ type: "image", data, mimeType }`; `download_file` returns a JSON envelope inside a `text` block for other binaries. MIME types are looked up from `IMAGE_MIME_TYPES` / `FILE_MIME_TYPES` tables based on the file extension from the asset's label.

- **Binary uploads** (`upload_file`, `attach_file`) take a filesystem `path`; the server reads the file directly via `readFileForUpload` (in `dxm/tools/util.js`), keeping the bytes out of the LLM context. Capped at `MAX_UPLOAD_BYTES` (~11 MB raw, chosen so the encoded payload stays under the existing 15 MB base64 guardrail). `name` / `original_filename` default to the file's basename. `attach_file` uses the chunked `attachv2` endpoint for size resilience.

- **`view_output`** returns the rendered HTML of an asset as a single text block. Useful as a quick preview without going through publish.

- **`create_user` gotcha**: the helper's `UserCreateRequest.toJson()` sets `generateOneTimeUsePassword` to *true* when a password was provided — that is inverted vs. the JSDoc. The wrapper in `dxm/users.js` builds the request body manually with the corrected semantics (`generateOneTimeUsePassword = !hasPassword`).

- **`AssetProperties.setWorkflow`** URL has a typo (`SetWOrkflow` capital O) — but the server accepts it. We pass through the helper, which already encodes the typo.

- **Version history** (`list_versions` / `get_version`, implemented in `dxm/properties.js`) is the one place we bypass the helper's named methods: the helper has no wrapper for `/AssetProperties/Versions*`, so these call `cms.Util.makeCall(cms, path, body)` — the same generic primitive `AssetProperties.attachments()` and friends use internally. That keeps the feature in this repo rather than requiring a helper release: `package.json` tracks the published `^1.2.0`, so helper methods added only to a local checkout would vanish on a fresh `npm install`. If these ever move into the helper, publish it first and bump the dependency. Four API quirks are worked around, all verified against a live instance — **do not "simplify" any of them away**:
  - **Pages are 1-based.** `currentPage: 0` returns an empty `assetVersions` array *with `resultCode: conWS_Success`*, so a 0-based loop looks exactly like "this asset has no history".
  - **The last page is padded with a sentinel row whose `versionId` is `-1`.** `listVersions` filters these out; a page whose real-row count falls below `pageSize` after filtering is treated as the last page.
  - **`totalCount` is unreliable** — it disagrees with the actual row count depending on `pageSize` (observed 6 vs 5 for the same asset). `listVersions` pages to exhaustion instead of computing a page count from it, with `MAX_VERSION_PAGES` as the safety net.
  - **`/Versions/Content` silently ignores an unknown `versionId`** and returns the asset's *current* content with a success result code. `getVersion` therefore resolves the requested id against the real history first and throws if it's absent — without that guard the tool would hand an LLM the wrong version's data with no indication anything was wrong. (Verified: a valid id returned 166 fields where a bogus one returned the live asset's 109.)

  On the wire the version rows are camelCase — note `modified_On` (capital O) — and `name` is the **user who made the change**, not the asset's name; `mapVersion` renames these to `modifiedOn` / `modifiedBy`. `getVersion` returns its fields in the same `{ name, value }` shape as `list_fields`, which is what makes the `compare_version` prompt a diff with no extra tool.

  `revertToVersion` (tool: `revert_to_version`, **write** — so it is absent from both read-only servers) calls `/Asset/RevertToVersion` with `{ assetId, versionId, isConfirmed: true }` and shares the same `resolveVersion` guard, which matters more here than on the read path: refusing an unknown version id prevents a bad *write* rather than a bad read, and the guard is asserted to make no revert call at all when it rejects. It lives in `properties.js` with the rest of the version family rather than in `assets.js` despite the `/Asset/` path — the same concept-over-path grouping that puts `routeAsset` in `workflow.js`. Two notes:
  - **`isConfirmed` is hardcoded `true` and not exposed as a tool parameter.** The API also accepts `false`, but what that returns was never probed, because probing it means writing to a real asset. Don't expose the flag without first establishing what the false branch actually does.
  - **The mutation itself is unverified against a live instance** for the same reason. The request/response shapes come from the Swagger v3 spec; the unit tests cover the wrapper's own logic. `newVersionId` is read as `response.newVersionId ?? response.NewVersionId` because Swagger declares it PascalCase while every other response in this family arrives camelCase, and which one the wire actually uses is untested.

  Reverting appends a new version rather than rewriting history, so the pre-revert content stays recoverable — the `revert_to_version` prompt says so, and it also requires an explicit user confirmation plus a `compare_version`-style diff before it will call the tool.

  One adjacent endpoint remains unexposed: `/AssetProperties/Versions/Source` (`{ assetId, versionId }` → `{ source }`), which would be a read tool.

### CJS interop note

`crownpeak-dxm-accessapi-helper` is a CommonJS module. Import it as `import CmsApi from "crownpeak-dxm-accessapi-helper"` (default import, then `new CmsApi()`). A namespace import will give you `{ default: Class }`, not the class.

## Tool roster

57 tools and 59 prompts. Read tools (24) live on both stdio servers (HTTP read drops 5 credential-mutation tools, exposing only 19); write tools (33) only on the full server. The only tool with no prompt companion is `create_user`, because it takes a password argument that should not live in prompt templates.

**Read tools**: `login`, `login_browser`, `logout`, `whoami`, `list_profiles`, `delete_profile`, `find_asset`, `get_path`, `list_folder`, `list_fields`, `get_code`, `download_image`, `download_file`, `view_output`, `list_links`, `list_workflows`, `get_workflow`, `list_attachments`, `read_site_root`, `list_versions`, `get_version`, `list_users`, `publishing_errors`, `site_summary`.

**Write tools**: `revert_to_version`, `set_fields`, `set_field`, `delete_fields`, `delete_field`, `set_code`, `delete_file`, `undelete_file`, `branch_file`, `move_file`, `rename_file`, `create_file_from_model`, `create_file`, `create_folder`, `create_folder_with_model`, `create_project`, `create_site_root`, `create_library_reference`, `log_message`, `upload_file`, `upload_replace_file`, `attach_file`, `publish_file`, `republish_file`, `route_file`, `execute_workflow_command`, `compile_library`, `compile_project`, `compile_templates`, `set_model`, `set_template`, `set_workflow`, `create_user`.

**Prompts**: `login`, `login_browser`, `logout`, `whoami`, `list_profiles`, `delete_profile`, `lookup`, `browse`, `read_asset`, `edit_asset`, `edit_code`, `get_code`, `list_links`, `delete_file`, `undelete_file`, `branch_file`, `route_file`, `create_file_from_model`, `create_file`, `get_path`, `move_file`, `rename_file`, `set_field`, `set_fields`, `delete_field`, `delete_fields`, `set_code`, `set_model`, `set_template`, `set_workflow`, `publish_file`, `republish_file`, `execute_workflow_command`, `view_output`, `create_folder`, `create_folder_with_model`, `create_project`, `create_site_root`, `create_library_reference`, `log_message`, `download_image`, `download_file`, `list_workflows`, `get_workflow`, `list_attachments`, `read_site_root`, `list_versions`, `get_version`, `compare_version`, `revert_to_version`, `list_users`, `publishing_errors`, `site_summary`, `compile_library`, `compile_project`, `compile_templates`, `upload_file`, `upload_replace_file`, `attach_file`.
