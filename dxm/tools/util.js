export const IMAGE_MIME_TYPES = {
    jpg:  "image/jpeg",
    jpeg: "image/jpeg",
    png:  "image/png",
    gif:  "image/gif",
    webp: "image/webp",
    svg:  "image/svg+xml",
    tiff: "image/tiff",
    tif:  "image/tiff",
    bmp:  "image/bmp",
};

export const FILE_MIME_TYPES = {
    ...IMAGE_MIME_TYPES,
    pdf:  "application/pdf",
    zip:  "application/zip",
    doc:  "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls:  "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    txt:  "text/plain",
    html: "text/html",
    css:  "text/css",
    js:   "application/javascript",
    json: "application/json",
    xml:  "application/xml",
    mp4:  "video/mp4",
    mp3:  "audio/mpeg",
};

export const TOOL_TIMEOUT_MS = 30000;

// Sanity cap on base64 payloads passed to upload_file / attach_file (bytes of base64 string itself).
// 10 MB of raw bytes is ~13.4 MB of base64; cap at 15 MB string length to leave a little headroom.
export const MAX_BASE64_BYTES = 15 * 1024 * 1024;

// Raw-bytes cap for files read from disk by upload_file / attach_file. Chosen to encode to under
// MAX_BASE64_BYTES so the existing base64 guardrail still holds.
export const MAX_UPLOAD_BYTES = 11 * 1024 * 1024;

export function toolHandler(fn) {
    return async (args) => {
        let timer;
        try {
            const timeout = new Promise((_, reject) => {
                timer = setTimeout(
                    () => reject(new Error(`DXM API call timed out after ${TOOL_TIMEOUT_MS / 1000}s`)),
                    TOOL_TIMEOUT_MS
                );
            });
            return await Promise.race([fn(args), timeout]);
        } catch (e) {
            return {
                content: [{ type: "text", text: e?.message ?? String(e) }],
                isError: true
            };
        } finally {
            // Without this, fn() winning the race leaves the timer pending and the Node
            // event loop stays alive for the full TOOL_TIMEOUT_MS after every tool call —
            // invisible in production (server runs forever anyway) but visible in tests as a
            // 30-second hang at the end of test files that invoke wrapped handlers.
            clearTimeout(timer);
        }
    };
}

export function parseIdList(input, paramName = "ids") {
    if (typeof input === "number") return [input];
    if (Array.isArray(input)) return input.map(Number);
    let parsed;
    try {
        parsed = JSON.parse(input);
    } catch {
        // Allow a bare number as a string
        if (/^\d+$/.test(String(input).trim())) return [Number(input)];
        throw new Error(`Invalid ${paramName}: expected a JSON array (e.g. "[12345]") or a single numeric ID`);
    }
    if (!Array.isArray(parsed)) {
        if (typeof parsed === "number") return [parsed];
        throw new Error(`Invalid ${paramName}: expected a JSON array of numeric IDs`);
    }
    return parsed.map(Number);
}

export function jsonText(value) {
    return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

export function checkBase64Size(b64, paramName = "bytes") {
    if (typeof b64 !== "string") {
        throw new Error(`Invalid ${paramName}: expected a base64-encoded string`);
    }
    if (b64.length > MAX_BASE64_BYTES) {
        const mb = (MAX_BASE64_BYTES / (1024 * 1024)).toFixed(0);
        throw new Error(`Input ${paramName} exceeds size limit (${mb} MB of base64). Reduce file size or split into chunks.`);
    }
}

// Read a file from disk and base64-encode it for upload. The size guard runs before readFile
// so we never pull a multi-GB file into memory just to reject it.
export async function readFileForUpload(filePath) {
    const { stat, readFile } = await import("node:fs/promises");
    let info;
    try {
        info = await stat(filePath);
    } catch (e) {
        if (e?.code === "ENOENT") {
            throw new Error(`File not found: ${filePath}`);
        }
        throw new Error(`Cannot read ${filePath}: ${e?.message ?? e}`);
    }
    if (!info.isFile()) {
        throw new Error(`Not a regular file: ${filePath}`);
    }
    if (info.size > MAX_UPLOAD_BYTES) {
        const mb = (MAX_UPLOAD_BYTES / (1024 * 1024)).toFixed(0);
        throw new Error(`File ${filePath} is ${(info.size / (1024 * 1024)).toFixed(1)} MB; the upload cap is ${mb} MB.`);
    }
    const buffer = await readFile(filePath);
    return buffer.toString("base64");
}
