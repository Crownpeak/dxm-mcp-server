import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { listUsers, createUser } from "../dxm/users.js";
import { makeFakeCms, makeFakeDxm } from "./_helpers.js";

describe("listUsers", () => {
    test("delegates to User.listUsers", async () => {
        const expected = [{ id: 1, username: "alice" }];
        const cms = makeFakeCms({
            User: { listUsers: async () => expected }
        });
        const result = await listUsers(makeFakeDxm(cms));
        assert.equal(result, expected);
    });
});

describe("createUser", () => {
    function recordingCms() {
        let body;
        return {
            get body() { return body; },
            cms: makeFakeCms({
                User: { createUser: async b => { body = b; return { id: 99 }; } }
            })
        };
    }

    test("when a password is supplied: forwards it and sets generateOneTimeUsePassword=false", async () => {
        // The helper's UserCreateRequest.toJson() inverts this flag (documented gotcha);
        // the wrapper builds the body manually so generateOneTimeUsePassword tracks "no password supplied".
        const r = recordingCms();
        await createUser(makeFakeDxm(r.cms), {
            username: "alice", firstName: "Alice", lastName: "A",
            emailAddress: "a@x.com", password: "secret"
        });
        assert.deepEqual(r.body, {
            userFields: {
                username: "alice", firstName: "Alice", lastName: "A",
                emailAddress: "a@x.com", password: "secret"
            },
            generateOneTimeUsePassword: false
        });
    });

    test("when no password is supplied: nulls the password field and sets generateOneTimeUsePassword=true", async () => {
        const r = recordingCms();
        await createUser(makeFakeDxm(r.cms), {
            username: "bob", firstName: "Bob", lastName: "B", emailAddress: "b@x.com"
        });
        assert.equal(r.body.userFields.password, null);
        assert.equal(r.body.generateOneTimeUsePassword, true);
    });

    test("treats an empty-string password as no password (the helper API doesn't accept empty passwords)", async () => {
        const r = recordingCms();
        await createUser(makeFakeDxm(r.cms), {
            username: "c", firstName: "C", lastName: "C", emailAddress: "c@x.com", password: ""
        });
        assert.equal(r.body.userFields.password, null);
        assert.equal(r.body.generateOneTimeUsePassword, true);
    });
});
