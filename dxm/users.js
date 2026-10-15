import { responseData } from "./util.js";

export async function listUsers(dxm) {
    await dxm._ensureLoggedIn();
    return responseData(await dxm._cms.User.listUsers(), "Could not list users");
}

export async function createUser(dxm, { username, firstName, lastName, emailAddress, password }) {
    await dxm._ensureLoggedIn();
    const hasPassword = !!(password && password.length > 0);
    // generateOneTimeUsePassword should be true when caller did NOT supply a password
    // (helper's UserCreateRequest.toJson has this inverted; build the body manually).
    const body = {
        userFields: {
            username,
            firstName,
            lastName,
            emailAddress,
            password: hasPassword ? password : null,
        },
        generateOneTimeUsePassword: !hasPassword,
    };
    return responseData(await dxm._cms.User.createUser(body), `Could not create user ${username}`);
}
