export class CommandError extends Error {
  public constructor(
    public readonly publicMessage: string,
    public readonly code: string,
    public readonly affectsHealth = false,
    options?: ErrorOptions,
  ) {
    super(publicMessage, options);
    this.name = "CommandError";
  }
}
