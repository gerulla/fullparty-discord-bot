import { randomBytes } from "node:crypto";

type ResourceSession = {
  guildId: string;
  requesterId: string;
  query: string | null;
  expiresAt: number;
};

export class ResourcePaginationStore {
  private readonly sessions = new Map<string, ResourceSession>();

  public constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = 15 * 60_000,
    private readonly capacity = 1_000,
  ) {}

  public create(guildId: string, requesterId: string, query: string | null): string {
    this.prune();
    while (this.sessions.size >= this.capacity) {
      const oldest = this.sessions.keys().next().value;
      if (!oldest) break;
      this.sessions.delete(oldest);
    }
    const id = randomBytes(12).toString("hex");
    this.sessions.set(id, {
      guildId,
      requesterId,
      query,
      expiresAt: this.now() + this.ttlMs,
    });
    return id;
  }

  public get(id: string): Readonly<ResourceSession> | undefined {
    this.prune();
    return this.sessions.get(id);
  }

  private prune(): void {
    const now = this.now();
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(id);
    }
  }
}

export function parseResourcePageControl(
  customId: string,
): { sessionId: string; page: number } | undefined {
  const match = /^info:(?:previous|next):([a-f0-9]{24}):([1-9]\d*)$/u.exec(customId);
  if (!match?.[1] || !match[2]) return;
  const page = Number(match[2]);
  if (!Number.isSafeInteger(page)) return;
  return { sessionId: match[1], page };
}
