// Shared helpers for the DXM_MCP_DEBUG opt-in debug logging. Off by default; enabling it must
// never change tool behavior or use stdout — the stdio servers use stdout as the MCP protocol
// wire, so all debug output goes to stderr via console.error.
export function isDebugEnabled() {
    return !!process.env.DXM_MCP_DEBUG;
}

// Stringifies a value for a debug log line, capping length so a large payload (e.g. a
// download_file result, or an uploaded file's body) doesn't flood the terminal.
export function truncate(value, max = 4000) {
    if (value === undefined || value === null) return String(value);
    let s;
    try {
        s = typeof value === "string" ? value : JSON.stringify(value);
    } catch {
        s = String(value);
    }
    return s.length > max ? `${s.slice(0, max)}… (${s.length} chars total)` : s;
}
