type DefinedProperties<T> = T extends (infer Item)[]
  ? DefinedProperties<Item>[]
  : T extends object
    ? { [Key in keyof T]: DefinedProperties<Exclude<T[Key], undefined>> }
    : T;

// Zod represents absent optional keys as possibly undefined; Discord requires them omitted.
export function omitUndefined<T>(value: T): DefinedProperties<T> {
  const result: unknown = Array.isArray(value)
    ? value.map((entry: unknown) => omitUndefined(entry))
    : typeof value === "object" && value !== null
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([, entry]) => entry !== undefined)
            .map(([key, entry]) => [key, omitUndefined(entry)]),
        )
      : value;
  return result as DefinedProperties<T>;
}
