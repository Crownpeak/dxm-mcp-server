# Crownpeak DXM MCP Server

An [MCP](https://modelcontextprotocol.io) server that lets an AI assistant — Claude Desktop, Claude Code, or any MCP-compatible client — work with your [Crownpeak DXM](https://www.crownpeak.com/products/digital-experience-management) CMS through natural language. Browse the asset tree, read and edit fields, create and publish files, run compilations, manage users, and more.

The server exposes **57 tools and 59 prompts** spanning the read and write surface of `crownpeak-dxm-accessapi-helper`. It comes in two permission scopes (full and read-only) over two transports (stdio and HTTP), so you can pick the safest combination for each use case.

---

## Quick start

```bash
# 1. Clone and install
git clone https://github.com/crownpeak/dxm-mcp-server/ dxm-mcp-server
cd dxm-mcp-server
npm install

# 2. Set up credentials (pick one approach — see "Credentials" below)
cp .env.example .env      # then edit .env with your CMS details

# 3. Run the server (stdio for desktop MCP clients)
npm run server            # full read + write
# or
npm run server:readonly   # safe read-only subset

# 4. Wire it into your MCP client (see "Connecting an MCP client" below)
```

---

## Requirements

- **Node.js 18 or newer** (Node 20+ recommended; tested on 24)
- A Crownpeak DXM account with API access — specifically:
  - CMS hostname (e.g. `cms.crownpeak.net`)
  - Instance name
  - Username and password
  - API key

---

## Installation

```bash
git clone https://github.com/crownpeak/dxm-mcp-server/ dxm-mcp-server
cd dxm-mcp-server
npm install
```

No native dependencies. Everything is pure JavaScript.

---

## Credentials

The server needs five values to talk to your DXM instance: `CMS_SERVER`, `CMS_INSTANCE`, `CMS_USERNAME`, `CMS_PASSWORD`, `CMS_API_KEY`. There are three ways to provide them — all keep secrets out of the chat/model context, since the MCP elicitation spec [forbids](https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation) servers from requesting sensitive data through the chat. Pick the one that fits your workflow — they can be combined.

### Option 1 — `.env` file (simplest for local use)

```bash
cp .env.example .env
# Edit .env and fill in the five CMS_* values
```

The server reads `.env` at startup and authenticates on the first tool call. `.env` is gitignored, so it never leaks into source control. With `.env` set, you don't need to call `login` at all — every tool just works.

### Option 2 — Named credential profiles (recommended for multiple instances)

If you work with more than one DXM instance, save each set of credentials under a profile name and switch between them:

```bash
# Run this from a real terminal (not from inside an MCP client) so the password input is masked
npm run profile -- add production
# Prompts for server, instance, username, password (masked), and api key.
# Stored in ~/.dxm-mcp/profiles.json with 0600 permissions (filesystem ACL on Windows).
```

Then, from your MCP client, call the `login` tool with the profile name:

```
login profile=production
```

List or delete profiles via the `list_profiles` and `delete_profile` tools. Profile creation is intentionally CLI-only — there is no in-chat tool that accepts a password.

### Option 3 — Browser-based login (`login_browser`)

If your CMS uses SSO/MFA or you'd rather not type a password into a CLI prompt, install the optional Playwright dependency and let the MCP server open the real CMS login page in a Chromium window:

```bash
# One-time setup: install Playwright and download the Chromium binary.
# Playwright is declared in optionalDependencies, so it should already be installed
# by `npm install` unless you used --no-optional. The browser binary is separate:
npx playwright install chromium
```

Then, from your MCP client:

```
login_browser server=cms.crownpeak.net instance=CPUK
```

A Chromium window opens pointed at your CMS login page. Complete the login however you normally would (standard password, SSO redirect, MFA prompt — anything the CMS web UI supports). The MCP server observes the response, captures the resulting session cookies from in-flight requests, and closes the browser. The captured session lives in memory only — restarting the server requires a new browser login. Nothing is written to disk.

If `playwright` isn't installed (e.g. you ran `npm install --no-optional`), the tool returns a clear error naming the install command.

### What about the HTTP server?

HTTP servers (see below) only accept credentials from `.env` or environment variables. Profile-based and browser-based login are not available there because the credential-management tools mutate process-wide state, which has no coherent meaning across concurrent stateless HTTP requests.

---

## Running the server

Four entry points share the same tool registry:

| Command | Transport | Permissions | Use case |
|---|---|---|---|
| `npm run server` | stdio | read + write | Daily editing from Claude Desktop / Claude Code |
| `npm run server:readonly` | stdio | read only | Exploratory / analysis sessions where mutations should be impossible |
| `npm run server:http` | HTTP | read + write | Browser-based or remote MCP clients |
| `npm run server:readonly:http` | HTTP | read only | Same as above, with mutation guardrails |

Stdio servers communicate over standard input/output and are typically launched by an MCP client on demand. HTTP servers listen on `http://127.0.0.1:3000/mcp` by default; override with `PORT` and `HOST` environment variables.

---

## Connecting an MCP client

### Claude Desktop (stdio)

Edit your `claude_desktop_config.json` (location varies by OS — see [the Claude docs](https://modelcontextprotocol.io/quickstart/user)):

```json
{
  "mcpServers": {
    "dxm": {
      "command": "node",
      "args": ["/absolute/path/to/dxm-mcp-server/server.js"]
    },
    "dxm-readonly": {
      "command": "node",
      "args": ["/absolute/path/to/dxm-mcp-server/server-readonly.js"]
    }
  }
}
```

Restart Claude Desktop, then ask it something like *"What's in folder 12345 in DXM?"* and watch it call `list_folder`.

### Claude Code (stdio)

```bash
claude mcp add dxm node /absolute/path/to/dxm-mcp-server/server.js
claude mcp add dxm-readonly node /absolute/path/to/dxm-mcp-server/server-readonly.js
```

### HTTP clients

Start the server:

```bash
npm run server:http
# [Crownpeak DXM MCP Server (HTTP)] HTTP MCP server listening on http://127.0.0.1:3000/mcp
```

Point your MCP client at `http://127.0.0.1:3000/mcp`. The transport implements [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http) in stateless mode — no session headers required. Standard `POST` requests with `Content-Type: application/json` and `Accept: application/json, text/event-stream` work.

---

## What the server can do

A few representative examples of what an MCP client can do once connected:

- *"Find the page at /Home/About and show me its fields."*
- *"In the Marketing folder, list every asset whose name contains 'campaign'."*
- *"Read the code in template 98765 and add a meta description tag."*
- *"Publish assets 12345, 12346, and 12347, skipping dependencies."*
- *"Route /Home/Pricing to the Approval state."*
- *"Compile the templates folder under project 'Acme Site' and report any errors."*
- *"Upload `~/Downloads/logo.png` as a new asset in folder 4321."*
- *"Show me the version history of /Home/About — who changed it and when."*
- *"Compare the August version of asset 12345 against its current content and tell me what changed."*
- *"Roll /Home/About back to how it looked before yesterday's edit."*

The full tool and prompt rosters (with names, arguments, and one-line descriptions) live in [CLAUDE.md](./CLAUDE.md).

---

## Security notes

- **Treat the stdio servers like any other tool that holds DXM credentials.** A local process can read `.env` and `~/.dxm-mcp/profiles.json` — protect those files the same way you would protect any other credential store.
- **HTTP servers bind to `127.0.0.1` by default.** The process holds CMS credentials and exposes them to anything that can reach the port. Setting `HOST=0.0.0.0` is opt-in and logs a startup warning.
- **DNS rebinding protection** is enabled automatically when bound to a loopback address: requests whose `Host` header doesn't match `127.0.0.1`, `localhost`, or `::1` on the chosen port are rejected with `403`.
- **No TLS in process.** If you need HTTPS, put the HTTP server behind a reverse proxy (nginx, Caddy, etc.) that terminates TLS.
- **Credential profiles are stored unencrypted** at `~/.dxm-mcp/profiles.json` with `0600` permissions. The filesystem is the security boundary; this matches how `.env` is handled.
- **Browser-captured sessions are never persisted.** `login_browser` keeps the captured cookies and API key on the running `Dxm` instance only; restart the server (or call `logout`) to drop them.
- **Read-only servers cannot mutate the CMS.** Use them for AI agents you don't fully trust, or for exploratory sessions. `revert_to_version` is a write tool and so is absent from both read-only variants.
- **Reverting a version is additive, not destructive.** `revert_to_version` appends a new version whose content is the older one's, so the pre-revert content remains in the asset's history and can itself be reverted to. It still changes live content, so its prompt companion requires an explicit confirmation first.

---

## Tests

```bash
npm test
```

Runs the full suite (169 tests) using Node's built-in test runner. No network calls — every test stubs the CMS helper, so the suite is safe in CI and against shared credentials.

---

## Debugging

If a tool call from `client.js` (or any other MCP client) isn't behaving the way you expect, set `DXM_MCP_DEBUG=1` to get a full trace of both legs of traffic — the MCP calls between client and server, and the HTTPS calls between the server and the DXM backend:

```bash
DXM_MCP_DEBUG=1 npm run client server.js
```

```powershell
# PowerShell
$env:DXM_MCP_DEBUG = "1"
npm run client server.js
```

The flag works the same way for any of the four server entry points — set it before starting whichever one you're using. With it on, you'll see three kinds of line on stderr (never stdout, so it can't corrupt the MCP protocol stream):

```
[dxm-mcp-client] → find_asset {"query":"12345"}
[dxm-mcp] → find_asset {"query":"12345"}
[dxm-http] → POST https://cms.crownpeak.net/CPUK/cpt_webservice/accessapi/Auth/Authenticate headers={...} body={"instance":"CPUK","username":"you@example.com","password":"<redacted>",...}
[dxm-http] ← 200 (312ms) {"resultCode":"conWS_Success",...}
[dxm-mcp] ← find_asset (340ms) {"content":[...]}
[dxm-mcp-client] ← find_asset (342ms) {"content":[...]}
```

- `[dxm-mcp-client]` — the tool call `client.js` sends and the result it gets back.
- `[dxm-mcp]` — the same call as seen from inside the server, for every tool (including `login_browser`, which bypasses the usual timeout wrapper).
- `[dxm-http]` — the actual request/response between the server and the DXM backend, covering every domain (`Asset`, `Workflow`, `User`, ...) since they all funnel through the same HTTP layer.

`x-api-key` and `cookie` headers, and any JSON body field named `password`, `apiKey`, `secret`, `token`, or `cookie`, are redacted before logging — the output is meant to be safe to paste into a bug report. Response bodies that aren't JSON/text (image and file downloads) are logged as a placeholder rather than dumped in full.

---

## Troubleshooting

If none of the entries below match what you're seeing, turn on `DXM_MCP_DEBUG=1` (see [Debugging](#debugging)) to see exactly which request is failing and how.

**"Not authenticated. Call `login_browser`, `login`, or set CMS_* in .env."**
The server has no active credentials or session. Either fill out `.env` and restart, call `login profile=<name>` if you have a saved profile, or run `login_browser server=… instance=…` to capture a session through the browser.

**`login` returns "login requires a `profile` argument."**
Credentials cannot be entered through the MCP chat — the spec forbids it. Save a profile from a terminal with `npm run profile -- add <name>` then call `login profile=<name>`. Or set the `CMS_*` env vars in `.env` and restart the server. Or use `login_browser` if you'd prefer to authenticate through a real CMS login page.

**`login_browser` returns "Browser login needs the optional `playwright` dependency."**
Playwright wasn't installed (probably because `npm install --no-optional` was used). Run `npm install playwright` and then `npx playwright install chromium` to download the browser binary.

**`login_browser` returns "Login succeeded but x-api-key was not observed."**
The CMS UI authenticated the user, but no follow-up AccessAPI XHR fired within the grace window so we couldn't sniff the per-instance API key. Refresh the page and try again, or fall back to `.env` / a profile.

**HTTP server: `Invalid Host header: <something>`**
DNS rebinding protection rejected the request. If you're accessing from a non-loopback origin, you've likely intentionally bound to a public address — set `HOST=0.0.0.0` and use a reverse proxy with a known hostname for production setups.

**Tool call hangs and eventually times out after 30 seconds.**
The underlying CMS request didn't return in time. The 30-second cap exists to prevent a known recursive-retry bug in the helper library from running forever. Check the CMS itself or your network connectivity — running with `DXM_MCP_DEBUG=1` will show whether the request ever reached the CMS and what, if anything, came back before the timeout fired.

`revert_to_version` is the exception: the CMS regularly takes more than 30 seconds over it, so that one tool is allowed 180 seconds. Your MCP *client* applies its own timeout on top, which the server can't influence — in Claude Code it is `MCP_TOOL_TIMEOUT` (60 seconds by default), so if a revert is cut off well before 180 seconds, raise that:

```bash
MCP_TOOL_TIMEOUT=200000 claude   # milliseconds
```

**`upload_file` fails with "File ... is X MB; the upload cap is 11 MB."**
Binary uploads are capped at ~11 MB of raw bytes. Split larger files or use a different upload path.

---

## Contributing

We welcome contributions!

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT © [Crownpeak Technology GmbH](https://www.crownpeak.com/)

See [LICENSE](./LICENSE) file for details.

## Issues

Found a bug or have a feature request?
Please [open an issue](https://github.com/crownpeak/dxm-mcp-server/issues/new/choose).

## Support

- **Issues**: [GitHub Issues](https://github.com/Crownpeak/dxm-mcp-server/issues)
- **Website**: [crownpeak.com](https://www.crownpeak.com/)