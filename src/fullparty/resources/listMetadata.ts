import type { FullpartyApi } from "../client.js";
import {
  resourceResponseSchema,
  type ResourceListEmbed,
  type ResourceListResponse,
} from "./schemas.js";

type ResourceApi = Pick<FullpartyApi, "getDiscordGuildResource">;
type CacheEntry = {
  expiresAt: number;
  value: Promise<ResourceListEmbed | undefined>;
};
type MetadataState = { cache: Map<string, CacheEntry>; active: number };

const states = new WeakMap<ResourceApi, MetadataState>();
const cacheTtlMs = 5 * 60_000;
const failureCacheTtlMs = 30_000;
const cacheLimit = 256;
const concurrency = 4;
const pageBudgetMs = 1_000;

export async function resolveResourceListMetadata(
  api: ResourceApi,
  guildId: string,
  result: ResourceListResponse,
): Promise<ResourceListResponse> {
  let state = states.get(api);
  if (!state) {
    state = { cache: new Map(), active: 0 };
    states.set(api, state);
  }
  const shared = state;
  const data = [...result.data];
  const controller = new AbortController();
  const expired = new Promise<void>((resolve) => {
    controller.signal.addEventListener(
      "abort",
      () => {
        resolve();
      },
      { once: true },
    );
  });
  const timeout = setTimeout(() => {
    controller.abort();
  }, pageBudgetMs);
  let nextIndex = 0;
  try {
    const workers = Promise.all(
      Array.from({ length: Math.min(concurrency, data.length) }, async () => {
        while (nextIndex < data.length && !controller.signal.aborted) {
          const index = nextIndex++;
          const item = data[index];
          // Supplied nested or flat summaries need no additional API requests.
          if (
            !item ||
            item.embed !== undefined ||
            item.embed_title !== undefined ||
            item.resource_title !== undefined
          )
            continue;
          const embed = await resourceMetadata(
            api,
            shared,
            guildId,
            item.command_name,
            item.title,
            controller.signal,
          );
          if (embed !== undefined) data[index] = { ...item, embed };
        }
      }),
    );
    // Cached requests may belong to another page. Do not let them extend this deadline.
    await Promise.race([workers, expired]);
    return { ...result, data: [...data] };
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

function resourceMetadata(
  api: ResourceApi,
  state: MetadataState,
  guildId: string,
  commandName: string,
  listedTitle: string | null | undefined,
  signal: AbortSignal,
): Promise<ResourceListEmbed | undefined> {
  const { cache } = state;
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  const key = JSON.stringify([guildId, commandName, listedTitle]);
  const cached = cache.get(key);
  if (cached) return cached.value;
  // Metadata is optional: shed excess work instead of accumulating a background queue.
  if (state.active >= concurrency || signal.aborted) return Promise.resolve(undefined);
  while (cache.size >= cacheLimit) {
    const oldest = [...cache].find(([, entry]) => entry.expiresAt !== Infinity)?.[0];
    if (oldest === undefined) return Promise.resolve(undefined);
    cache.delete(oldest);
  }
  state.active += 1;
  const entry: CacheEntry = {
    expiresAt: Infinity,
    value: fetchMetadata(api, guildId, commandName, signal).finally(() => {
      state.active -= 1;
    }),
  };
  cache.set(key, entry);
  void entry.value.then((value) => {
    // Briefly cache failures too, so an outage is not amplified by repeated browsing.
    entry.expiresAt = Date.now() + (value === undefined ? failureCacheTtlMs : cacheTtlMs);
  });
  return entry.value;
}

async function fetchMetadata(
  api: ResourceApi,
  guildId: string,
  commandName: string,
  signal: AbortSignal,
): Promise<ResourceListEmbed | undefined> {
  try {
    const result = resourceResponseSchema.safeParse(
      await api.getDiscordGuildResource(guildId, commandName, 1, 8, { signal }),
    );
    // A removed command may now return search results; do not recursively resolve them.
    if (
      !result.success ||
      result.data.data.command_name.toLowerCase() !== commandName.toLowerCase()
    )
      return undefined;
    const { embed } = result.data.data;
    return {
      title: embed.title ?? null,
      author: embed.author ? { name: embed.author.name } : null,
    };
  } catch {
    // Missing metadata should not prevent browsing or using Show.
    return undefined;
  }
}
