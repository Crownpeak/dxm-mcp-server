import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { mapAsset, responseData } from "../dxm/util.js";
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
        const raw = { id: 7, label: "Home", type: 2, fullPath: "/Site/Home", statusName: "Live", folder_id: 3, branchId: 5, error_msg: "" };
        assert.deepEqual(mapAsset(cms, raw), {
            id: 7, label: "Home", type: "File", fullPath: "/Site/Home", status: "Live", folder_id: 3, branchId: 5, error_msg: ""
        });
    });

    test("passes branchId through unchanged for a master, a branch, and an unbranched asset", () => {
        // Values as observed on a live instance: a master's branchId is its own id, a branch's is
        // its master's id, and -2 marks an asset in no branch family.
        const map = (id, branchId) => mapAsset(cms, { id, type: 2, branchId }).branchId;
        assert.equal(map(276802, 276802), 276802, "master");
        assert.equal(map(355355, 276802), 276802, "branch points at its master");
        assert.equal(map(276804, -2), -2, "no branch family");
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

    test("strips session cookies at any depth, as a last line of defence", () => {
        // The helper attaches the live session cookies to every response; seven tools once
        // returned them to the model. Any cookie / cookies / set-cookie key is dropped.
        const leaky = { cookie: ["AWSALB=s1"], data: { Cookies: ["s2"], list: [{ "set-cookie": "s3", keep: 1 }] } };
        const text = jsonText(leaky).content[0].text;
        assert.deepEqual(JSON.parse(text), { data: { list: [{ keep: 1 }] } });
        assert.ok(!/s1|s2|s3/.test(text));
    });

    test("keeps keys that merely contain the word, like an asset label", () => {
        const text = jsonText({ label: "Components_SetProductCookie.cs", cookieConsent: true }).content[0].text;
        assert.deepEqual(JSON.parse(text), { label: "Components_SetProductCookie.cs", cookieConsent: true });
    });
});

describe("responseData", () => {
    const envelope = { resultCode: "conWS_Success", errorMessage: "", internalCode: 0, responseValues: null, cookie: ["AWSALB=secret"], isSuccessful: true };

    test("returns only the endpoint's data: no cookie, no envelope", () => {
        assert.deepEqual(responseData({ ...envelope, path: "/x", list: [] }), { path: "/x", list: [] });
    });

    test("throws the CMS's message, with context, when the call failed", () => {
        const failed = { ...envelope, isSuccessful: false, resultCode: "conWS_NotFound", errorMessage: "Asset 5 not found." };
        assert.throws(() => responseData(failed, "Could not read 5"), { message: "Could not read 5: Asset 5 not found." });
        assert.throws(() => responseData({ ...failed, errorMessage: "" }), { message: "the CMS returned conWS_NotFound" });
    });

    test("treats a response without isSuccessful as data", () => {
        assert.deepEqual(responseData({ id: 99 }), { id: 99 });
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
