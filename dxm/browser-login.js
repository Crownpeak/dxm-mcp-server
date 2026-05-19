// Headed-browser login flow. Captures session cookies + per-instance x-api-key
// by observing the real /auth/authenticate XHR. Playwright is loaded via dynamic
// import so it stays an optional dependency — installs that only use password
// login never pay the Chromium-download cost.

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 250;
// After /auth/authenticate succeeds, the CMS UI fires several follow-up XHRs
// (settings/security, auth/systemcontext, ...) that carry the per-instance
// x-api-key header in their requests AND can set additional cookies in their
// responses. We wait for /auth/systemcontext specifically because it's the
// "session is now fully established" signal in the CMS UI flow.
const POST_AUTH_SETTLE_MS = 8000;

export async function runBrowserLogin({ server, instance, timeoutMs = LOGIN_TIMEOUT_MS, signal } = {}) {
    if (!server || !instance) {
        throw new Error("runBrowserLogin requires `server` and `instance`.");
    }

    let playwright;
    try {
        playwright = await import("playwright");
    } catch {
        throw new Error(
            "Browser login needs the optional `playwright` dependency. Install it with " +
            "`npm install playwright` and then `npx playwright install chromium`."
        );
    }

    const browser = await playwright.chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    let capturedApiKey = null;
    let authSucceeded = false;
    let systemContextSucceeded = false;
    let userClosedBrowser = false;

    page.on("request", req => {
        if (capturedApiKey) return;
        if (!req.url().includes("/cpt_webservice/AccessAPI/")) return;
        const headers = req.headers();
        if (headers["x-api-key"]) capturedApiKey = headers["x-api-key"];
    });

    page.on("response", async resp => {
        const url = resp.url();
        if (resp.status() !== 200) return;
        // Match both the password endpoint (`/auth/authenticate`) and the SSO endpoint
        // (`/auth/authenticateFederated`), plus any future `authenticate{Provider}` variant
        // (e.g. `authenticateSaml`, `authenticateOAuth`). All return the same conWS_Success
        // shape on a successful login.
        if (!authSucceeded && /\/auth\/authenticate[A-Za-z]*(?:\?|$)/i.test(url)) {
            try {
                const body = await resp.json();
                if (body.resultCode === "conWS_Success") authSucceeded = true;
            } catch { /* not JSON or already consumed — ignore */ }
            return;
        }
        if (!systemContextSucceeded && /\/auth\/systemcontext(?:\?|$)/i.test(url)) {
            systemContextSucceeded = true;
        }
    });

    browser.on("disconnected", () => { userClosedBrowser = true; });

    try {
        await page.goto(`https://${server}/${instance}/`, { waitUntil: "domcontentloaded" });

        const deadline = Date.now() + timeoutMs;
        while (!authSucceeded) {
            if (userClosedBrowser) throw new Error("Browser was closed before login completed.");
            if (signal?.aborted) throw new Error("Browser login cancelled.");
            if (Date.now() > deadline) throw new Error("Browser login timed out.");
            await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
        }

        // Give the CMS UI time to fire its post-login bootstrap XHRs. We need
        // systemcontext to land (it's the moment the server considers the
        // session fully usable) AND we need at least one AccessAPI request
        // to fire so we can sniff x-api-key.
        const settleDeadline = Date.now() + POST_AUTH_SETTLE_MS;
        while ((!systemContextSucceeded || !capturedApiKey) && Date.now() < settleDeadline) {
            if (userClosedBrowser) break;
            await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
        }

        if (!capturedApiKey) {
            throw new Error(
                "Login succeeded but x-api-key was not observed on any AccessAPI request " +
                "within the settle window. Refresh the page and try again."
            );
        }

        // Pull cookies for the actual API path the helper will hit. Filtering by the API URL
        // (rather than just the host) ensures we capture any cookie whose Path is scoped
        // to the AccessAPI subtree.
        const apiUrl = `https://${server}/${instance}/cpt_webservice/accessapi/`;
        const playwrightCookies = await context.cookies(apiUrl);
        if (playwrightCookies.length === 0) {
            throw new Error("Login succeeded but no cookies were set on the CMS origin.");
        }

        // Emit just "name=value" — Path/Domain/HttpOnly/Secure don't belong in a Cookie
        // *request* header. The helper's postRequest/getCmsRequest strip everything after
        // the first ";" anyway, but emitting clean strings here keeps the data path obvious
        // and removes any chance of mojibake from attribute parsing.
        const cookie = playwrightCookies.map(c => `${c.name}=${c.value}`);

        // Diagnostic: log cookie names (NOT values) to stderr so a real-world failure
        // can be debugged without re-running. Values are secret; names are not.
        process.stderr.write(
            `[login_browser] captured ${cookie.length} cookies: ${playwrightCookies.map(c => c.name).join(", ")}\n`
        );

        // Best-effort username scrape. The CMS UI markup varies, so try a few selectors.
        // Falls back to null — don't fail the whole login on this.
        const username = await page.evaluate(() => {
            const selectors = [
                "[data-test='user-menu'] .username",
                ".user-menu .username",
                ".username",
                "[class*='user'] [class*='name']"
            ];
            for (const sel of selectors) {
                const el = document.querySelector(sel);
                const text = el?.textContent?.trim();
                if (text) return text;
            }
            return null;
        }).catch(() => null);

        return { host: server, instance, apiKey: capturedApiKey, cookie, username };
    } finally {
        await browser.close().catch(() => {});
    }
}
