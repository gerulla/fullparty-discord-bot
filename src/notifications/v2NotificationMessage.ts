import {
  ButtonStyle,
  ComponentType,
  MessageFlags,
  escapeMarkdown,
  type APIComponentInContainer,
  type APIContainerComponent,
  type APIMessageTopLevelComponent,
  type APITextDisplayComponent,
  type MessageCreateOptions,
} from "discord.js";

import { getDesignationDisplayName } from "./formatters/assignments.js";
import { getAssignmentExtraFields } from "./formatters/roster.js";
import { getRunCompletionDetails } from "./formatters/completion.js";
import { getPartyFinderDetails } from "./formatters/partyFinder.js";
import {
  getDisplayStringValue,
  getLocalizedLabel,
  getNotificationStartsAt,
  getRecordValue,
} from "./formatters/values.js";
import { humanizeIdentifier, truncateForDiscord } from "./notificationText.js";
import type { NotificationDeliveryData } from "./types.js";

type Options = { fullpartyWebBaseUrl: string };
type Context = {
  data: NotificationDeliveryData;
  payload: Record<string, unknown>;
  options: Options;
  title: string;
  host: string | undefined;
  startsAt: string | undefined;
  groupIcon: string | undefined;
  banner: string | undefined;
  actionUrl: string | undefined;
  runUrl: string | undefined;
  discordUrl: string | undefined;
};

// These layouts intentionally cover only the notification types approved in the workshop.
const applicationStyles: Record<string, { color: number; title: string }> = {
  "applications.cancelled": {
    color: 10991030,
    title: "Your application to this run has been Cancelled",
  },
  "applications.declined": {
    color: 16731983,
    title: "Your application to this run has been Denied",
  },
  "applications.submitted": {
    color: 8453888,
    title: "Your application to this run has been Submitted",
  },
  "applications.updated": {
    color: 2325220,
    title: "Your application to this run has been Updated",
  },
  "applications.withdrawn": {
    color: 10991030,
    title: "Your application to this run has been Withdrawn",
  },
  "applications.new_for_review": { color: 33023, title: "New Application needs review" },
};

const assignmentTypes = new Set([
  "assignments.assigned",
  "assignments.designation_assigned",
  "assignments.designation_removed",
  "assignments.marked_missing",
  "assignments.missing_restored",
  "assignments.on_bench",
  "assignments.returned_to_queue",
  "assignments.roster_published_assigned",
  "assignments.roster_published_bench",
]);
const runTypes = new Set([
  "runs.cancelled",
  "runs.completed",
  "runs.party_finder_published",
  "runs.starting_now",
  "runs.starting_soon",
]);

export function buildV2NotificationMessage(
  type: string,
  data: NotificationDeliveryData,
  options: Options,
): MessageCreateOptions | undefined {
  if (
    !Object.hasOwn(applicationStyles, type) &&
    !assignmentTypes.has(type) &&
    !runTypes.has(type)
  ) {
    return undefined;
  }

  const context = createContext(data, options);
  const applicationStyle = applicationStyles[type];
  const components = applicationStyle
    ? applicationMessage(context, applicationStyle)
    : assignmentTypes.has(type)
      ? assignmentMessage(context)
      : runMessage(context);

  limitText(components);
  return {
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [], repliedUser: false },
    components,
  };
}

function createContext(data: NotificationDeliveryData, options: Options): Context {
  const payload = getRecordValue({ payload: data.notification.payload }, "payload") ?? {};
  const actionUrl = safeUrl(data.notification.action_url, options);
  const isApplication = data.notification.type.startsWith("applications.");
  return {
    data,
    payload,
    options,
    title:
      first(
        payload.run_title,
        data.notification.params.activity,
        payload.activity_title,
      ) ?? "Your run",
    host: first(payload.group_name, data.notification.params.group, payload.group_slug),
    startsAt: getNotificationStartsAt(data)?.split(" (")[0],
    groupIcon: safeUrl(payload.group_icon_url, options),
    banner: safeUrl(payload.banner_image_url, options),
    actionUrl,
    // An application's action URL can point at an account page instead of its run.
    runUrl:
      safeUrl(payload.run_url, options) ??
      (!isApplication ||
      data.notification.type === "applications.new_for_review" ||
      isRunUrl(actionUrl)
        ? actionUrl
        : undefined),
    discordUrl: safeUrl(payload.discord_url, options),
  };
}

