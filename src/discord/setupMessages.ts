import {
  ButtonStyle,
  ChannelType,
  ComponentType,
  MessageFlags,
  SelectMenuDefaultValueType,
  escapeMarkdown,
  type APIActionRowComponent,
  type APIButtonComponentWithCustomId,
  type APIChannelSelectComponent,
  type APIComponentInContainer,
  type APIComponentInMessageActionRow,
  type APIMessageTopLevelComponent,
  type APIRoleSelectComponent,
  type APISectionComponent,
  type APISeparatorComponent,
  type APITextDisplayComponent,
} from "discord.js";
import { ScheduleCustomId, SetupCustomId } from "../commands/setupIds.js";
import {
  formatScheduleFormat,
  getSchedulePostFormat,
  formatScheduleInterval,
  getScheduleMode,
  scheduleIntervals,
} from "../guildSchedule/settings.js";
import type { ScheduleState } from "../guildSchedule/store.js";
import type { GuildSettings } from "../guildSettings/types.js";

export type SetupPage = "home" | "bot" | "roles" | "nickname" | "schedule";

export type SetupPanelOptions = {
  warning?: string | undefined;
  scheduleState?:
    | (Pick<ScheduleState, "next_refresh_at" | "last_refreshed_at" | "last_error"> &
        Partial<Pick<ScheduleState, "refresh_pending">>)
    | undefined;
  botSettingsUrl?: string | undefined;
};

export type SetupV2Message = {
  flags: MessageFlags.IsComponentsV2;
  allowedMentions: { parse: []; repliedUser: false };
  components: APIMessageTopLevelComponent[];
};

export function buildSetupPanel(
  settings: GuildSettings,
  page: SetupPage = "home",
  options: SetupPanelOptions = {},
): SetupV2Message {
  const components = pageComponents(settings, page, options);
  if (options.warning) {
    components.push(text(options.warning.slice(0, 600)));
  }
  if (page !== "home") {
    components.push(
      { type: ComponentType.Separator, divider: true, spacing: 1 },
      row(button("Back", SetupCustomId.Home)),
    );
  }
  return {
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [], repliedUser: false },
    components: [{ type: ComponentType.Container, accent_color: 9912567, components }],
  };
}

function pageComponents(
  settings: GuildSettings,
  page: SetupPage,
  options: SetupPanelOptions,
): APIComponentInContainer[] {
  switch (page) {
    case "home":
      return [
        text(
          "## FullParty Server Setup\nConfigure how FullParty manages your server’s roles, nicknames and schedules.\n-# Manage Server permission is required.",
        ),
        row(
          button("Bot Settings", SetupCustomId.BotSettings),
          button("Role Templates", SetupCustomId.RoleTemplates),
          button("Nickname Sync", SetupCustomId.NicknameSync),
          button("Schedule Settings", ScheduleCustomId.Open),
        ),
      ];
    case "bot":
      return [
        text(
          "## Bot Settings\nChoose where FullParty reports activity and who can manage run operations.",
        ),
        text(
          `**Bot Log Channel**\nReceive role assignment results, nickname sync reports and automation errors.\nCurrent: ${formatChannel(settings.botLogChannelId)}`,
        ),
        channelSelect(SetupCustomId.BotLogChannel, settings.botLogChannelId),
        { type: ComponentType.Separator, divider: false, spacing: 1 },
        text(
          `**Bot Moderator Role**\nAllow members with this role to manage runs and temporary run roles. Changing server settings still requires Manage Server.\nCurrent: ${formatRole(settings.botModeratorRoleId)}`,
        ),
        roleSelect(SetupCustomId.BotModeratorRole, settings.botModeratorRoleId),
      ];
    case "roles":
      return [
        text(
          "## Role Templates\nFullParty creates a temporary role for each run using your template’s permissions and channel access. The run role is removed when the run completes or is cancelled.",
        ),
        text(
          `**Default Template**\nUsed for activities without a specific override.\nCurrent: ${formatRole(settings.upcomingRaiderRoleId)}`,
        ),
        roleSelect(SetupCustomId.UpcomingRaiderRole, settings.upcomingRaiderRoleId),
        activityOverrides(settings, options.botSettingsUrl),
      ];
    case "nickname":
      return [
        text(
          "## Nickname Sync\nAutomatically update participants’ server nicknames using their character details from FullParty during run syncing.",
        ),
        section(
          `**Status:** ${formatEnabled(settings.syncDiscordNamesToFf14)}\n**Standard format:** Name Surname [World]\nRun syncing uses each participant’s primary character when available.\n-# Disabling sync stops future updates. Existing nicknames remain unchanged.`,
          settings.syncDiscordNamesToFf14
            ? button("Disable Sync", SetupCustomId.NameSyncDisabled)
            : button("Enable Sync", SetupCustomId.NameSyncEnabled, ButtonStyle.Success),
        ),
      ];
    case "schedule":
      return scheduleComponents(settings, options.scheduleState);
  }
}

