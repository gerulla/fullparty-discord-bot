export class ResourceAssetError extends Error {
  public constructor(
    message: string,
    public readonly code:
      | "unsafe_resource_asset"
      | "resource_asset_too_large"
      | "invalid_resource_asset",
  ) {
    super(message);
    this.name = "ResourceAssetError";
  }
}

export async function readResourceAsset(
  response: Response,
  maxBytes: number,
): Promise<Buffer> {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    await response.body?.cancel();
    throw new ResourceAssetError(
      "Resource attachment exceeds the upload limit.",
      "resource_asset_too_large",
    );
  }
  const declaredSize = Number(response.headers.get("content-length"));
  if (declaredSize > maxBytes) {
    await response.body?.cancel();
    throw new ResourceAssetError(
      "Resource attachment exceeds the upload limit.",
      "resource_asset_too_large",
    );
  }
  const reader = response.body?.getReader();
  if (!reader)
    throw new ResourceAssetError(
      "FullParty returned an empty resource attachment.",
      "invalid_resource_asset",
    );
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      const value: unknown = result.value;
      if (!(value instanceof Uint8Array)) {
        await reader.cancel();
        throw new ResourceAssetError(
          "FullParty returned invalid attachment bytes.",
          "invalid_resource_asset",
        );
      }
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new ResourceAssetError(
          "Resource attachment exceeds the upload limit.",
          "resource_asset_too_large",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!length)
    throw new ResourceAssetError(
      "FullParty returned an empty resource attachment.",
      "invalid_resource_asset",
    );
  return Buffer.concat(chunks, length);
}