function applicationMessage(
  context: Context,
  style: { color: number; title: string },
): APIMessageTopLevelComponent[] {
  const { data, payload, options } = context;
  const review = data.notification.type === "applications.new_for_review";
  const body: APIComponentInContainer[] = [
    text(`## ${style.title}`),
    ...runHeader(context, false, true),
  ];
  if (review) {
    const character = characterName(context);
    const applicant = first(payload.applicant_name);
    if (character || applicant) {
      body.push(
        separator(),
        section(
          [
            "## Character",
            character ? `**${plain(character)}**` : undefined,
            applicant ? `-# ${plain(applicant)}` : undefined,
          ]
            .filter(Boolean)
            .join("\n"),
          safeUrl(payload.character_avatar_url, options),
        ),
      );
    }
    const count = data.notification.params.count;
    if (typeof count === "number" && Number.isFinite(count))
      body.push(text(`**Applications waiting:** ${String(count)}`));
  }
  const components: APIMessageTopLevelComponent[] = [container(style.color, body)];
  const reason = first(data.notification.params.reason, payload.review_reason);
  if (reason) components.push(hostNote(reason));
  const applicationUrl = safeUrl(payload.application_url, options) ?? context.actionUrl;
  appendLinks(
    components,
    review
      ? [
          ["View Run", context.runUrl],
          ["View User Profile", safeUrl(payload.applicant_profile_url, options)],
        ]
      : [
          ["View Application", applicationUrl],
          ["View Run", context.runUrl],
          ["Discord Server", context.discordUrl],
        ],
  );
  return components;
}

function assignmentMessage(context: Context): APIMessageTopLevelComponent[] {
  const { data, payload, options } = context;
  const type = data.notification.type;
  const detailed =
    type === "assignments.assigned" || type.startsWith("assignments.roster_published_");
  const bench = type === "assignments.roster_published_bench";
  const copy = assignmentCopy(context);
  const body: APIComponentInContainer[] = [
    section(
      [`## ${copy.title}`, copy.summary, hostLine(context)].filter(Boolean).join("\n"),
      context.groupIcon,
    ),
  ];
  const schedule = context.startsAt
    ? `:fpclock: **Scheduled Start:** ${context.startsAt}`
    : undefined;
  if (detailed) {
    const position = bench ? "Bench" : assignmentPosition(context);
    const roster = getRecordValue(payload, "roster");
    const filledGroup =
      !bench && roster?.is_fill_in === true
        ? first(roster.filled_group_label)
        : undefined;
    const scheduleAndPosition = [
      schedule,
      position ? `:fppin: **Position**: ${plain(position)}` : undefined,
      filledGroup ? `-# Filling in for ${plain(filledGroup)}` : undefined,
    ]
      .filter(Boolean)
      .join("\n");
    if (scheduleAndPosition) body.push(separator(), text(scheduleAndPosition));
    const character = characterName(context);
    const extraFields = getAssignmentExtraFields(data);
    const detailComponents: APIComponentInContainer[] = [];
    if (character)
      detailComponents.push(
        section(
          `### Character\n${plain(character)}`,
          safeUrl(payload.character_avatar_url, options),
        ),
      );
    // Six fields keep the full message inside Discord's 40 component limit, including accessories.
    for (const field of extraFields
      .filter((field) => !isPositionLabel(field.label))
      .slice(0, 6)) {
      if (detailComponents.length > 0) detailComponents.push(separator(false));
      detailComponents.push(
        section(
          `### ${plain(field.label, 100)}\n${plain(field.value)}`,
          rosterFieldIcon(context, field.label),
        ),
      );
    }
    if (detailComponents.length > 0) body.push(separator(), ...detailComponents);
  } else if (schedule) {
    body.push(text(schedule));
  }
  const components: APIMessageTopLevelComponent[] = [
    container(detailed ? (bench ? 14453347 : 6539064) : 15378965, body),
  ];
  const isDesignation =
    type === "assignments.designation_assigned" ||
    type === "assignments.designation_removed";
  const actionLabel = isDesignation
    ? "View run"
    : type.startsWith("assignments.roster_published_")
      ? "View Roster"
      : type === "assignments.returned_to_queue"
        ? "View Queue"
        : "View Assignment";
  appendLinks(components, [
    [
      actionLabel,
      isDesignation ? context.actionUrl : (context.actionUrl ?? context.runUrl),
    ],
    ["Discord Server", context.discordUrl],
  ]);
  return components;
}

