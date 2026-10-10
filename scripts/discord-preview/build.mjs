// Offline message catalogue. No credentials, Discord client, or API requests.
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { resolve, dirname, relative, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import ts from "typescript";
import { assignSourceKeys } from "./model.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = resolve(root, "data/discord-preview");
await mkdir(resolve(out, "cache"), { recursive: true });
await mkdir(resolve(out, "images"), { recursive: true });
const origin = "https://fullparty.gg";
const stamp = "2026-10-16T18:00:00.000Z";
const sampleNow = "2026-10-16T17:00:00.000Z";
const guild = "100000000000000001";
const user = "100000000000000002";
const role = "100000000000000003";
const template = "100000000000000004";
const channel = "100000000000000005";
const announce = "100000000000000006";
const moderator = "100000000000000007";
const sourceRole = "100000000000000008";
const records = [];
const modules = new Map();
async function load(file, expose = []) {
  if (modules.has(file)) return modules.get(file);
  const full = resolve(root, file);
  const output = resolve(
    out,
    "cache",
    file.replaceAll("/", "_").replace(/\.ts$/, ".mjs"),
  );
  await build({
    stdin: {
      contents:
        (await readFile(full, "utf8")) + "\nexport { " + expose.join(", ") + " };",
      resolveDir: dirname(full),
      sourcefile: full,
      loader: "ts",
    },
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
  });
  const module = await import(pathToFileURL(output).href);
  modules.set(file, module);
  return module;
}
const normalize = (value) =>
  JSON.parse(
    JSON.stringify(value, (_key, value) =>
      typeof value === "bigint" ? String(value) : value,
    ),
  );
function add(
  group,
  title,
  message,
  source,
  {
    audience = "Only you",
    note = "Built by the current bot renderer with fictional data.",
    previewSourceKey,
  } = {},
) {
  const data = normalize(typeof message === "string" ? { content: message } : message);
  if (/^\/(runs|applications)\b/u.test(title)) audience = "Direct message";
  if (/^\/info\b/u.test(title))
    audience = /^\/info name:/u.test(title) ? "#raid-chat" : "Only you";
  if (group === "Settings") audience = "#server-setup";
  records.push({
    id: "m" + String(records.length + 1).padStart(3, "0"),
    group,
    title,
    audience,
    note,
    source,
    ...(previewSourceKey ? { previewSourceKey } : {}),
    message: data,
  });
}

const notificationFile = "src/notifications/notificationMessageService.ts";
const n = await load(notificationFile);
const service = new n.NotificationMessageService({ fullpartyWebBaseUrl: origin });
const types = n.getSupportedNotificationTypes();
for (const type of [...types, "future.example_event"]) {
  const category =
    type === "user.discord_login" ? "account_character_updates" : type.split(".")[0];
  const params = {
    activity: "Futures Rewritten (Ultimate)",
    group: "Aether Collective",
    character: "Ari Vale",
    starts_at: stamp,
    slot_group: "Party 1",
    slot: "Healer 1",
    class: "White Mage",
    class_shorthand: "WHM",
    position: "H1",
    designation: "Run leader",
    attendance_status: "confirmed",
    count: 2,
    reason: "This run needs a different role composition.",
    provider: "Discord",
    username: "ari.vale",
    old_username: "ari",
    new_username: "ari.vale",
    method: "Lodestone",
    title: "Service update",
    message: "New scheduling tools are available in FullParty.",
  };
  const payload = {
    starts_at: stamp,
    status:
      type === "runs.completed"
        ? "completed"
        : type === "runs.cancelled"
          ? "cancelled"
          : "scheduled",
    party_finder: {
      character_name: "Ari Vale",
      world: "Twintania",
      password: "8246",
      published_at: sampleNow,
    },
    roster: {
      fields: [
        { label: "Class", display_value: "White Mage (WHM)" },
        { label: "Position", display_value: "H1" },
      ],
    },
    completion: {
      completed_at: "2026-10-16T20:00:00Z",
      furthest_progress_label: "Crystallize Time",
      furthest_progress_percent: 72,
      progress_entry_mode: "manual",
      progress_notes: "Consistent phase transitions. Continue from Crystallize Time.",
      progress_link_url: origin + "/en/runs/123",
      milestones: [{ milestone_label: "Darklit Dragonsong" }],
    },
  };
  if (type !== "runs.completed") delete payload.completion;
  if (type === "runs.cancelled") delete params.reason;
  if (type === "runs.starting_now") {
    params.starts_at = sampleNow;
    payload.starts_at = sampleNow;
    payload.status = "in_progress";
  }
  if (type === "runs.completed") {
    params.starts_at = "2026-10-15T18:00:00Z";
    payload.starts_at = params.starts_at;
    payload.completion.completed_at = "2026-10-15T20:00:00Z";
  }
  const data = {
    category,
    type,
    ...(type === "runs.cancelled"
      ? { cancellation_reason: "Not enough participants." }
      : {}),
    discord_user: { id: user },
    notification_delivery_id: 1,
    notification_event_id: 1,
    notification: {
      type,
      category,
      params,
      payload,
      action_url:
        type === "user.discord_login"
          ? "/auth/discord-app/user/redirect"
          : "/en/runs/123",
    },
  };
  const section =
    category === "applications"
      ? "Application notifications"
      : category === "assignments"
        ? "Roster notifications"
        : category === "runs"
          ? "Run notifications"
          : "Account and system notifications";
  add(section, type, service.createDmMessage(data), notificationFile, {
    audience: "Direct message",
    ...(type === "user.discord_login"
      ? {
          note: "Welcome for the standalone user.discord_login event when discord_app_installed is false. Its discord_app_install_url supplies this button's URL. Already-installed users are skipped; the website controls the first-login-only trigger.",
        }
      : {}),
  });
}
add(
  "Account and system notifications",
  "Minimal payload · no link or image",
  service.createDmMessage({
    category: "runs",
    type: "runs.starting_soon",
    discord_user: { id: user },
    notification_delivery_id: 2,
    notification_event_id: 2,
    notification: { type: "runs.starting_soon", category: "runs", params: {} },
  }),
  notificationFile,
  { audience: "Direct message", note: "Optional run details and action URL are absent." },
);

// App lifecycle webhooks send their own DMs outside discord.notification.delivery.
const userAppFile = "src/dm/deliveryService.ts";
const linkMessages = await load("src/discord/linkMessages.ts");
add(
  "Account and system notifications",
  "discord.user_app.installed",
  linkMessages.createUserConnectedMessage({ fullpartyWebBaseUrl: origin }),
  userAppFile,
  {
    audience: "Direct message",
    note: "Default V2 welcome when a user connects the Discord app. data.welcome_message overrides the introduction; data.account_settings_url overrides the settings destination.",
  },
);
add(
  "Account and system notifications",
  "discord.user_app.disconnected",
  linkMessages.createUserDisconnectedMessage({ fullpartyWebBaseUrl: origin }),
  userAppFile,
  {
    audience: "Direct message",
    note: "DM after disconnection, including Discord's Authorized Apps removal instructions. Supply data.feedback_url and data.disconnect_guide_image_url to show the optional feedback button and guide image.",
  },
);

const settingsFile = "src/commands/setup.ts";
const setup = await load("src/discord/setupMessages.ts");
const schedulePickerFile = "src/discord/scheduleFormatPicker.ts";
const schedulePicker = await load(schedulePickerFile);
const blank = { guildId: guild, syncDiscordNamesToFf14: false };
const settings = {
  ...blank,
  botLogChannelId: channel,
  runAnnouncementChannelId: announce,
  upcomingRaiderRoleId: template,
  botModeratorRoleId: moderator,
  linkedAt: sampleNow,
  syncDiscordNamesToFf14: true,
  scheduleMode: "timed_refresh",
  scheduleFormat: "plain",
  scheduleRefreshIntervalDays: 2,
  runRoleTemplateOverrides: [
    { activityId: 7, activityName: "Futures Rewritten (Ultimate)", roleId: role },
  ],
};
add("Settings", "/setup · first use", setup.buildSetupPanel(blank), settingsFile);
add("Settings", "/setup · configured", setup.buildSetupPanel(settings), settingsFile);
for (const [page, label] of [
  ["bot", "Bot Settings"],
  ["roles", "Role Templates"],
  ["nickname", "Nickname Sync"],
  ["schedule", "Schedule Settings"],
]) {
  add(
    "Settings",
    `/setup · ${label}`,
    setup.buildSetupPanel(settings, page, {
      botSettingsUrl: `${origin}/groups/aether-collective/dashboard/discord-integration`,
    }),
    settingsFile,
    {
      note: "Section selected from the public setup menu. Changes save immediately, except the format picker, which has its own Save button. Back returns to the menu in the same channel message. Manage Server is required to use the controls.",
    },
  );
}
add(
  "Settings",
  "/setup · channel permission warning",
  setup.buildSetupPanel(settings, "bot", {
    warning: `⚠️ Bot-log channel preflight: I cannot fully send messages in <#${channel}> yet.\nMissing permissions: Send Messages, Embed Links.`,
  }),
  settingsFile,
);
const scheduleFile = "src/commands/scheduleSetup.ts";
const scheduleState = {
  next_refresh_at: "2026-10-18T17:00:00Z",
  last_refreshed_at: sampleNow,
};
add(
  "Settings",
  "Automatic schedule · disabled",
  setup.buildSetupPanel(blank, "schedule"),
  scheduleFile,
  {
    note: "Automatic schedules are disabled. The shared Schedule Channel remains available for manual /postruns posts; no interval selector is shown.",
  },
);
add(
  "Settings",
  "Automatic schedule · enabled",
  setup.buildSetupPanel(settings, "schedule", { scheduleState }),
  scheduleFile,
  {
    note: "Timed Refresh uses the shared Schedule Channel. Only this mode shows the refresh interval selector.",
  },
);
add(
  "Settings",
  "Automatic schedule · run detection",
  setup.buildSetupPanel({ ...settings, scheduleMode: "run_detection" }, "schedule", {
    scheduleState: { ...scheduleState, refresh_pending: 0 },
  }),
  scheduleFile,
  {
    note: "Run Detection uses the shared Schedule Channel and refreshes when the website sends discord.guild.runs_changed. It has no interval selector.",
  },
);
add(
  "Settings",
  "Automatic schedule · run detection queued",
  setup.buildSetupPanel({ ...settings, scheduleMode: "run_detection" }, "schedule", {
    scheduleState: {
      ...scheduleState,
      next_refresh_at: sampleNow,
      refresh_pending: 1,
    },
  }),
  scheduleFile,
  {
    note: "A website run-change event has queued a persistent refresh for the next scheduler check.",
  },
);
add(
  "Settings",
  "Automatic schedule · retry / last issue",
  setup.buildSetupPanel(settings, "schedule", {
    scheduleState: {
      ...scheduleState,
      last_error: "Missing Access",
    },
  }),
  scheduleFile,
);
add(
  "Settings",
  "Automatic schedule · server not linked",
  setup.buildSetupPanel(blank, "schedule", {
    warning:
      "Link this server to FullParty with /link before enabling automatic schedules.",
  }),
  scheduleFile,
);
add(
  "Settings",
  "Automatic schedule · channel required",
  setup.buildSetupPanel({ ...blank, linkedAt: sampleNow }, "schedule", {
    warning: "Choose a schedule channel before enabling automatic refresh.",
  }),
  scheduleFile,
);
add(
  "Settings",
  "/setup · Schedule Format · Expanded",
  setup.buildSetupPanel({ ...settings, scheduleFormat: "expanded" }, "schedule", {
    scheduleState,
  }),
  settingsFile,
  {
    note: "Saved Expanded preference. Pick Format opens a deeper setup page with a live preview, Back and Save. Manual and automatic schedules use the saved format.",
  },
);
for (const [format, label] of [
  ["plain", "Plain"],
  ["expanded", "Expanded"],
]) {
  add(
    "Settings",
    `/setup · Schedule Format Picker · ${label}`,
    schedulePicker.buildScheduleFormatPicker(format),
    schedulePickerFile,
    {
      note: "In-message format editor. The dropdown updates the sample preview; Save persists the selection and Back discards the draft. Giki Chomusuke’s avatar is from the public Lodestone profile; the run and counts are sample data.",
    },
  );
}

const run = {
  id: 123,
  run_id: 123,
  activity_title: "Futures Rewritten (Ultimate)",
  activity: { name: "Futures Rewritten (Ultimate)" },
  starts_at: stamp,
  duration_hours: 2,
  duration_minutes: 120,
  needs_application: true,
  status: "scheduled",
  group: { name: "Aether Collective", slug: "aether-collective" },
  character: { name: "Ari Vale", world: "Twintania" },
  slot_group: "Party 1",
  datacenter: "Light",
  run_style: "progression",
  style: "Progression",
  intensity: "Focused",
  participant_count: 6,
  participant_capacity: 8,
  applications_count: 3,
  target_prog_point_key: "crystallize_time",
  target_prog_point_label: "Crystallize Time",
  target_progress: "Crystallize Time",
  host: { name: "Ari Vale", discord_user_id: user },
  action_url: "/en/runs/123",
  urls: {
    overview: "/en/runs/123",
    manage: "/en/runs/123/manage",
    apply: "/en/runs/123/apply",
  },
};
const run2 = {
  ...run,
  id: 124,
  run_id: 124,
  activity_title: "The Omega Protocol (Ultimate)",
  activity: { name: "The Omega Protocol (Ultimate)" },
  starts_at: "2026-10-17T18:00:00Z",
  participant_count: 8,
  target_prog_point_key: "phase_5",
  target_prog_point_label: "Phase 5",
};
const response = { data: [run, run2], meta: { group: run.group } };
const userFile = "src/fullparty/discordUserMessages.ts";
const userMessages = await load(userFile);
add(
  "Run and application commands",
  "/runs · upcoming runs",
  userMessages.createUpcomingRunsMessage({ data: [run] }, origin),
  userFile,
);
add(
  "Run and application commands",
  "/runs · empty",
  userMessages.createUpcomingRunsMessage({ data: [] }, origin),
  userFile,
);
for (const status of ["pending", "approved", "declined", "withdrawn", "cancelled"])
  add(
    "Run and application commands",
    "/applications · " + status,
    userMessages.createApplicationsMessage(
      {
        data: [
          {
            ...run,
            status,
            submitted_at: sampleNow,
            reason: status === "declined" ? "The healer slots are filled." : undefined,
          },
        ],
      },
      origin,
    ),
    userFile,
  );
add(
  "Run and application commands",
  "/applications · empty",
  userMessages.createApplicationsMessage([], origin),
  userFile,
);
const guildFile = "src/fullparty/discordGuildMessages.ts";
const guildMessages = await load(guildFile);
for (const page of [0, 1])
  add(
    "Run and application commands",
    `/guildruns · page ${page + 1}`,
    guildMessages.createGuildUpcomingRunsMessage(response, origin, {
      guildId: guild,
      limit: 10,
      page,
      requesterId: user,
    }),
    guildFile,
  );
add(
  "Run and application commands",
  "/guildruns · empty",
  guildMessages.createGuildUpcomingRunsMessage([], origin),
  guildFile,
);
const postFile = "src/fullparty/discordGuildRunPosts.ts";
const posts = await load(postFile);
add(
  "Run and application commands",
  "/postruns · public schedule",
  posts.createGuildUpcomingRunsPostMessage(
    schedulePicker.schedulePreviewResponse,
    origin,
    "plain",
  ),
  postFile,
  {
    audience: "#run-schedule",
    note: "Plain schedule format. Manual and automatic schedules share this renderer. The sample matches the format picker and Expanded example.",
  },
);
add(
  "Run and application commands",
  "/postruns · expanded schedule",
  posts.createGuildUpcomingRunsPostMessage(
    schedulePicker.schedulePreviewResponse,
    origin,
    "expanded",
  ),
  postFile,
  {
    audience: "#run-schedule",
    note: "Expanded Components V2 schedule format. Sample run hosted by Giki Chomusuke, using the character’s public Lodestone avatar. Production posts use the run API’s host avatar URL.",
  },
);
add(
  "Run and application commands",
  "/postruns · no upcoming runs",
  posts.createGuildUpcomingRunsPostMessage({ data: [], meta: response.meta }, origin),
  postFile,
  { audience: "#run-schedule" },
);

const reminder = {
  discord_guild_id: guild,
  run_id: 123,
  type: "discord.guild.run_reminder",
  reminder_type: "upcoming",
  starts_at: stamp,
  group_slug: "aether-collective",
  activity_title: "Futures Rewritten (Ultimate)",
  discord_user_ids: [user],
  participants: [],
  unlinked_participants: [],
  total_placed_count: 8,
  unlinked_count: 0,
};
const result = {
  discordGuildId: guild,
  runId: 123,
  reminderType: "upcoming",
  type: reminder.type,
  assignedUserCount: 8,
  requestedUserCount: 8,
  failedUserCount: 0,
  roleProcessingTimeMs: 100,
  templateRoleSource: "default",
  copiedOverwriteCount: 2,
  createdRunRole: true,
  roleId: role,
  roleName: "Run 123 · Futures Rewritten",
  templateRoleId: template,
};
const failure = {
  discordUserId: user,
  error: "Missing Permissions: member is above the bot in the role hierarchy.",
};
const commonFile = "src/guildAutomation/presentation/common.ts";
const common = await load(commonFile);
for (const reminder_type of ["upcoming", "starting_now"])
  add(
    "Role automation",
    `Automation started · ${reminder_type}`,
    common.buildGuildRunAutomationStartedMessage({ ...reminder, reminder_type }),
    commonFile,
    { audience: "#bot-log" },
  );
const roleFile = "src/guildAutomation/presentation/role.ts";
const roles = await load(roleFile);
for (const [title, patch] of [
  ["Complete · new role", {}],
  ["Complete · reused role", { createdRunRole: false }],
  ["Partial", { assignedUserCount: 7, failedUserCount: 1, failures: [failure] }],
  ["Failed", { assignedUserCount: 0, failedUserCount: 8, failures: [failure] }],
  [
    "Skipped",
    {
      assignedUserCount: 0,
      skippedReason: "upcoming_raider_role_not_configured",
      roleId: undefined,
    },
  ],
  ["Dry run · complete", { roleDryRun: true, roleId: undefined }],
  [
    "Dry run · partial",
    {
      roleDryRun: true,
      roleId: undefined,
      assignedUserCount: 7,
      failedUserCount: 1,
      failures: [failure],
    },
  ],
])
  add(
    "Role automation",
    title,
    roles.buildRunReminderRoleSyncLogMessage(reminder, { ...result, ...patch }),
    roleFile,
    { audience: "#bot-log" },
  );
const nickFile = "src/guildAutomation/presentation/nickname.ts";
const nick = await load(nickFile);
const nickResult = {
  nicknameRequestedUserCount: 8,
  nicknameSyncedUserCount: 6,
  nicknameSkippedUserCount: 2,
  nicknameFailedUserCount: 0,
  nicknameSyncEnabled: true,
};
for (const [title, patch] of [
  ["Complete", {}],
  [
    "Partial",
    {
      nicknameSyncedUserCount: 5,
      nicknameFailedUserCount: 1,
      nicknameFailures: [failure],
    },
  ],
  [
    "Failed",
    {
      nicknameSyncedUserCount: 0,
      nicknameSkippedUserCount: 0,
      nicknameFailedUserCount: 8,
      nicknameFailures: [failure],
    },
  ],
  [
    "Skipped · disabled",
    {
      nicknameSyncedUserCount: 0,
      nicknameSkippedUserCount: 0,
      nicknameSkippedReason: "nickname_sync_disabled",
    },
  ],
])
  add(
    "Nickname and cleanup",
    "Nickname sync · " + title,
    nick.buildRunReminderNicknameSyncLogMessage(reminder, { ...nickResult, ...patch }),
    nickFile,
    { audience: "#bot-log" },
  );
const cleanupFile = "src/guildAutomation/presentation/cleanup.ts";
const cleanup = await load(cleanupFile);
for (const [title, patch] of [
  ["Complete", { deletedRoleCount: 1 }],
  ["Failed", { failedRoleCount: 1, failures: [failure] }],
  ["Skipped", { skippedReason: "run_role_mapping_not_found" }],
])
  add(
    "Nickname and cleanup",
    "Role cleanup · " + title,
    cleanup.buildRunRoleCleanupLogMessage(
      { ...reminder, type: "discord.guild.run_completed" },
      {
        discordGuildId: guild,
        runId: 123,
        type: "discord.guild.run_completed",
        roleId: role,
        roleName: result.roleName,
        deletedRoleCount: 0,
        failedRoleCount: 0,
        ...patch,
      },
    ),
    cleanupFile,
    { audience: "#bot-log" },
  );
const detailsFile = "src/guildAutomation/automationFailureDetails.ts";
const details = await load(detailsFile, ["splitAutomationFailureDetails"]);
for (const text of details.splitAutomationFailureDetails({
  title: "Role Assignment Failure Details",
  context: "Run #123 • aether-collective",
  createdAt: Date.parse(sampleNow),
  sections: [
    {
      title: "Role Assignment Failures",
      details: [{ subject: user, reason: failure.error }],
    },
  ],
}))
  add("Nickname and cleanup", "Show failure details", text, detailsFile);

const assignFile = "src/commands/assignRunRole.ts";
const assign = await load(assignFile, ["createAssignmentResultMessage"]);
for (const [title, patch, debug] of [
  ["Complete", {}, false],
  ["Partial", { assignedUserCount: 7, failedUserCount: 1 }, false],
  ["Skipped", { skippedReason: "upcoming_raider_role_not_configured" }, false],
  ["Dry run", { roleId: undefined }, true],
])
  add(
    "Role command replies",
    "/assignrunrole · " + title,
    assign.createAssignmentResultMessage(123, { ...result, ...patch }, reminder, {
      debugBypassWindow: debug,
    }),
    assignFile,
  );
for (const failed of [0, 2])
  add(
    "Role command replies",
    "/rolesync · " + (failed ? "partial" : "complete"),
    [
      `Role sync finished: <@&${sourceRole}> → <@&${role}>.`,
      `Matched: 32. Added: ${24 - failed}. Already had role: 8. Failed: ${failed}.`,
      "The original role and all other roles were kept.",
      ...(failed
        ? [
            "Failures were recorded in the bot logs. You can rerun this command to try the remaining members again.",
          ]
        : []),
    ].join("\n"),
    "src/commands/roleSync.ts",
    { note: "Source reply template populated with sample result counts." },
  );

const linkFile = "src/commands/link.ts";
const link = await load(linkFile, [
  "createMissingTokenMessage",
  "createLinkValidationMessage",
  "createLinkFailureMessage",
  "createGuildLinkSuccessMessage",
  "createUserLinkSuccessMessage",
]);
for (const guildLink of [true, false]) {
  const label = guildLink ? "server" : "account";
  const audience = guildLink ? "Only you" : "Direct message";
  add(
    "Linking and help",
    "/link · " + label + " instructions",
    link.createMissingTokenMessage(guildLink, origin),
    linkFile,
    { audience },
  );
  add(
    "Linking and help",
    "/link · " + label + " linked",
    guildLink
      ? link.createGuildLinkSuccessMessage(origin, {
          data: {
            group: { slug: "aether-collective" },
          },
        })
      : link.createUserLinkSuccessMessage(origin),
    linkFile,
    {
      audience,
      ...(guildLink
        ? {
            note: "Bot Settings is derived from data.group.slug in the guild-link API response. An explicit data.discord_settings_url can override it; without either, the button is omitted.",
          }
        : {}),
    },
  );
  for (const status of [403, 409, 422, 500])
    add(
      "Linking and help",
      `/link · ${label} · ${status}`,
      link.createLinkFailureMessage({ status }, guildLink),
      linkFile,
      { audience },
    );
}
add(
  "Linking and help",
  "/link · validating",
  link.createLinkValidationMessage("DEMO-CODE"),
  linkFile,
);
const helpFile = "src/commands/help.ts";
const help = await load(helpFile, ["createHelpMessage"]);
for (const [label, audience] of [
  ["Direct messages", { kind: "dm" }],
  [
    "Server member",
    { kind: "guild", canManageServer: false, canModerate: false, canManageRoles: false },
  ],
  [
    "Server admin / moderator",
    { kind: "guild", canManageServer: true, canModerate: true, canManageRoles: true },
  ],
]) {
  add(
    "Linking and help",
    `/help · ${label}`,
    help.createHelpMessage(origin, audience),
    helpFile,
    {
      audience: audience.kind === "dm" ? "Direct message" : "Only you",
      ...(audience.canModerate
        ? {
            previewSourceKey: `${helpFile}::/help`,
            note: "Full administrator example. Each admin entry is filtered by the user's permissions: Manage Server, the configured bot moderator role, or Manage Roles.",
          }
        : {}),
    },
  );
}
const faqFile = "src/commands/faq.ts";
const faq = await load(faqFile);
add("Linking and help", "/faq", faq.createFaqMessage(), faqFile, {
  note: "Temporarily disabled in the bot. Copy is retained for future use.",
});

const listFile = "src/fullparty/resources/listMessage.ts";
const list = await load(listFile);
const listData = {
  components: [],
  data: [
    {
      command_name: "fru",
      embed: {
        title: "Futures Rewritten (Ultimate)",
        author: { name: "Futures Rewritten raid resources" },
      },
    },
    {
      command_name: "conduct",
      embed: {
        title: "Community Guidelines",
        author: { name: "Community guidelines" },
      },
    },
    {
      command_name: "schedule",
      embed: {
        title: "Weekly Run Schedule",
        author: { name: "Weekly raid schedule" },
      },
    },
    {
      command_name: "bridges",
      embed: {
        title: "BA Bridge Assignments",
        author: { name: "Bridge groups and callouts" },
      },
    },
    {
      command_name: "ozma",
      embed: {
        title: "Ozma",
        author: { name: "Mechanics and assigned positions" },
      },
    },
    {
      command_name: "trinity",
      embed: {
        title: "Trinity Avowed",
        author: { name: "Delubrum Reginae Savage notes" },
      },
    },
    {
      command_name: "pots",
      embed: {
        title: "Food and Potions",
        author: { name: "Recommended consumables" },
      },
    },
    {
      command_name: "roles",
      embed: {
        title: "Specialist Roles",
        author: { name: "Trapper, darter and duelist duties" },
      },
    },
  ],
  meta: { total: 9, per_page: 8, current_page: 1, last_page: 2, next_page: 2 },
};
add(
  "Resources and admin",
  "/info · resource list",
  list.createResourceListMessage(listData, "preview"),
  listFile,
);
add(
  "Resources and admin",
  "/info · resource list · page 2",
  list.createResourceListMessage(
    {
      ...listData,
      data: [
        {
          command_name: "queue",
          embed: {
            title: "Queue and Fill-ins",
            author: { name: "How standby assignments work" },
          },
        },
      ],
      meta: { ...listData.meta, current_page: 2, next_page: null },
    },
    "preview",
  ),
  listFile,
);
add(
  "Resources and admin",
  "/info · resource search",
  list.createResourceListMessage(
    {
      ...listData,
      data: listData.data.slice(0, 1),
      meta: { total: 1, current_page: 1, last_page: 1, next_page: null },
    },
    "preview",
    "fru",
  ),
  listFile,
);
add(
  "Resources and admin",
  "/info · empty",
  list.createResourceListMessage(
    {
      components: [],
      data: [],
      meta: { total: 0, current_page: 1, last_page: 1, next_page: null },
    },
    "preview",
  ),
  listFile,
);
const resourceFile = "src/fullparty/resources/messages.ts";
const resources = await load(resourceFile);
add(
  "Resources and admin",
  "/info name:fru · custom resource example",
  resources.createResourceMessage({
    components: [],
    embed: {
      author: { name: "Futures Rewritten raid resources" },
      title: "Futures Rewritten (Ultimate)",
      description:
        "Prepare for the run with the agreed strategies and party assignments.",
      color: 0x8b5cf6,
      fields: [
        {
          name: "Strategy",
          value: "Review the group strategy before joining.",
          inline: false,
        },
        { name: "Food & potions", value: "Bring enough for two hours.", inline: false },
      ],
      footer: { text: "Aether Collective • Raid resources" },
    },
  }),
  resourceFile,
  {
    audience: "#raid-chat",
    note: "Website-authored content is arbitrary; this illustrates the supported embed structure, not a fixed bot template.",
  },
);
const adminFile = "src/dm/adminReport.ts";
const admin = await load(adminFile, ["createAdminReportMessage"]);
for (const severity of ["info", "warning", "error", "critical"]) {
  const message = admin.createAdminReportMessage({
    title:
      "Integration delivery " + (severity === "info" ? "recovered" : "needs attention"),
    message:
      "The run notification could not be delivered.\n\nRun: **#123**\nEvent: `discord.notification.delivery`\nThe delivery is available for review in FullParty.",
    severity,
    url: origin + "/admin/integrations",
  });
  message.embeds[0].timestamp = sampleNow;
  add("Resources and admin", "Admin report · " + severity, message, adminFile, {
    audience: "Owner DM",
    note: "Website supplies title, body and optional URL; the bot sets severity colour and footer. Sample copy.",
  });
}
const debugFile = "src/http/eventDebugMessages.ts";
const debug = await load(debugFile);
for (const message of debug.createEventDebugMessages(
  { type: "discord.guild.run_completed", data: { discord_guild_id: guild, run_id: 123 } },
  "FullParty event",
))
  add("Resources and admin", "Event payload debug", message, debugFile, {
    audience: "Owner / bot log",
  });
add(
  "Resources and admin",
  "!token · owner reply",
  "Here is your FullParty bot admin API token:\n\n```\nDEMO-TOKEN-NOT-A-CREDENTIAL\n```\n\nUse it on the admin dashboard login page. Treat it like a password.",
  "src/bot/createClient.ts",
  {
    audience: "Owner DM",
    note: "Source reply with a nonfunctional placeholder. No .env or real credential was read.",
  },
);
for (const [status, roleStatus, nicknameStatus] of [
  ["completed", "updated", "updated"],
  ["completed", "unchanged", "skipped"],
  ["partial", "updated", "failed"],
  ["failed", "failed", "failed"],
])
  add(
    "Nickname and cleanup",
    `Participant sync · ${status} / ${nicknameStatus}`,
    `FullParty Run #123 participant sync for <@${user}>: ${status}.\nRun role <@&${role}>: ${roleStatus}.\nNickname: ${nicknameStatus}.`,
    "src/guildAutomation/runParticipantSync.ts",
    {
      audience: "#bot-log",
      note: "Source reply template populated with representative step results.",
    },
  );
add(
  "Nickname and cleanup",
  "Role cleanup · cancelled run",
  cleanup.buildRunRoleCleanupLogMessage(
    { ...reminder, type: "runs.cancelled" },
    { roleId: role, roleName: result.roleName, deletedRoleCount: 1, failedRoleCount: 0 },
  ),
  cleanupFile,
  { audience: "#bot-log" },
);
const interactionFile = "src/interactions/handleInteraction.ts";
const interactionMessages = await load(interactionFile, [
  "createLinkedUserRequiredMessage",
]);
add(
  "Linking and help",
  "Account link required",
  interactionMessages.createLinkedUserRequiredMessage(),
  interactionFile,
);
// Preserve saved alternatives when an extracted literal becomes a shared renderer.
for (const [name, legacyLine] of [
  ["guildRuns", 104],
  ["assignRunRole", 62],
]) {
  const source = `src/commands/${name}.ts`;
  add(
    "Linking and help",
    `${name} · server link required`,
    linkMessages.createGuildLinkRequiredMessage(),
    source,
    { previewSourceKey: `${source}::${name} · line ${legacyLine}` },
  );
}
add(
  "Role command replies",
  "/clearrole · complete",
  "✅ Cleared `Run 123 · Futures Rewritten`. Discord will remove that role from all members automatically.",
  "src/commands/clearRole.ts",
  { note: "Source reply template populated with a fictional role name." },
);

// Collect literal error/reply branches without executing commands or any side effects.
// Interpolations intentionally remain labelled placeholders rather than invented values.
const seen = new Set(records.map((record) => record.message.content).filter(Boolean));
function variants(node, sourceFile) {
  if (!node) return [];
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return [node.text];
  if (ts.isTemplateExpression(node))
    return [
      node.head.text +
        node.templateSpans
          .map((span) => `〈${span.expression.getText(sourceFile)}〉` + span.literal.text)
          .join(""),
    ];
  if (ts.isConditionalExpression(node))
    return [
      ...variants(node.whenTrue, sourceFile),
      ...variants(node.whenFalse, sourceFile),
    ];
  if (
    ts.isBinaryExpression(node) &&
    [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(
      node.operatorToken.kind,
    )
  )
    return [...variants(node.left, sourceFile), ...variants(node.right, sourceFile)];
  return [];
}
async function walk(directory) {
  const files = [];
  for (const item of await readdir(resolve(root, directory), { withFileTypes: true })) {
    const path = directory + "/" + item.name;
    if (item.isDirectory()) files.push(...(await walk(path)));
    else if (path.endsWith(".ts")) files.push(path);
  }
  return files;
}
const scanned = (await walk("src")).filter(
  (file) => !file.includes("/admin/") && file !== "src/commands/fullparty.ts",
);
for (const file of scanned) {
  const sourceFile = ts.createSourceFile(
    file,
    await readFile(resolve(root, file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  function visit(node) {
    let expressions = [];
    if (ts.isPropertyAssignment(node) && node.name.getText(sourceFile) === "content")
      expressions = [node.initializer];
    if (ts.isVariableDeclaration(node) && node.name.getText(sourceFile) === "content")
      expressions = [node.initializer];
    if (ts.isReturnStatement(node)) {
      let ancestor = node.parent;
      while (ancestor && !ts.isFunctionDeclaration(ancestor)) ancestor = ancestor.parent;
      if (
        ancestor &&
        [
          "getBlockedReason",
          "getRunAssignmentWindowError",
          "getFullpartyRunLookupErrorMessage",
        ].includes(ancestor.name?.text)
      )
        expressions = [node.expression];
    }
    if (
      ts.isNewExpression(node) &&
      node.expression.getText(sourceFile) === "CommandError"
    )
      expressions = [node.arguments?.[0]];
    if (
      ts.isCallExpression(node) &&
      /\.(reply|editReply|followUp)$/.test(node.expression.getText(sourceFile))
    )
      expressions = [node.arguments?.[0]];
    for (const expression of expressions)
      for (const content of variants(expression, sourceFile)) {
        if (!content.trim() || seen.has(content)) continue;
        seen.add(content);
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        add(
          "Other replies and errors",
          basename(file, ".ts") + " · line " + line,
          content,
          `${file}:${line}`,
          {
            audience: "Context dependent",
            note: content.includes("〈")
              ? "Source template. Angle brackets label runtime values; variable branches are represented in the main catalogue where possible."
              : "Exact literal reply from the source. Visibility depends on its command/context.",
          },
        );
      }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

assignSourceKeys(records);
const metadata = {
  generatedAt: new Date().toISOString(),
  sampleNow,
  notificationTypes: types,
  mentions: {
    [guild]: "Aether Collective",
    [user]: "Ari Vale",
    [role]: "Run 123 · Futures Rewritten",
    [template]: "Run template",
    [channel]: "bot-log",
    [announce]: "run-schedule",
    [moderator]: "FullParty moderator",
    [sourceRole]: "runpingsB",
  },
  notes: [
    "Current implementation reference, including approved V2 redesigns.",
    "Local renderings approximate Discord. Use Send Version to preview a draft in your development-bot DMs; Discord fonts, spacing and locale can differ.",
    "All data is fictional. Relative timestamps use 16 October 2026, 18:00 Europe/London as the reference time.",
    `All ${types.length} supported notification delivery types and both Discord app connection events are included. Meaningful finite UI states and additional source reply branches are included; arbitrary website content, API errors, pagination lengths and runtime combinations are not enumerable.`,
    "Run published / confirmed are represented by roster publication, assignment and Party Finder notifications; no standalone runs.published or runs.confirmed template exists.",
    "No production source files or bot settings are changed.",
  ],
  records,
};
const templateHtml = await readFile(
  resolve(root, "scripts/discord-preview/template.html"),
  "utf8",
);
const workshop = await build({
  entryPoints: [resolve(root, "scripts/discord-preview/editor.mjs")],
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  globalName: "PreviewWorkshop",
  target: "es2022",
});
const workshopCss = await readFile(
  resolve(root, "scripts/discord-preview/editor.css"),
  "utf8",
);
await writeFile(resolve(out, "messages.json"), JSON.stringify(metadata, null, 2));
await writeFile(
  resolve(out, "index.html"),
  templateHtml
    .replace(
      "<!--WORKSHOP_ASSETS-->",
      `<style>${workshopCss}</style><script>${workshop.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script>`,
    )
    .replace("/*__CATALOG__*/ {}", JSON.stringify(metadata).replaceAll("<", "\\u003c")),
);
await writeFile(
  resolve(out, "README.txt"),
  `FullParty Discord response workshop\n\nStart from the repository: npm.cmd run preview:discord\nOpen http://127.0.0.1:4318/ and choose Add Version on any example.\nOpening index.html directly is view-only; saving and DM previews require the preview server.\n${records.length} examples; ${types.length} registered notification types.\n\nAlternatives and uploaded assets are stored in data/discord-preview/versions.json. Rebuilding preserves them. Use Export alternatives for a portable backup; individual message exports omit preview assets.\n\nSend Version sends the current unsaved draft to PAYLOAD_COMMAND_ALLOWED_USER_ID using the development bot's DISCORD_TOKEN. Enable DEV_JSON_ENABLED in .env; NODE_ENV must be development or unset. Uploaded assets are supported, up to 10 files and 8 MiB total. Sending does not save the draft or start another bot gateway connection.\n\n${metadata.notes.join("\n")}\n\nRegenerate from the repository:\nnode scripts/discord-preview/build.mjs\n\nThe source reply index uses labelled placeholders for dynamic expressions.\nCatalogue generation bundles pure presentation functions to a local ignored cache without reading .env, logging into Discord or sending messages. The preview server reads .env and makes Discord API requests only when you click Send Version.\n`,
);
console.log(
  JSON.stringify(
    {
      output: relative(root, out),
      examples: records.length,
      notificationTypes: types.length,
      groups: Object.fromEntries(
        [...new Set(records.map((x) => x.group))].map((group) => [
          group,
          records.filter((x) => x.group === group).length,
        ]),
      ),
    },
    null,
    2,
  ),
);
