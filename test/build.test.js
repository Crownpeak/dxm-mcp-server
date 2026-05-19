import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { compileLibrary, compileProject, compileTemplates } from "../dxm/build.js";
import { makeFakeCms, makeFakeDxm } from "./_helpers.js";

describe("compileLibrary", () => {
    test("delegates to Tools.recompileLibrary with the id", async () => {
        let captured;
        const cms = makeFakeCms({
            Tools: { recompileLibrary: async id => { captured = id; return { isSuccessful: true }; } }
        });
        const result = await compileLibrary(makeFakeDxm(cms), 11);
        assert.equal(captured, 11);
        assert.deepEqual(result, { isSuccessful: true });
    });
});

describe("compileProject", () => {
    test("delegates to Tools.recompileProject with the id", async () => {
        let captured;
        const cms = makeFakeCms({
            Tools: { recompileProject: async id => { captured = id; return { isSuccessful: true }; } }
        });
        const result = await compileProject(makeFakeDxm(cms), 22);
        assert.equal(captured, 22);
        assert.deepEqual(result, { isSuccessful: true });
    });
});

describe("compileTemplates", () => {
    test("delegates to Tools.recompileTemplates with the id", async () => {
        let captured;
        const cms = makeFakeCms({
            Tools: { recompileTemplates: async id => { captured = id; return { isSuccessful: true }; } }
        });
        const result = await compileTemplates(makeFakeDxm(cms), 33);
        assert.equal(captured, 33);
        assert.deepEqual(result, { isSuccessful: true });
    });

    test("calls _ensureLoggedIn before invoking the helper", async () => {
        const cms = makeFakeCms({
            Tools: { recompileTemplates: async () => ({}) }
        });
        const dxm = makeFakeDxm(cms);
        await compileTemplates(dxm, 1);
        assert.equal(dxm.ensureLoginCalls, 1);
    });
});
