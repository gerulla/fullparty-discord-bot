import {
  ApplicationIntegrationType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
} from "discord.js";
import type { BotContext } from "../bot/context.js";
import { captureFullpartyCommandPayload } from "../fullparty/commandPayloadCapture.js";
import { createResourceMessage } from "../fullparty/resources/messages.js";
import { createResourceListMessage } from "../fullparty/resources/listMessage.js";
import {
  parseResourcePageControl,
  parseResourceShowControl,
  ResourcePaginationStore,
} from "../fullparty/resources/pagination.js";
import { postPublicResourceReply } from "../fullparty/resources/publicReply.js";
import { GuildResourceService } from "../fullparty/resources/service.js";
import type {
  ResourceData,
  ResourceListResponse,
} from "../fullparty/resources/schemas.js";
import { CommandError } from "./commandError.js";
import type { ChatInputCommand } from "./types.js";

const paginationStores = new WeakMap<BotContext, ResourcePaginationStore>();

function paginationStore(context: BotContext): ResourcePaginationStore {
  let store = paginationStores.get(context);
  if (!store) {
    store = new ResourcePaginationStore();
    paginationStores.set(context, store);
  }
  return store;
}

export const infoCommand: ChatInputCommand = {
  componentCustomIdPrefix: "info",
  data: new SlashCommandBuilder()
    .setName("info")
    .setDescription("Browse, search, or post this server's FullParty resources.")
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option
        .setName("name")
        .setDescription("A resource command name or search term, such as bridges.")
        .setMinLength(1)
        .setMaxLength(100)
        .setRequired(false),
    ),
  async execute(interaction, context) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const guildId = await requireResourceGuild(interaction, context);
    const name = interaction.options.getString("name")?.trim();
    const service = new GuildResourceService(context.fullparty);
    if (!name) {
      const resources = await captureFullpartyCommandPayload({
        commandName: "info",
        discordGuildId: guildId,
        payloads: context.payloads,
        request: () => service.list(guildId),
      });
      if (!resources.data.length) throw noResourcesFound();
      const sessionId = paginationStore(context).create(
        guildId,
        interaction.user.id,
        null,
      );
      await showResourceList(interaction, context, resources, sessionId);
      return;
    }
    if (name === "." || name === "..")
      throw new CommandError(
        "Use `/info` to see the available resource names.",
        "invalid_resource_name",
      );
    const result = await captureFullpartyCommandPayload({
      commandName: "info",
      discordGuildId: guildId,
      payloads: context.payloads,
      request: () => service.lookup(guildId, name),
    });
    if (!result.found) {
      if (!result.data.length) throw noResourcesFound(true);
      const sessionId = paginationStore(context).create(
        guildId,
        interaction.user.id,
        name,
      );
      await showResourceList(interaction, context, result, sessionId, name);
      return;
    }
    await postResource(interaction, context, service, guildId, result.data);
  },
  async handleComponent(interaction, context) {
    if (!interaction.isButton()) return;
    const show = parseResourceShowControl(interaction.customId);
    const control = show ?? parseResourcePageControl(interaction.customId);
    const store = paginationStore(context);
    const session = control ? store.get(control.sessionId) : undefined;
    if (!control || session?.guildId !== interaction.guildId) {
      await interaction.reply({
        content: "That resource list control is no longer valid. Run `/info` again.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (session.requesterId !== interaction.user.id) {
      await interaction.reply({
        content:
          "Only the person who ran `/info` can change this list. Run `/info` to open your own.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    // Capture the clicked resource before awaits: another page change can replace the snapshot.
    const selectedName =
      show && session.currentPage === show.page
        ? session.commandNames?.[show.index]
        : undefined;
    // Reserve synchronously so rapid Show clicks cannot publish the resource twice.
    if (show && !store.beginPost(control.sessionId)) {
      await interaction.reply({
        content: "A resource from this list is already being posted. Please wait.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    try {
      await interaction.deferUpdate();
      await requireResourceGuild(interaction, context);
      const service = new GuildResourceService(context.fullparty);
      if (show) {
        const name = selectedName;
        if (!name || name === "." || name === "..") {
          throw new CommandError(
            "That resource selection is no longer valid. Run `/info` again.",
            "resource_selection_invalid",
          );
        }
        const result = await captureFullpartyCommandPayload({
          commandName: "info",
          discordGuildId: session.guildId,
          payloads: context.payloads,
          request: () => service.lookup(session.guildId, name),
        });
        if (!result.found) {
          throw new CommandError(
            "That resource is no longer available. Run `/info` to see the current resources.",
            "resource_not_found",
          );
        }
        await postResource(interaction, context, service, session.guildId, result.data);
        // Retire the controls even if deleting the private list failed after posting.
        store.delete(control.sessionId);
        return;
      }
      const resources = session.query
        ? await service.lookup(session.guildId, session.query, control.page)
        : await service.list(session.guildId, control.page);
      if (!("meta" in resources)) {
        throw new CommandError(
          "An exact match is now available. Run `/info` with your search term again to post it.",
          "resource_search_changed",
        );
      }
      if (!resources.data.length) throw noResourcesFound(Boolean(session.query));
      // An earlier Show may have completed while this page was being fetched.
      if (!store.get(control.sessionId)) return;
      await showResourceList(
        interaction,
        context,
        resources,
        control.sessionId,
        session.query,
      );
    } finally {
      if (show) store.releasePost(control.sessionId);
    }
  },
};

async function showResourceList(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  context: BotContext,
  resources: ResourceListResponse,
  sessionId: string,
  query: string | null = null,
): Promise<void> {
  await interaction.editReply(createResourceListMessage(resources, sessionId, query));
  paginationStore(context).setPage(
    sessionId,
    resources.meta.current_page,
    resources.data.map((resource) => resource.command_name),
  );
}

async function postResource(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  context: BotContext,
  service: GuildResourceService,
  guildId: string,
  resource: ResourceData,
): Promise<void> {
  const message = createResourceMessage(resource);
  if (
    resource.assets.length &&
    !interaction.appPermissions.has(PermissionFlagsBits.AttachFiles)
  ) {
    throw new CommandError(
      "I need Attach Files permission in this channel to post this resource's images.",
      "resource_attach_files_permission",
    );
  }
  const files = await service.downloadAssets(
    guildId,
    resource,
    interaction.attachmentSizeLimit,
  );
  await postPublicResourceReply(interaction, { ...message, files }, context.logger);
}

function noResourcesFound(search = false): CommandError {
  return new CommandError(
    search
      ? "No resources matched that search. Try another name, or use `/info` to browse the available resources."
      : "No resources have been published for this server yet.",
    "resource_not_found",
  );
}

async function requireResourceGuild(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  context: BotContext,
): Promise<string> {
  if (!interaction.guildId) {
    throw new CommandError(
      "`/info` can only be used inside a Discord server.",
      "resource_guild_required",
    );
  }
  if (!(await context.guildSettings.get(interaction.guildId)).linkedAt) {
    throw new CommandError(
      "This server is not linked to a FullParty group yet. Ask a server admin to connect it with `/link token:<code>`.",
      "resource_guild_link_required",
    );
  }
  const sendPermission = interaction.channel?.isThread()
    ? PermissionFlagsBits.SendMessagesInThreads
    : PermissionFlagsBits.SendMessages;
  if (
    !interaction.appPermissions.has([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.EmbedLinks,
      sendPermission,
    ])
  ) {
    throw new CommandError(
      "I need View Channel, Send Messages (or Send Messages in Threads), and Embed Links permissions here to post FullParty resources.",
      "resource_channel_permission",
    );
  }
  return interaction.guildId;
}
