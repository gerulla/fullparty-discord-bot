import type { Logger } from "../lib/logger.js";

export class ApplicationResources {
  private readonly resources: { name: string; close: () => void | Promise<void> }[] = [];
  private closing: Promise<void> | undefined;
  public constructor(private readonly logger: Logger) {}

  public add(name: string, close: () => void | Promise<void>): void {
    this.resources.push({ name, close });
  }

  public close(): Promise<void> {
    this.closing ??= this.closeAll();
    return this.closing;
  }

  private async closeAll(): Promise<void> {
    const errors: unknown[] = [];
    for (const resource of [...this.resources].reverse()) {
      try {
        await resource.close();
      } catch (error) {
        errors.push(error);
        this.logger.error("Unable to close application resource.", {
          resource: resource.name,
          error,
        });
      }
    }
    if (errors.length)
      throw new AggregateError(errors, "Application shutdown had failures.");
  }
}
