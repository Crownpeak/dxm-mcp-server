import { z } from "zod";
import { toolHandler } from "./util.js";

// Throw on compile failure so toolHandler flags isError:true. errorMessage may be absent
// when the helper sets isSuccessful=false purely from resultCode — fall back to the raw response.
function throwIfFailed(result) {
    if (result.isSuccessful) return;
    throw new Error(result.errorMessage ?? `Compile failed: ${JSON.stringify(result)}`);
}

export function registerWriteTools(server, dxm) {
    server.tool(
        "compile_library",
        "Compile the code in a library folder",
        { id: z.number().describe("The ID of the library folder") },
        toolHandler(async ({id}) => {
            throwIfFailed(await dxm.compileLibrary(id));
            return { content: [] };
        })
    );

    server.tool(
        "compile_project",
        "Compile the code and templates under a project folder",
        { id: z.number().describe("The ID of the project folder") },
        toolHandler(async ({id}) => {
            throwIfFailed(await dxm.compileProject(id));
            return { content: [] };
        })
    );

    server.tool(
        "compile_templates",
        "Compile the templates inside a templates folder",
        { id: z.number().describe("The ID of the templates folder") },
        toolHandler(async ({id}) => {
            throwIfFailed(await dxm.compileTemplates(id));
            return { content: [] };
        })
    );
}
