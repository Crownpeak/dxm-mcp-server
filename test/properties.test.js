import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
    listAttachments, readSiteRoot,
    setModel, setTemplate, setWorkflow
} from "../dxm/properties.js";
import { makeFakeCms, makeFakeDxm } from "./_helpers.js";

describe("listAttachments", () => {
    test("delegates to AssetProperties.attachments", async () => {
        let captured;
        const cms = makeFakeCms({
            AssetProperties: {
                attachments: async id => { captured = id; return [{ name: "thumb.jpg" }]; }
            }
        });
        const result = await listAttachments(makeFakeDxm(cms), 3);
        assert.equal(captured, 3);
        assert.deepEqual(result, [{ name: "thumb.jpg" }]);
    });
});

describe("readSiteRoot", () => {
    test("delegates to AssetProperties.readSiteRoot", async () => {
        let captured;
        const cms = makeFakeCms({
            AssetProperties: {
                readSiteRoot: async id => { captured = id; return { hostname: "example.com" }; }
            }
        });
        const result = await readSiteRoot(makeFakeDxm(cms), 10);
        assert.equal(captured, 10);
        assert.deepEqual(result, { hostname: "example.com" });
    });
});

describe("setModel", () => {
    test("wraps a single id and passes through model id", async () => {
        const calls = [];
        const cms = makeFakeCms({
            AssetProperties: { setModel: async (ids, modelId) => { calls.push({ ids, modelId }); } }
        });
        await setModel(makeFakeDxm(cms), 7, 99);
        await setModel(makeFakeDxm(cms), [1, 2], 99);
        assert.deepEqual(calls[0], { ids: [7], modelId: 99 });
        assert.deepEqual(calls[1], { ids: [1, 2], modelId: 99 });
    });
});

describe("setTemplate", () => {
    test("defaults language to CSharp and developer-template flag to false", async () => {
        let captured;
        const cms = makeFakeCms({
            AssetProperties: {
                setTemplate: async (ids, templateId, isDev, lang) => { captured = { ids, templateId, isDev, lang }; }
            }
        });
        await setTemplate(makeFakeDxm(cms), 7, 42);
        assert.deepEqual(captured.ids, [7]);
        assert.equal(captured.templateId, 42);
        assert.equal(captured.isDev, false);
        assert.equal(captured.lang, cms.Util.TemplateLanguageType.CSharp);
    });

    test("honors developer-template flag and explicit language", async () => {
        let captured;
        const cms = makeFakeCms({
            AssetProperties: {
                setTemplate: async (ids, templateId, isDev, lang) => { captured = { ids, templateId, isDev, lang }; }
            }
        });
        await setTemplate(makeFakeDxm(cms), [1, 2], 0, true, 7);
        assert.deepEqual(captured.ids, [1, 2]);
        assert.equal(captured.isDev, true);
        assert.equal(captured.lang, 7);
    });
});

describe("setWorkflow", () => {
    test("wraps a single id and forwards workflow id", async () => {
        const calls = [];
        const cms = makeFakeCms({
            AssetProperties: { setWorkflow: async (ids, workflowId) => { calls.push({ ids, workflowId }); } }
        });
        await setWorkflow(makeFakeDxm(cms), 7, 5);
        await setWorkflow(makeFakeDxm(cms), [1, 2], 6);
        assert.deepEqual(calls[0], { ids: [7], workflowId: 5 });
        assert.deepEqual(calls[1], { ids: [1, 2], workflowId: 6 });
    });
});
