export type StoredPayload = {
  payload: unknown;
  receivedAt: string;
  source?: string;
};

export class LatestPayloadStore {
  private latestPayload: StoredPayload | undefined;

  public get(): StoredPayload | undefined {
    return this.latestPayload;
  }

  public set(payload: unknown, source?: string): StoredPayload {
    const storedPayload: StoredPayload = {
      payload,
      receivedAt: new Date().toISOString(),
    };

    if (source) {
      storedPayload.source = source;
    }

    this.latestPayload = storedPayload;

    return storedPayload;
  }
}
