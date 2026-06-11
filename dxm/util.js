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
        error_msg: a.error_msg
    };
}