function assignmentCopy(context: Context): { title: string; summary: string } {
  const title = plain(context.title);
  const designation = plain(getDesignationDisplayName(context.data) ?? "Designation");
  switch (context.data.notification.type) {
    case "assignments.assigned":
      return {
        title: ":fpupdate: Roster assignment updated",
        summary: `You were assigned on the roster for **${title}**.`,
      };
    case "assignments.roster_published_assigned":
      return {
        title: ":fpupdate: Roster published",
        summary: `Your roster assignment for **${title}** has been published.`,
      };
    case "assignments.roster_published_bench":
      return {
        title: ":fpupdate: Roster published",
        summary: `Your bench assignment for **${title}** has been published.`,
      };
    case "assignments.designation_assigned":
      return {
        title: `${designation} assigned`,
        summary: `You were assigned as ${designation} on the roster for **${title}**.`,
      };
    case "assignments.designation_removed":
      return {
        title: `${designation} removed`,
        summary: `You are no longer assigned as ${designation} for **${title}**.`,
      };
    case "assignments.marked_missing":
      return {
        title: "Marked missing",
        summary: `You were marked as missing for **${title}**.`,
      };
    case "assignments.missing_restored":
      return {
        title: "Missing status cleared",
        summary: `You are no longer marked as missing for **${title}**.`,
      };
    case "assignments.on_bench":
      return {
        title: "Moved to bench",
        summary: `You were moved to the bench for **${title}**.`,
      };
    default:
      return {
        title: "Returned to queue",
        summary: `You were returned to the queue for **${title}**.`,
      };
  }
}

function runMessage(context: Context): APIMessageTopLevelComponent[] {
  const components: APIMessageTopLevelComponent[] = [
    container(
      9917105,
      runHeader(context, context.data.notification.type !== "runs.completed"),
    ),
  ];
  switch (context.data.notification.type) {
    case "runs.completed":
      components.push(completionCard(context));
      break;
    case "runs.party_finder_published":
      components.push(partyFinderCard(context));
      break;
    case "runs.cancelled": {
      components.push(
        container(14171198, [
          text(
            "### Run Cancelled\nThe Host has cancelled this run, reach out to their discord if you have any questions.",
          ),
        ]),
      );
      const reason = first(
        context.data.cancellation_reason,
        context.payload.cancellation_reason,
        context.data.notification.params.reason,
      );
      if (reason) components.push(hostNote(reason));
      break;
    }
    case "runs.starting_now":
      components.push(
        container(16096779, [
          text(
            "### Run Starting now\nMake sure to join the group and their VC if it's available.",
          ),
        ]),
      );
      break;
    default: {
      const relative = context.startsAt?.replace(/:F>$/u, ":R>");
      components.push(
        container(16096779, [
          text(
            `### Run Starting soon\nThe Run is starting ${relative ?? "soon"}, make sure to prepare and join the group on time.`,
          ),
        ]),
      );
    }
  }
  appendLinks(components, [
    ["View Run", context.runUrl],
    ["Discord Server", context.discordUrl],
  ]);
  return components;
}