function scheduleComponents(
  settings: GuildSettings,
  state: SetupPanelOptions["scheduleState"],
): APIComponentInContainer[] {
  const mode = getScheduleMode(settings);
  const enabled = mode !== "disabled";
  const interval = settings.scheduleRefreshIntervalDays ?? 1;
  const nextRefresh =
    mode === "timed_refresh" ? discordTimestamp(state?.next_refresh_at, "R") : undefined;
  const lastPosted = discordTimestamp(state?.last_refreshed_at, "f");
  const runtime = [
    nextRefresh ? `**Next Refresh:** ${nextRefresh}` : undefined,
    mode === "run_detection" && state?.refresh_pending !== undefined
      ? `**Status:** ${state.refresh_pending ? "Update queued" : "Waiting for run changes"}`
      : undefined,
    mode === "run_detection" && state?.refresh_pending && state.last_error
      ? `**Next Retry:** ${discordTimestamp(state.next_refresh_at, "R") ?? "Pending"}`
      : undefined,
    lastPosted ? `**Last Posted:** ${lastPosted}` : undefined,
    state?.last_error
      ? `**Last Issue:** ${escapeMarkdown(state.last_error.slice(0, 200))}`
      : undefined,
  ].filter((line): line is string => line !== undefined);
  return [
    text(
      "## Schedule Settings\nChoose where schedules appear and how FullParty keeps them up to date.",
    ),
    largeDivider(),
    text(
      `**Schedule Channel**\nUsed for /postruns and automatic schedule updates.\nCurrent: ${formatChannel(settings.runAnnouncementChannelId)}`,
    ),
    channelSelect(SetupCustomId.ScheduleChannel, settings.runAnnouncementChannelId),
    largeDivider(),
    text(
      "**Automatic Schedule**\nChoose when FullParty updates the schedule. Each update replaces the previous automatic post.",
    ),
    row({
      type: ComponentType.StringSelect,
      custom_id: ScheduleCustomId.Mode,
      placeholder: "Schedule Mode…",
      min_values: 1,
      max_values: 1,
      options: [
        {
          label: "Disabled",
          value: "disabled",
          description: "Publish schedules manually with /postruns.",
          default: mode === "disabled",
        },
        {
          label: "Timed Refresh",
          value: "timed_refresh",
          description: "Refresh automatically at your chosen interval.",
          default: mode === "timed_refresh",
        },
        {
          label: "Run Detection",
          value: "run_detection",
          description: "Refresh when FullParty reports changes to your group’s runs.",
          default: mode === "run_detection",
        },
      ],
    }),
    ...(mode === "timed_refresh"
      ? [
          text(`**Refresh Frequency:** ${formatScheduleInterval(interval)}`),
          row({
            type: ComponentType.StringSelect,
            custom_id: ScheduleCustomId.Interval,
            placeholder: "Refresh Frequency…",
            min_values: 1,
            max_values: 1,
            options: scheduleIntervals.map((days) => ({
              label: formatScheduleInterval(days),
              value: String(days),
              default: days === interval,
            })),
          }),
        ]
      : []),
    ...(mode === "run_detection"
      ? [
          text(
            "FullParty refreshes the schedule when the website reports that your group’s runs have been added, removed or changed.",
          ),
        ]
      : []),
    largeDivider(),
    section(
      `**Schedule Format**\nChange the style of your schedule listings.\nCurrent: ${formatScheduleFormat(getSchedulePostFormat(settings.scheduleFormat))}`,
      button("Pick Format", ScheduleCustomId.FormatOpen),
    ),
    ...(enabled && runtime.length > 0 ? [largeDivider(), text(runtime.join("\n"))] : []),
    ...(enabled
      ? [
          text(
            "-# Enabling or changing automatic schedule settings schedules a refresh within a minute. Hosts are not pinged.",
          ),
        ]
      : []),
    text(
      "-# Manual schedule posts are kept. Disabling automatic updates leaves the latest post in place.",
    ),
  ];
}

