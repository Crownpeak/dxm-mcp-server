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