function hostNote(reason: string): APIContainerComponent {
  return container(9917105, [text(`## Note from the Host\n${plain(reason, 1800)}`)]);
}

function completionCard(context: Context): APIContainerComponent {
  const completion = getRunCompletionDetails(context.payload);
  const completedAt = completion?.completedAt?.split(" (")[0];
  const lines = [`## Run Complete${completedAt ? ` - ${completedAt}` : ""}`];
  if (completion?.furthestProgress)
    lines.push(`- ** :fppercent: Progress:**\n> ${plain(completion.furthestProgress)}`);
  if (completion?.milestones.length) {
    lines.push("- ** :fpflag: Milestones:**");
    lines.push(
      ...completion.milestones.map(
        (milestone) =>
          `> • ${plain(milestone.label)}${milestone.details.length ? `: ${plain(milestone.details.join(", "))}` : ""}`,
      ),
    );
  }
  if (completion?.entryMode)
    lines.push(`- **Entry mode:** ${plain(completion.entryMode)}`);
  if (
    completion?.progressRecordedAt &&
    completion.progressRecordedAt !== completion.completedAt
  )
    lines.push(`- **Progress recorded:** ${completion.progressRecordedAt}`);
  if (completion?.progressNotes)
    lines.push(`- **Notes:** ${plain(completion.progressNotes, 1200)}`);
  const progressUrl = safeUrl(completion?.progressLinkUrl, context.options);
  if (progressUrl) lines.push(`- **Progress link:** ${progressUrl}`);
  return container(5431915, [text(lines.join("\n"))]);
}

function partyFinderCard(context: Context): APIContainerComponent {
  const details = getPartyFinderDetails(context.data);
  const partyFinder = getRecordValue(context.payload, "party_finder");
  const world = [
    details.world,
    first(partyFinder?.datacenter),
    first(partyFinder?.region),
  ]
    .filter(Boolean)
    .join(" - ");
  const characterWorld = first(partyFinder?.character_world);
  const lines = ["### Party Finder posted"];
  if (world) lines.push(`- **World**: ${plain(world)}`);
  if (details.character)
    lines.push(
      `- **Character**: ${plain(details.character)}${characterWorld ? ` @ ${plain(characterWorld)}` : ""}`,
    );
  if (details.password)
    lines.push(
      `- **Password**: \`${details.password.replaceAll("`", "'").replaceAll("\n", " ")}\``,
    );
  if (details.publishedAt) lines.push(`- **Posted at**: ${details.publishedAt}`);
  if (details.status) lines.push(`- **Status**: ${plain(details.status)}`);
  return container(2987775, [text(lines.join("\n"))]);
}

function runHeader(
  context: Context,
  withClock = false,
  application = false,
): APIComponentInContainer[] {
  const components: APIComponentInContainer[] = [];
  if (context.banner)
    components.push({
      type: ComponentType.MediaGallery,
      items: [{ media: { url: context.banner } }],
    });
  const lines = [`## ${plain(context.title)}`, hostLine(context)];
  if (context.startsAt)
    lines.push(
      `${application ? "\n" : ""}${withClock ? ":fpclock: " : ""}**Scheduled Start:** ${context.startsAt}`,
    );
  components.push(section(lines.filter(Boolean).join("\n"), context.groupIcon));
  return components;
}

function hostLine(context: Context): string | undefined {
  return context.host ? `-# Hosted By: ${plain(context.host)}` : undefined;
}

function characterName(context: Context): string | undefined {
  const character = first(
    context.data.notification.params.character,
    context.payload.character_name,
  );
  const world = first(context.payload.character_world);
  return character ? `${character}${world ? ` [${world}]` : ""}` : undefined;
}

