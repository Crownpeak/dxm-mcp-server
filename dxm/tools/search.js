import { z } from "zod";
import { toolHandler, jsonText } from "./util.js";
import {
    SEARCH_SORT, SEARCH_MAX_PAGE_SIZE, SEARCH_OPERATIONS, SEARCH_FIELDS,
    ADVANCED_SEARCH_DEFAULT_LIMIT, ADVANCED_SEARCH_MAX_LIMIT, ADVANCED_SEARCH_MAX_FILTERS, ADVANCED_SEARCH_MAX_SET_VALUES
} from "../search.js";

// Generated from the same table the filters are validated against, so the text a model reads
// can't disagree with what the tool accepts.
const BUILT_IN_FIELDS = SEARCH_FIELDS.map(f => f.property).join(", ");

const PAGING = {
    page: z.number().int().min(1).optional().describe("Page number, starting at 1 (default 1)"),
    page_size: z.number().int().min(1).max(SEARCH_MAX_PAGE_SIZE).optional().describe(`Results per page (default 50, at most ${SEARCH_MAX_PAGE_SIZE})`)
};

const RESULT_SHAPE =
    "Results are { id, label, type, fullPath, status, folder_id, branchId, error_msg } records, as find_asset returns. " +
    "Use read_full_asset on one for everything the CMS holds.";

export function registerReadTools(server, dxm) {
    server.tool(
        "search",
        "Search DXM assets by text in their label (name), across the whole instance. This is the quick search: use advanced_search to filter " +
        "on anything else (type, status, template, dates, users, custom field values) or to combine conditions. Matches labels containing " +
        "the text. Set include_content to also match text inside field content, which is several times slower. Returns { page, pageSize, count, " +
        "mayHaveMore, results }, 50 per page by default: the CMS gives no overall total, so a full page (mayHaveMore) means ask for the next. " +
        "Results are unsorted unless sort is given. " + RESULT_SHAPE,
        {
            query: z.string().min(1).describe("Text to look for in asset labels"),
            ...PAGING,
            sort: z.enum(Object.keys(SEARCH_SORT)).optional().describe("Sort by this: " + Object.keys(SEARCH_SORT).join(", ")),
            descending: z.boolean().optional().describe("Sort descending (e.g. newest first for created or changed) instead of ascending"),
            include_content: z.boolean().optional().describe("Also search text inside field content (slower)")
        },
        toolHandler(async args => jsonText(await dxm.search({
            query: args.query, page: args.page, pageSize: args.page_size,
            sort: args.sort, descending: args.descending, includeContent: args.include_content
        })))
    );

    server.tool(
        "search_fields",
        "List what advanced_search can filter on: the built-in fields (each with its type and the operators it accepts) and this instance's custom " +
        "fields, the ones defined by templates and components such as class_name or body. Each custom field has isList: true when it is multi-valued " +
        "(a field inside a panel can hold several values). Custom field names are fixed per instance. Pass search " +
        "to see only the names containing some text; the full custom list is around a hundred names on a typical instance.",
        { search: z.string().optional().describe("Only fields whose name contains this text (case-insensitive)") },
        toolHandler(async ({ search }) => jsonText(await dxm.searchFields({ search })))
    );

    server.tool(
        "advanced_search",
        "Search DXM assets with conditions on their properties and field values, across the whole instance or inside one folder. Give filters: " +
        "each is { field, operation, value, logical }. All filters must hold (And) unless logical is \"Or\"; logical joins a filter to the NEXT one, " +
        "so it is ignored on the last. Mixed And and Or follow the usual precedence (And binds tighter), and there are no brackets. " +
        `Built-in fields: ${BUILT_IN_FIELDS}. Any other field name is a custom field (use search_fields to find names); write [Label] to force the ` +
        "built-in when a custom field has the same name. Operations: " + SEARCH_OPERATIONS.join(", ") + ". " +
        "Which operations a field takes depends on its type, and a wrong one is an error saying what is allowed: text fields (Label, custom fields) take " +
        "Contains, StartsWith, EndsWith, Equals, NotEquals, IsNull, NotNull (Label also NotContains); numbers (Id, FolderId, Size...) and dates " +
        "(CreateDate...) take GreaterThan, GreaterOrEquals, LessThan, LessOrEquals, Equals, NotEquals (dates also IsNull, NotNull, e.g. PublishDate IsNull " +
        "for never published); fields that hold an id (Type, Status, Workflow, TemplateName, Model, CreatedBy...) take Equals, NotEquals (user and Model " +
        "fields also IsNull, NotNull, e.g. CheckedOutBy IsNull for assets nobody has checked out; 0 means none for Status, Workflow and TemplateName). " +
        "Values: dates as YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ; id fields take the id (Type also takes a name, File or Folder; get user ids from list_users, " +
        "workflow ids from list_workflows, template ids from read_full_asset); IsNull and NotNull take no value. Custom fields are matched as text. " +
        `To match several values in one filter pass a list as value: Equals with a list matches any of them (e.g. TemplateName Equals [123, 456, 789]), NotEquals matches none of them, ` +
        `up to ${ADVANCED_SEARCH_MAX_SET_VALUES} values. A list on Equals can't be combined with Or between filters. ` +
        "Examples: label starts with test: [{field:\"Label\",operation:\"StartsWith\",value:\"test\"}]; folders created after a date: " +
        "[{field:\"Type\",operation:\"Equals\",value:\"Folder\"},{field:\"CreateDate\",operation:\"GreaterThan\",value:\"2025-01-01\"}]. " +
        "Returns { total, limit, limitReached, page, pageSize, results }. total counts matches only up to limit (default " +
        `${ADVANCED_SEARCH_DEFAULT_LIMIT}); if limitReached is true there are at least that many, so narrow the search. Results come in no ` +
        "particular order. Use light for a much smaller record per asset (id, label, type, fullPath, folder_id, statusId, workflow_id). " +
        RESULT_SHAPE,
        {
            filters: z.array(z.object({
                field: z.string().describe("A built-in field (e.g. Label, Type, CreateDate) or a custom field name"),
                operation: z.enum(SEARCH_OPERATIONS).describe("How to compare the field with the value"),
                value: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()])).min(1).max(ADVANCED_SEARCH_MAX_SET_VALUES)]).optional()
                    .describe("What to compare with; a list of values for Equals (any of them) or NotEquals (none of them); omit for IsNull and NotNull"),
                logical: z.enum(["And", "Or"]).optional().describe("How this filter joins the NEXT one (default And); ignored on the last filter")
            })).min(1).max(ADVANCED_SEARCH_MAX_FILTERS).describe("The conditions"),
            base_asset_id: z.number().int().min(0).optional().describe("Only search inside this folder and everything below it (a numeric folder id; find_asset resolves a path)"),
            ...PAGING,
            limit: z.number().int().min(1).max(ADVANCED_SEARCH_MAX_LIMIT).optional()
                .describe(`Most matches the CMS will count, which also caps total (default ${ADVANCED_SEARCH_DEFAULT_LIMIT}, at most ${ADVANCED_SEARCH_MAX_LIMIT}); big ones take seconds`),
            light: z.boolean().optional().describe("Return the small record per asset instead of the full find_asset-style one")
        },
        toolHandler(async args => jsonText(await dxm.advancedSearch({
            filters: args.filters, baseAssetId: args.base_asset_id, page: args.page, pageSize: args.page_size,
            limit: args.limit, light: args.light
        })))
    );
}
