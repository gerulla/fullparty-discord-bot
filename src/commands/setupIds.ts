export const SetupCustomId = {
  Home: "setup:back",
  BotSettings: "setup:page:bot",
  RoleTemplates: "setup:page:roles",
  NicknameSync: "setup:page:nickname",
  BotLogChannel: "setup:bot_log_channel",
  BotModeratorRole: "setup:bot_moderator_role",
  NameSyncDisabled: "setup:name_sync:disabled",
  NameSyncEnabled: "setup:name_sync:enabled",
  ScheduleChannel: "setup:schedule_channel",
  // Keep controls in previously sent setup panels working.
  LegacyRunAnnouncementChannel: "setup:run_announcement_channel",
  UpcomingRaiderRole: "setup:upcoming_raider_role",
} as const;

export const ScheduleCustomId = {
  FormatPrefix: "setup:schedule:format:",
  Open: "setup:schedule:open",
  Mode: "setup:schedule:mode",
  Channel: "setup:schedule:channel",
  Interval: "setup:schedule:interval",
  FormatOpen: "setup:schedule:format:open",
  FormatSave: "setup:schedule:format:save",
  FormatValue: "setup:schedule:format:value",
  Enable: "setup:schedule:enable",
  Disable: "setup:schedule:disable",
  Back: SetupCustomId.Home,
} as const;
