import { z } from "zod";
import { toolHandler, jsonText } from "./util.js";
import { AUDIT_MAX_PAGE_SIZE } from "../report.js";

// Filters shared by audit_report and custom_audit_report.
const AUDIT_FILTERS = {
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Earliest day to include, as YYYY-MM-DD"),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Last day to include, as YYYY-MM-DD (the whole day is included)"),
    user_id: z.number().int().optional().describe("Only entries by this user id (list_users gives ids)"),
    asset_id: z.number().int().optional().describe("Only entries about this asset id"),
    label: z.string().optional().describe("Only entries whose asset label matches"),
    search: z.string().optional().describe("Only entries whose description contains this text"),
    page: z.number().int().min(1).optional().describe("Page number, starting at 1 (default 1)"),
    page_size: z.number().int().min(1).max(AUDIT_MAX_PAGE_SIZE).optional().describe(`Entries per page (default 50, at most ${AUDIT_MAX_PAGE_SIZE})`),
    oldest_first: z.boolean().optional().describe("Sort oldest first instead of newest first")
};

const auditArgs = a => ({
    startDate: a.start_date, endDate: a.end_date, userId: a.user_id, assetId: a.asset_id,
    label: a.label, search: a.search, page: a.page, pageSize: a.page_size, oldestFirst: a.oldest_first
});

const AUDIT_RESULT =
    "Returns { total, page, pageSize, entries }; each entry has date, action (its name) and actionId, description, user, userId, assetId, " +
    "label, folderId and assetType (a name, e.g. File) (assetId/folderId are null for entries about no asset, such as logins). Without dates it covers all history, which can be millions of " +
    "entries, so narrow it with dates or filters and page through. Note: the CMS records every call to this report in the audit log itself, " +
    "as \"Audited System\".";

export function registerReadTools(server, dxm) {
    server.tool(
        "publishing_errors",
        "Get a report of any recent publishing errors",
        {},
        toolHandler(async () => jsonText(await dxm.publishingErrors()))
    );

    server.tool(
        "site_summary",
        "Get a summary report of the DXM instance",
        {},
        toolHandler(async () => jsonText(await dxm.siteSummary()))
    );

    server.tool(
        "audit_report",
        "Read the DXM system audit log: who did what and when (logins and failed logins, edits, creates, moves, renames, deletes, routes and " +
        "workflow commands, publishes, configuration changes...), newest first. Covers every action except Custom entries (log_message and " +
        "Util.Log in template code), which custom_audit_report returns. Pass action, by name or id, for one kind of action, e.g. \"Logged In\" (16), " +
        "\"Login Failed\" (138), \"Edited\" (15), \"Created\" (52), \"Renamed\" (24), \"Moved\" (29), \"Deleted File\" (25), \"Route\" (5), " +
        "\"Workflow command\" (3), \"Publish - start\" (19). A name matches case-insensitively, also as a unique part of a name; an unknown or " +
        "ambiguous one is an error listing the candidates. When filtered, the result also has action: { id, name }. " + AUDIT_RESULT,
        {
            action: z.union([z.number().int().min(0), z.string()]).optional()
                .describe("Only this kind of action, by name (e.g. \"Login Failed\") or id (e.g. 138). Omit, or 0, for all except Custom"),
            ...AUDIT_FILTERS
        },
        toolHandler(async args => jsonText(await dxm.auditReport({ action: args.action, ...auditArgs(args) })))
    );

    server.tool(
        "custom_audit_report",
        "Read the Custom entries of the DXM audit log (action 100): messages written by the log_message tool and by Util.Log in template " +
        "or library code, e.g. debugging points or integration traces, with the asset each was logged against. audit_report never includes " +
        "these. " + AUDIT_RESULT,
        { ...AUDIT_FILTERS },
        toolHandler(async args => jsonText(await dxm.customAuditReport(auditArgs(args))))
    );
}
