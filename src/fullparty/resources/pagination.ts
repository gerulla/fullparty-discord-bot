import { randomBytes } from "node:crypto";

type ResourceSession = {
  guildId: string;
  requesterId: string;
  query: string | null;
  expiresAt: number;
  currentPage?: number;
  commandNames?: readonly string[];
  posting?: boolean;
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

  public setPage(id: string, page: number, commandNames: readonly string[]): void {
    this.prune();
    const session = this.sessions.get(id);
    if (!session) return;
    session.currentPage = page;
    session.commandNames = [...commandNames];
  }

  public beginPost(id: string): boolean {
    this.prune();
    const session = this.sessions.get(id);
    if (!session || session.posting) return false;
    session.posting = true;
    return true;
  }

  public releasePost(id: string): void {
    const session = this.sessions.get(id);
    if (session) session.posting = false;
  }

  public delete(id: string): void {
    this.sessions.delete(id);
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

export function parseResourceShowControl(
  customId: string,
): { sessionId: string; page: number; index: number } | undefined {
  const match = /^info:show:([a-f0-9]{24}):([1-9]\d*):(0|[1-9]\d*)$/u.exec(customId);
  if (!match?.[1] || !match[2] || !match[3]) return;
  const page = Number(match[2]);
  const index = Number(match[3]);
  if (!Number.isSafeInteger(page) || !Number.isSafeInteger(index)) return;
  return { sessionId: match[1], page, index };
}