function assignmentPosition(context: Context): string | undefined {
  const { payload, data } = context;
  const roster = getRecordValue(payload, "roster");
  const selected = getRecordValue(roster, "selected_position");
  const position =
    first(
      data.notification.params.position,
      getLocalizedLabel(selected?.label),
      selected?.name,
    ) ??
    getAssignmentExtraFields(data).find((field) => isPositionLabel(field.label))?.value;
  const slot = first(
    data.notification.params.slot,
    payload.slot_label,
    roster?.slot_label,
  );
  const group = first(data.notification.params.slot_group, payload.slot_group);
  const party = slot ?? group;
  return position && party && position !== party
    ? `${position} - ${party}`
    : (position ?? party);
}

function rosterFieldIcon(context: Context, label: string): string | undefined {
  const roster = getRecordValue(context.payload, "roster");
  const fields = roster?.fields;
  if (!Array.isArray(fields)) return undefined;
  for (const value of fields as unknown[]) {
    const field = getRecordValue({ value }, "value");
    if (
      !field ||
      (getLocalizedLabel(field.label) ??
        (typeof field.key === "string" ? humanizeIdentifier(field.key) : undefined)) !==
        label
    )
      continue;
    return safeUrl(
      first(
        field.icon_url,
        getRecordValue(field, "value")?.icon_url,
        getRecordValue(field, "meta")?.icon_url,
      ),
      context.options,
    );
  }
  return undefined;
}

function isPositionLabel(label: string): boolean {
  return /^(?:raid )?position$/iu.test(label);
}

function first(...values: unknown[]): string | undefined {
  return values.map(getDisplayStringValue).find((value) => value !== undefined);
}

function safeUrl(value: unknown, options: Options): string | undefined {
  const raw = getDisplayStringValue(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw, `${options.fullpartyWebBaseUrl.replace(/\/$/u, "")}/`);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      url.href.length <= 2048
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function isRunUrl(value: string | undefined): boolean {
  return (
    value !== undefined && /\/(?:activities|runs)\/[^/]+/u.test(new URL(value).pathname)
  );
}

function plain(value: string, limit = 800): string {
  return escapeMarkdown(truncateForDiscord(value, limit));
}

function text(content: string): APITextDisplayComponent {
  return { type: ComponentType.TextDisplay, content };
}

function section(content: string, image: string | undefined): APIComponentInContainer {
  return image
    ? {
        type: ComponentType.Section,
        components: [text(content)],
        accessory: { type: ComponentType.Thumbnail, media: { url: image } },
      }
    : text(content);
}

function separator(divider = true): APIComponentInContainer {
  return { type: ComponentType.Separator, divider, spacing: divider ? 2 : 1 };
}

function container(
  color: number,
  components: APIComponentInContainer[],
): APIContainerComponent {
  return { type: ComponentType.Container, accent_color: color, components };
}

function appendLinks(
  components: APIMessageTopLevelComponent[],
  links: [string, string | undefined][],
): void {
  const buttons = links.flatMap(([label, url]) =>
    url && url.length <= 512
      ? [
          {
            type: ComponentType.Button as const,
            style: ButtonStyle.Link as const,
            label,
            url,
          },
        ]
      : [],
  );
  if (buttons.length)
    components.push({ type: ComponentType.ActionRow, components: buttons });
}

function limitText(components: APIMessageTopLevelComponent[]): void {
  const texts: APITextDisplayComponent[] = [];
  function collect(
    component: APIMessageTopLevelComponent | APIComponentInContainer,
  ): void {
    if (component.type === ComponentType.TextDisplay) texts.push(component);
    if (
      component.type === ComponentType.Container ||
      component.type === ComponentType.Section
    )
      component.components.forEach(collect);
  }
  components.forEach(collect);
  // Reserve space for send-time custom emoji expansion while preserving each section's heading.
  let remaining = 3500;
  texts.forEach((item, index) => {
    const allowance = Math.max(1, remaining - (texts.length - index - 1) * 60);
    item.content = truncateForDiscord(item.content, allowance);
    remaining -= item.content.length;
  });
}