function activityOverrides(
  settings: GuildSettings,
  botSettingsUrl: string | undefined,
): APIComponentInContainer {
  const overrides = settings.runRoleTemplateOverrides ?? [];
  const shown = overrides.slice(0, 8);
  const lines = shown.map(
    (override) =>
      `${formatRole(override.roleId)} — ${escapeMarkdown(override.activityName.replace(/\s+/g, " ").slice(0, 80))} (${String(override.activityId)})`,
  );
  if (overrides.length > shown.length) {
    lines.push(`_And ${String(overrides.length - shown.length)} more on FullParty._`);
  }
  const content = `**Activity Overrides**\nUse different templates for specific activities.\n${lines.length > 0 ? lines.join("\n") : "_None configured_"}\n-# Manage activity overrides in your group’s Discord integration settings on FullParty.`;
  const url = safeSettingsUrl(botSettingsUrl);
  return url
    ? section(content, {
        type: ComponentType.Button,
        style: ButtonStyle.Link,
        label: "Settings",
        url,
      })
    : text(content);
}

function text(content: string): APITextDisplayComponent {
  return { type: ComponentType.TextDisplay, content };
}

function largeDivider(): APISeparatorComponent {
  return { type: ComponentType.Separator, divider: true, spacing: 2 };
}

function row(
  ...components: APIComponentInMessageActionRow[]
): APIActionRowComponent<APIComponentInMessageActionRow> {
  return { type: ComponentType.ActionRow, components };
}

function section(
  content: string,
  accessory: APISectionComponent["accessory"],
): APISectionComponent {
  return { type: ComponentType.Section, components: [text(content)], accessory };
}

function button(
  label: string,
  customId: string,
  style: APIButtonComponentWithCustomId["style"] = ButtonStyle.Secondary,
): APIButtonComponentWithCustomId {
  return { type: ComponentType.Button, style, label, custom_id: customId };
}

function channelSelect(
  customId: string,
  channelId: string | undefined,
  placeholder = "Choose Channel…",
): APIActionRowComponent<APIChannelSelectComponent> {
  return {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.ChannelSelect,
        custom_id: customId,
        placeholder,
        min_values: 1,
        max_values: 1,
        channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
        ...(channelId
          ? {
              default_values: [
                { id: channelId, type: SelectMenuDefaultValueType.Channel },
              ],
            }
          : {}),
      },
    ],
  };
}

function roleSelect(
  customId: string,
  roleId: string | undefined,
): APIActionRowComponent<APIRoleSelectComponent> {
  return {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.RoleSelect,
        custom_id: customId,
        placeholder: "Choose Role…",
        min_values: 1,
        max_values: 1,
        ...(roleId
          ? { default_values: [{ id: roleId, type: SelectMenuDefaultValueType.Role }] }
          : {}),
      },
    ],
  };
}

function formatChannel(id: string | undefined): string {
  return id ? `<#${id}>` : "_Not set_";
}

function formatRole(id: string | undefined): string {
  return id ? `<@&${id}>` : "_Not set_";
}

function formatEnabled(enabled: boolean): string {
  return enabled ? "Enabled" : "Disabled";
}

function discordTimestamp(
  value: string | null | undefined,
  format: "R" | "f",
): string | undefined {
  const timestamp = value ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp)
    ? `<t:${String(Math.floor(timestamp / 1000))}:${format}>`
    : undefined;
}

function safeSettingsUrl(value: string | undefined): string | undefined {
  if (!value || value.length > 512) return undefined;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
