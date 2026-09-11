import { EmbedBuilder } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { FullpartyApiClient } from "../src/fullparty/client.js";
import { readResourceAsset } from "../src/fullparty/resources/assetDownload.js";
import { createResourceMessage } from "../src/fullparty/resources/messages.js";
import {
  resourceResponseSchema,
  type ResourceAsset,
  type ResourceData,
} from "../src/fullparty/resources/schemas.js";
import { GuildResourceService } from "../src/fullparty/resources/service.js";
import { fetchUrl } from "./helpers/http.js";

const asset: ResourceAsset = {
  id: "asset-id",
  filename: "asset-id.png",
  mime_type: "image/png",
  url: "https://fullparty.gg/api/integrations/discord-guilds/123/resource-commands/bridges/assets/asset-id",
};
function resource(): ResourceData {
  return resourceResponseSchema.parse({
    found: true,
    data: {
      command_name: "bridges",
      embed: {
        title: "Bridge positions",
        image: { url: "attachment://asset-id.png" },
        thumbnail: { url: "https://external.example/thumbnail.webp" },
        author: { name: "Team", icon_url: null, url: null },
        fields: [{ name: "West", value: "Party A", inline: null }],
        footer: { text: "FullParty" },
      },
      assets: [asset],
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 5,
              label: "Open Resource",
              url: "https://resources.fullparty.gg/example/bridges",
            },
          ],
        },
      ],
    },
  }).data;
}

describe("resource attachments and components", () => {
  it("downloads only declared API assets with authentication and preserves their filenames", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const fetcher = vi.fn<typeof fetch>((url, init) => {
      expect(fetchUrl(url)).toBe(asset.url);
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("error");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer secret-test-token",
      );
      return Promise.resolve(
        new Response(bytes, { headers: { "content-type": "image/png" } }),
      );
    });
    const service = new GuildResourceService(
      new FullpartyApiClient({
        baseUrl: "https://fullparty.gg/api",
        apiToken: "secret-test-token",
        fetcher,
      }),
    );
    const data = resource();
    const files = await service.downloadAssets("123", data, 1024);
    expect(files).toEqual([{ attachment: Buffer.from(bytes), name: "asset-id.png" }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const message = createResourceMessage(data);
    const embed = message.embeds?.[0];
    if (!(embed instanceof EmbedBuilder)) throw new Error("Expected embed");
    expect(embed.toJSON()).toMatchObject({
      image: { url: "attachment://asset-id.png" },
      thumbnail: { url: "https://external.example/thumbnail.webp" },
      author: { name: "Team" },
      fields: [{ name: "West", value: "Party A" }],
    });
    expect(JSON.stringify(message.components)).toBe(JSON.stringify(data.components));
  });

  it.each([
    "https://external.example/asset.png",
    "https://fullparty.gg/api/other-endpoint",
    "https://fullparty.gg/api/integrations/discord-guilds/other-guild/resource-commands/bridges/assets/asset-id",
    "https://fullparty.gg/api/integrations/discord-guilds/123/resource-commands/other-resource/assets/asset-id",
  ])("never sends credentials to an unexpected asset URL: %s", async (url) => {
    const fetcher = vi.fn<typeof fetch>();
    const service = new GuildResourceService(
      new FullpartyApiClient({
        baseUrl: "https://fullparty.gg/api",
        apiToken: "secret-test-token",
        fetcher,
      }),
    );
    const data = resource();
    data.assets = [{ ...asset, url }];
    await expect(service.downloadAssets("123", data, 1024)).rejects.toMatchObject({
      code: "unsafe_resource_asset",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects missing and duplicate attachments before making requests", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const service = new GuildResourceService(
      new FullpartyApiClient({ baseUrl: "https://fullparty.gg/api", fetcher }),
    );
    const data = resource();
    data.assets = [];
    await expect(service.downloadAssets("123", data, 1024)).rejects.toMatchObject({
      code: "invalid_resource_response",
    });
    data.assets = [asset, asset];
    await expect(service.downloadAssets("123", data, 1024)).rejects.toMatchObject({
      code: "invalid_resource_response",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("bounds downloaded bytes even without Content-Length", async () => {
    await expect(
      readResourceAsset(new Response(new Uint8Array(20)), 10),
    ).rejects.toMatchObject({ code: "resource_asset_too_large" });
    await expect(
      readResourceAsset(
        new Response(new Uint8Array(4), { headers: { "content-length": "500" } }),
        10,
      ),
    ).rejects.toMatchObject({ code: "resource_asset_too_large" });
  });

  it("accepts HTTP images without attachments or authentication requests", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const service = new GuildResourceService(
      new FullpartyApiClient({ baseUrl: "https://fullparty.gg/api", fetcher }),
    );
    const data = resource();
    data.embed.image = { url: "https://external.example/image.png" };
    data.assets = [];
    data.components = [];
    await expect(service.downloadAssets("123", data, 1024)).resolves.toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(createResourceMessage(data).components).toEqual([]);
  });
});
