import { MessageFlags, type REST } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { createWorkshopSender, WorkshopSendError } from "../src/dev/workshopSender.js";

const ownerId = "234567890123456789";
const channelId = "345678901234567890";
const messageId = "456789012345678901";
const env = {
  NODE_ENV: "development",
  DEV_JSON_ENABLED: "true",
  PAYLOAD_COMMAND_ALLOWED_USER_ID: ownerId,
  DISCORD_TOKEN: "private-development-token",
};

function fakeRest() {
  return {
    post: vi
      .fn<REST["post"]>()
      .mockResolvedValueOnce({ id: channelId })
      .mockResolvedValue({ id: messageId }),
  };
}

function asset(name = "header.png", bytes = Buffer.from("example")) {
  return { name, dataUrl: `data:image/png;base64,${bytes.toString("base64")}` };
}

function uploadedDraft() {
  return {
    message: {
      embeds: [{ image: { url: "attachment://header.png" } }],
      files: [{ name: "header.png", attachment: "attachment://header.png" }],
    },
    assets: [asset()],
  };
}

describe("local workshop Discord sender", () => {
  it.each([
    { name: "production", override: { NODE_ENV: "production" } },
    { name: "test", override: { NODE_ENV: "test" } },
    { name: "invalid environment", override: { NODE_ENV: "Development" } },
    { name: "preview disabled", override: { DEV_JSON_ENABLED: "false" } },
    { name: "preview flag omitted", override: { DEV_JSON_ENABLED: undefined } },
    { name: "truthy preview flag", override: { DEV_JSON_ENABLED: "1" } },
    { name: "owner omitted", override: { PAYLOAD_COMMAND_ALLOWED_USER_ID: undefined } },
    { name: "invalid owner", override: { PAYLOAD_COMMAND_ALLOWED_USER_ID: "owner" } },
    {
      name: "overflow owner",
      override: { PAYLOAD_COMMAND_ALLOWED_USER_ID: "99999999999999999999" },
    },
    { name: "token omitted", override: { DISCORD_TOKEN: undefined } },
    { name: "blank token", override: { DISCORD_TOKEN: "  " } },
  ])("disables sends for $name without contacting Discord", async ({ override }) => {
    const rest = fakeRest();
    const sender = createWorkshopSender({ env: { ...env, ...override }, rest });
    expect(sender.status()).toMatchObject({
      enabled: false,
      reason: expect.any(String) as string,
    });
    expect(JSON.stringify(sender.status())).not.toContain(env.DISCORD_TOKEN);
    await expect(sender.send({ message: { content: "Hello" } })).rejects.toMatchObject({
      name: "WorkshopSendError",
      status: 503,
    });
    expect(rest.post).not.toHaveBeenCalled();
  });

  it("uses the default development environment, fixed owner, and sanitized V1 message", async () => {
    const rest = fakeRest();
    const sender = createWorkshopSender({ env: { ...env, NODE_ENV: undefined }, rest });
    expect(sender.status()).toEqual({ enabled: true });
    await expect(
      sender.send({
        discord_user_id: "other-user",
        channel_id: "other-channel",
        message: {
          content: "@everyone <@123>",
          embeds: [{ title: "Preview" }],
          channel_id: "other-channel",
          flags: MessageFlags.Ephemeral,
          allowed_mentions: { parse: ["everyone", "users"] },
        },
      }),
    ).resolves.toEqual({ messageId });
    expect(rest.post).toHaveBeenNthCalledWith(1, "/users/@me/channels", {
      body: { recipient_id: ownerId },
    });
    expect(rest.post).toHaveBeenNthCalledWith(2, `/channels/${channelId}/messages`, {
      body: {
        content: "@everyone <@123>",
        embeds: [{ title: "Preview" }],
        flags: 0,
        allowed_mentions: { parse: [], replied_user: false },
      },
    });
    expect(rest.post).toHaveBeenCalledTimes(2);
  });

  it("uploads V2 gallery data as Buffer files, sanitizes names, and isolates controls", async () => {
    const rest = fakeRest();
    const sender = createWorkshopSender({ env, rest });
    const draft = {
      message: {
        components: [
          {
            type: 17,
            components: [
              {
                type: 12,
                items: [
                  { media: { url: "attachment://my header.png" }, description: "" },
                ],
              },
              {
                type: 1,
                components: [
                  { type: 2, style: 1, custom_id: "setup:dangerous", label: "Enable" },
                ],
              },
            ],
          },
        ],
        files: [
          {
            name: "my header.png",
            attachment: "attachment://my header.png",
            description: "Header",
            spoiler: true,
          },
        ],
      },
      assets: [asset("my header.png")],
    };
    const original = JSON.stringify(draft);
    await sender.send(draft);
    expect(JSON.stringify(draft)).toBe(original);
    const request = rest.post.mock.calls[1]?.[1];
    expect(request).toMatchObject({
      body: {
        flags: MessageFlags.IsComponentsV2,
        allowed_mentions: { parse: [], replied_user: false },
        attachments: [
          { id: 0, filename: "SPOILER_my_header.png", description: "Header" },
        ],
      },
      files: [
        {
          data: Buffer.from("example"),
          name: "SPOILER_my_header.png",
          contentType: "image/png",
        },
      ],
    });
    expect(JSON.stringify(request?.body)).toContain("attachment://SPOILER_my_header.png");
    expect(JSON.stringify(request?.body)).toContain("json-preview:");
    expect(JSON.stringify(request?.body)).not.toContain("setup:dangerous");
    expect(JSON.stringify(request?.body)).not.toContain('"description":""');
    expect(request?.body).not.toHaveProperty("files");
  });

  it("uploads referenced assets without message.files and ignores unused asset library entries", async () => {
    const rest = fakeRest();
    await createWorkshopSender({ env, rest }).send({
      message: { embeds: [{ image: { url: "attachment://header.png" } }] },
      assets: [asset(), asset("unused.png")],
    });
    expect(rest.post.mock.calls[1]?.[1]?.files).toHaveLength(1);
  });

  it("supports file-only V1 messages and preserves attachment descriptions", async () => {
    const rest = fakeRest();
    await createWorkshopSender({ env, rest }).send({
      message: {
        files: [
          {
            name: "note.txt",
            attachment: "attachment://note.txt",
            description: "A note",
          },
        ],
      },
      assets: [{ name: "note.txt", dataUrl: "data:;base64,aGVsbG8=" }],
    });
    expect(rest.post.mock.calls[1]?.[1]).toMatchObject({
      body: {
        flags: 0,
        attachments: [{ id: 0, filename: "note.txt", description: "A note" }],
      },
      files: [
        {
          data: Buffer.from("hello"),
          name: "note.txt",
          contentType: "application/octet-stream",
        },
      ],
    });
  });

  it.each([
    { name: "missing message", draft: {} },
    { name: "empty message", draft: { message: {} } },
    {
      name: "mixed V1/V2",
      draft: { message: { content: "Old", components: [{ type: 10, content: "New" }] } },
    },
    {
      name: "local file path",
      draft: { message: { files: [{ attachment: "C:/secret.txt" }] } },
    },
    {
      name: "remote file URL",
      draft: { message: { files: [{ attachment: "http://127.0.0.1/private" }] } },
    },
    {
      name: "missing referenced asset",
      draft: { message: { embeds: [{ image: { url: "attachment://missing.png" } }] } },
    },
    {
      name: "existing attachments",
      draft: {
        message: { content: "Hi", attachments: [{ id: "123", filename: "missing.png" }] },
      },
    },
    {
      name: "duplicate assets",
      draft: { ...uploadedDraft(), assets: [asset(), asset()] },
    },
    {
      name: "duplicate files",
      draft: {
        ...uploadedDraft(),
        message: {
          files: [
            { attachment: "attachment://header.png" },
            { attachment: "attachment://header.png" },
          ],
        },
      },
    },
    {
      name: "filename traversal",
      draft: { message: { content: "Hi" }, assets: [asset("../private.png")] },
    },
    {
      name: "Windows filename path",
      draft: { message: { content: "Hi" }, assets: [asset("C:\\private.png")] },
    },
    {
      name: "non-base64 asset",
      draft: {
        ...uploadedDraft(),
        assets: [{ name: "header.png", dataUrl: "file:///private" }],
      },
    },
    {
      name: "invalid base64",
      draft: {
        ...uploadedDraft(),
        assets: [{ name: "header.png", dataUrl: "data:image/png;base64,aGVsbG8*" }],
      },
    },
    {
      name: "noncanonical base64",
      draft: {
        ...uploadedDraft(),
        assets: [{ name: "header.png", dataUrl: "data:image/png;base64,aGVsbG9=" }],
      },
    },
    {
      name: "11 assets",
      draft: {
        message: { content: "Hi" },
        assets: Array.from({ length: 11 }, (_, index) => asset(`${String(index)}.png`)),
      },
    },
  ])("rejects $name before contacting Discord", async ({ draft }) => {
    const rest = fakeRest();
    await expect(createWorkshopSender({ env, rest }).send(draft)).rejects.toMatchObject({
      name: "WorkshopSendError",
      status: 400,
    });
    expect(rest.post).not.toHaveBeenCalled();
  });

  it("rejects filename collisions introduced by sanitation", async () => {
    const rest = fakeRest();
    await expect(
      createWorkshopSender({ env, rest }).send({
        message: {
          files: [
            { attachment: "attachment://a b.png" },
            { attachment: "attachment://a?b.png" },
          ],
        },
        assets: [asset("a b.png"), asset("a?b.png")],
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(rest.post).not.toHaveBeenCalled();
  });

  it("enforces the decoded 8 MiB total without trusting declared asset sizes", async () => {
    const rest = fakeRest();
    const large = Buffer.alloc(4 * 1024 * 1024 + 1);
    await expect(
      createWorkshopSender({ env, rest }).send({
        message: {
          files: [
            { attachment: "attachment://a.png" },
            { attachment: "attachment://b.png" },
          ],
        },
        assets: [
          { ...asset("a.png", large), size: 1 },
          { ...asset("b.png", large), size: 1 },
        ],
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("8 MiB") as string,
    });
    expect(rest.post).not.toHaveBeenCalled();
  });

  it.each([
    { status: 401, code: 50014, expected: 503 },
    { status: 403, code: 50007, expected: 403 },
    { status: 400, code: 50035, expected: 400 },
    { status: 429, code: 0, expected: 429 },
    { status: 500, code: 0, expected: 502 },
  ])(
    "maps Discord status $status to a safe $expected error",
    async ({ status, code, expected }) => {
      const rest = fakeRest();
      rest.post.mockReset().mockRejectedValue(
        Object.assign(new Error(`secret ${env.DISCORD_TOKEN} payload`), {
          status,
          code,
        }),
      );
      const error = await createWorkshopSender({ env, rest })
        .send({ message: { content: "Hi" } })
        .catch((value: unknown) => value);
      expect(error).toBeInstanceOf(WorkshopSendError);
      expect(error).toMatchObject({ status: expected });
      expect(String(error)).not.toContain(env.DISCORD_TOKEN);
      expect(JSON.stringify(error)).not.toContain(env.DISCORD_TOKEN);
    },
  );

  it("reports bounded Discord field diagnostics without raw request data or tokens", async () => {
    const rest = fakeRest();
    rest.post.mockReset().mockRejectedValue({
      status: 400,
      code: 50035,
      message: "Unsafe generic error text",
      requestBody: { files: [env.DISCORD_TOKEN], json: { content: "private draft" } },
      rawError: {
        errors: {
          components: {
            0: {
              components: {
                1: {
                  content: {
                    _errors: [
                      {
                        code: "BASE_TYPE_BAD_LENGTH",
                        message: "Must be between 1 and 4000 in length.",
                      },
                      {
                        code: "INVALID_FORM",
                        message: `${env.DISCORD_TOKEN}\n${"x".repeat(2000)}`,
                      },
                    ],
                  },
                },
              },
            },
          },
          embeds: {
            _errors: Array.from({ length: 20 }, () => ({
              code: "INVALID_FORM",
              message: "Too many embeds.",
            })),
          },
        },
      },
    });
    const error = await createWorkshopSender({ env, rest })
      .send({ message: { content: "Hi" } })
      .catch((value: unknown) => value);
    if (!(error instanceof WorkshopSendError)) throw new Error("Expected workshop error");
    expect(error.status).toBe(400);
    expect(error.message).toContain(
      "components[0].components[1].content [BASE_TYPE_BAD_LENGTH]: Must be between 1 and 4000 in length.",
    );
    expect(error.message).toContain("[redacted]");
    expect(error.message).not.toContain(env.DISCORD_TOKEN);
    expect(error.message).not.toContain("private draft");
    expect(error.message).not.toContain("Unsafe generic error text");
    expect(error.message.split("\n")).toHaveLength(7);
    expect(error.message.length).toBeLessThanOrEqual(1700);
  });

  it("allows only one in-flight send and recovers after a failed request", async () => {
    let rejectRequest: (reason: Error) => void = () => undefined;
    const rest = {
      post: vi.fn<REST["post"]>().mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          rejectRequest = reject;
        }),
      ),
    };
    const sender = createWorkshopSender({ env, rest });
    const first = sender.send({ message: { content: "First" } });
    await expect(sender.send({ message: { content: "Second" } })).rejects.toMatchObject({
      status: 429,
    });
    expect(rest.post).toHaveBeenCalledTimes(1);
    rejectRequest(new Error(`Network failure ${env.DISCORD_TOKEN}`));
    await expect(first).rejects.toMatchObject({ status: 502 });
    rest.post
      .mockResolvedValueOnce({ id: channelId })
      .mockResolvedValueOnce({ id: messageId });
    await expect(sender.send({ message: { content: "Third" } })).resolves.toEqual({
      messageId,
    });
  });

  it("does not claim success when Discord omits a message ID", async () => {
    const rest = fakeRest();
    rest.post
      .mockReset()
      .mockResolvedValueOnce({ id: channelId })
      .mockResolvedValueOnce({});
    await expect(
      createWorkshopSender({ env, rest }).send({ message: { content: "Hi" } }),
    ).rejects.toMatchObject({ status: 502 });
  });
});
