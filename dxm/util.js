// Fields the helper's makeCall puts on every JSON response, around the endpoint's own data.
// `cookie` is the dangerous one: it is the session's live cookies, and anything returned from a
// tool goes straight into an LLM context.
const ENVELOPE_FIELDS = new Set(["cookie", "resultCode", "errorMessage", "internalCode", "responseValues", "isSuccessful"]);

// The data part of a helper response, for a domain function that returns an endpoint's payload
// as-is. Drops the envelope (above all the session cookies), and throws when the CMS reported a
// failure - the helper doesn't throw, so before this a failed call came back looking like data
// (e.g. get_workflow on an unknown id returned `workflow: null` with resultCode conWS_NotFound).
// `context` prefixes the error message. Only an explicit isSuccessful: false counts as failure.
export function responseData(response, context) {
    if (response?.isSuccessful === false) {
        const detail = response.errorMessage || `the CMS returned ${response.resultCode}`;
        throw new Error(context ? `${context}: ${detail}` : detail);
    }
    return Object.fromEntries(Object.entries(response ?? {}).filter(([k]) => !ENVELOPE_FIELDS.has(k)));
}

export function mapAsset(cms, a) {
    const assetTypeNames = Object.fromEntries(
        Object.entries(cms.Util.AssetType).map(([k, v]) => [v, k])
    );
    return {
        id: a.id,
        label: a.label,
        type: assetTypeNames[a.type] ?? a.type,
        fullPath: a.fullPath,
        status: a.statusName,
        folder_id: a.folder_id,
        // The id of the master asset of this asset's branch family: a master's branchId is its own
        // id, and each branch's points at its master. -2 means the asset is in no branch family
        // (files and folders alike). Passed through as-is; camelCase because that is how
        // Asset.read, Asset.paged and the publishing-errors report all spell it on the wire.
        branchId: a.branchId,
        error_msg: a.error_msg
    };
}
