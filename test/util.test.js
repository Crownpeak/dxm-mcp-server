import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { mapAsset } from "../dxm/util.js";
import {
    parseIdList,
    jsonText,
    checkBase64Size,
    readFileForUpload,
    toolHandler,
    MAX_BASE64_BYTES,
    MAX_UPLOAD_BYTES,
    TOOL_TIMEOUT_MS,
    SLOW_TOOL_TIMEOUT_MS,
    IMAGE_MIME_TYPES,
    FILE_MIME_TYPES
} from "../dxm/tools/util.js";
import { makeFakeCms } from "./_helpers.js";

describe("toolHandler", () => {
    test("passes the handler's result through untouched", async () => {
        const handled = toolHandler(async ({ n }) => ({ content: [{ type: "text", text: String(n * 2) }] }));
        assert.deepEqual(await handled({ n: 21 }), { content: [{ type: "text", text: "42" }] });
    });

    test("catches a thrown error into an isError envelope", async () => {
        const handled = toolHandler(async () => { throw new Error("Asset is locked"); });
        assert.deepEqual(await handled({}), {
            content: [{ type: "text", text: "Asset is locked" }],
            isError: true
        });
    });

    test("times out a handler that never settles, reporting the cap in seconds", async () => {
        // 20ms stands in for the real 30s cap; the override is what makes this testable at all.
        const handled = toolHandler(() => new Promise(() => {}), 20);
        const result = await handled({});
        assert.equal(result.isError, true);
        assert.match(result.content[0].text, /timed out after 0\.02s/);
    });

    test("honours a raised timeout for a handler slower than the default", async () => {
        const slow = () => new Promise(resolve => setTimeout(() => resolve({ content: [] }), 40));
        // Default cap would kill this at 20ms; the raised one must let it finish.
        assert.equal((await toolHandler(slow, 20)({})).isError, true);
        assert.deepEqual(await toolHandler(slow, 2000)({}), { content: [] });
    });

    test("the slow-tool ceiling is an extension of the default, not a replacement", () => {
        // revert_to_version opts into SLOW_TOOL_TIMEOUT_MS; everything else keeps the tight cap
        // that catches the helper's recursive-retry runaway.
        assert.ok(SLOW_TOOL_TIMEOUT_MS > TOOL_TIMEOUT_MS);
    });
});

describe("mapAsset", () => {
    const cms = makeFakeCms();

    test("decodes numeric asset type to its name", () => {
        const raw = { id: 7, label: "Home", type: 2, fullPath: "/Site/Home", statusName: "Live", folder_id: 3, error_msg: "" };
        assert.deepEqual(mapAsset(cms, raw), {
            id: 7, label: "Home", type: "File", fullPath: "/Site/Home", status: "Live", folder_id: 3, error_msg: ""
        });
    });

    test("passes the raw type through when unknown", () => {
        const raw = { id: 1, label: "?", type: 999, fullPath: "/x", statusName: "S", folder_id: 0 };
        assert.equal(mapAsset(cms, raw).type, 999);
    });
});

describe("parseIdList", () => {
    test("accepts a JSON array string", () => {
        assert.deepEqual(parseIdList("[1,2,3]"), [1, 2, 3]);
    });

    test("accepts a bare numeric string", () => {
        assert.deepEqual(parseIdList("42"), [42]);
    });

    test("accepts a number", () => {
        assert.deepEqual(parseIdList(7), [7]);
    });

    test("accepts an array directly", () => {
        assert.deepEqual(parseIdList([1, "2", 3]), [1, 2, 3]);
    });

    test("accepts a single-element JSON-encoded number", () => {
        assert.deepEqual(parseIdList("[12345]"), [12345]);
    });

    test("throws on invalid input", () => {
        assert.throws(() => parseIdList("not-json"), /Invalid ids/);
    });

    test("throws on non-array JSON object", () => {
        assert.throws(() => parseIdList('{"a":1}'), /Invalid ids/);
    });
});

describe("jsonText", () => {
    test("wraps a value as a single text content block", () => {
        const result = jsonText({ a: 1 });
        assert.deepEqual(result, { content: [{ type: "text", text: '{"a":1}' }] });
    });
});

describe("checkBase64Size", () => {
    test("accepts a string under the limit", () => {
        assert.doesNotThrow(() => checkBase64Size("abc"));
    });

    test("rejects a string over the limit", () => {
        const huge = "x".repeat(MAX_BASE64_BYTES + 1);
        assert.throws(() => checkBase64Size(huge), /exceeds size limit/);
    });

    test("rejects a non-string", () => {
        assert.throws(() => checkBase64Size(123), /expected a base64-encoded string/);
    });
});

describe("readFileForUpload", () => {
    let dir;

    test.before(async () => {
        dir = await mkdtemp(path.join(tmpdir(), "dxm-upload-"));
    });

    test.after(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    test("reads a file and returns base64", async () => {
        const file = path.join(dir, "hello.txt");
        await writeFile(file, "hello");
        const b64 = await readFileForUpload(file);
        assert.equal(Buffer.from(b64, "base64").toString("utf8"), "hello");
    });

    test("throws a clear error when the file is missing", async () => {
        const missing = path.join(dir, "does-not-exist.bin");
        await assert.rejects(() => readFileForUpload(missing), /File not found/);
    });

    test("throws when the path is not a regular file", async () => {
        await assert.rejects(() => readFileForUpload(dir), /Not a regular file/);
    });

    test("MAX_UPLOAD_BYTES stays below MAX_BASE64_BYTES once encoded", () => {
        // base64 expands ~4/3; the raw cap must encode to under the base64 cap.
        const encodedSize = Math.ceil(MAX_UPLOAD_BYTES / 3) * 4;
        assert.ok(encodedSize < MAX_BASE64_BYTES,
            `encoded ${encodedSize} should be < ${MAX_BASE64_BYTES}`);
    });
});

describe("MIME tables", () => {
    test("FILE_MIME_TYPES includes IMAGE_MIME_TYPES entries", () => {
        for (const [ext, mime] of Object.entries(IMAGE_MIME_TYPES)) {
            assert.equal(FILE_MIME_TYPES[ext], mime);
        }
    });

    test("FILE_MIME_TYPES covers common doc types", () => {
        assert.equal(FILE_MIME_TYPES.pdf, "application/pdf");
        assert.equal(FILE_MIME_TYPES.json, "application/json");
    });
});
