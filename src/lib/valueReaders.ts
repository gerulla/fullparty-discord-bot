export function getLooseNumber(value: unknown, key: string): number {
  if (!isRecord(value)) {
    return 0;
  }

  const fieldValue = value[key];

  return typeof fieldValue === "number" && Number.isFinite(fieldValue) ? fieldValue : 0;
}

export function getStringProperty(
  value: Record<string, unknown>,
  property: string,
): string | undefined {
  const propertyValue = value[property];

  return typeof propertyValue === "string" && propertyValue.trim().length > 0
    ? propertyValue
    : undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function hasOwn<TObject extends object, TKey extends PropertyKey>(
  value: TObject,
  key: TKey,
): value is TObject & Record<TKey, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key);
}
