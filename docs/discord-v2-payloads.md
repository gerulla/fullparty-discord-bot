# Discord V2 notification payloads

The bot renders the approved workshop designs from event data. FullParty should
continue sending the existing signed `POST /events` requests; it does not need to
send Discord components, colors, message flags, or emoji IDs.

This document describes the fields the implementation reads. The new fields below
were inferred from the saved designs and are supported by the bot, but have not
been verified against live FullParty deliveries. Existing-field compatibility was
checked against this repository's formatters and test fixtures.

## Coverage

These 21 notification types use V2. Types without a saved V2 design retain their
existing presentation.

| Family           | `data.notification.type` values                                                                                                                                                                                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Applications (6) | `applications.cancelled`, `applications.declined`, `applications.submitted`, `applications.updated`, `applications.withdrawn`, `applications.new_for_review`                                                                                                                                        |
| Assignments (9)  | `assignments.assigned`, `assignments.designation_assigned`, `assignments.designation_removed`, `assignments.marked_missing`, `assignments.missing_restored`, `assignments.on_bench`, `assignments.returned_to_queue`, `assignments.roster_published_assigned`, `assignments.roster_published_bench` |
| Runs (5)         | `runs.cancelled`, `runs.completed`, `runs.party_finder_published`, `runs.starting_now`, `runs.starting_soon`                                                                                                                                                                                        |
| Account (1)      | `user.discord_login`                                                                                                                                                                                                                                                                                |

The 13 saved automation designs cover nickname sync (success, partial, failed,
skipped), role assignment (success with a new or existing role, partial, failed,
skipped), and role cleanup (success, failed, skipped, success after cancellation).
Their counts, role IDs, role names, failure details, and outcomes come from the
bot's execution results. FullParty does not need to supply these presentation
values. Cleanup displays the single role and outcome without role counters.

The ten newly approved designs also cover the standalone `user.discord_login`
welcome, `discord.user_app.installed`, `discord.user_app.disconnected`, `/link`
account/server instructions and confirmations, the unlinked-account warning, and
the unlinked-server warnings for run listing and role assignment. The standalone
and notification-delivery login events share the same welcome renderer.

## Account and server linking: new optional fields

Existing payloads still deliver complete setup instructions. The saved designs
also contain buttons and a guide image whose real destinations were not present
in the existing payload contract. Supply the following fields for those elements:

| Event or API response                                                 | Exact field path                                 | Purpose and fallback                                                                                                                                                                                  |
| --------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discord.user_app.disconnected` webhook                               | `data.feedback_url`                              | **Leave Feedback** button. Omitted when missing, null, or unusable.                                                                                                                                   |
| `discord.user_app.disconnected` webhook                               | `data.disconnect_guide_image_url`                | Guide image beneath the Authorized Apps instructions. Supply a permanent, publicly accessible image URL, not the workshop's expiring Discord attachment URL. Omitted when missing, null, or unusable. |
| Guild-link API response used by `/link`                               | `data.group.slug` or `data.group_slug`           | Automatically builds **Bot Settings** as `/groups/<slug>/dashboard/discord-integration`.                                                                                                              |
| Guild-link API response used by `/link`                               | `data.discord_settings_url`                      | Optional override for **Bot Settings**. A usable explicit URL takes precedence over the derived URL.                                                                                                  |
| `user.discord_login` or `discord.user_app.installed` webhook          | `data.account_settings_url`                      | **Account Settings** destination. Optional override of `/settings` on `FULLPARTY_WEB_BASE_URL`.                                                                                                       |
| User-link API response used by `/link`                                | `data.account_settings_url`                      | Same optional account-settings override for manual-link confirmation.                                                                                                                                 |
| Legacy `discord.notification.delivery` with type `user.discord_login` | `data.notification.payload.account_settings_url` | Same optional account-settings override for the wrapped login welcome.                                                                                                                                |

These URLs accept HTTP(S) absolute URLs or site-relative paths resolved against
`FULLPARTY_WEB_BASE_URL`, with no embedded credentials. Button URLs are limited to
512 characters and the guide image URL to 2048 characters after resolution.
Missing, null, or unsafe optional URLs do not block delivery. The `/settings`
default follows existing repository examples; confirm that route on the website
or supply an override. `/link` without a token has no API response, so its account
settings button uses that default.

The **Finish Discord Setup** button uses the existing `data.discord_app_install_url`
on the standalone login event. That required field retains its existing absolute
HTTP(S) validation. The legacy notification variant uses
`data.notification.action_url`, falling back to the static
`/auth/discord-app/user/redirect` path. The DM `/link` instructions also use that
static path against `FULLPARTY_WEB_BASE_URL`; no new payload is needed.

Example disconnect payload additions:

```json
{
  "event": "discord.user_app.disconnected",
  "data": {
    "discord_user": { "id": "234567890123456789" },
    "feedback_url": "https://fullparty.gg/feedback",
    "disconnect_guide_image_url": "https://assets.example.com/discord/disconnect-guide.png"
  }
}
```

Example **guild-link API response** (not a webhook field):

```json
{
  "data": {
    "group": { "slug": "example-raiders" }
  }
}
```

With the production website base URL, that slug produces
`https://fullparty.gg/groups/example-raiders/dashboard/discord-integration`.
An unwrapped link response with `group.slug` or `group_slug` also works. The slug
is encoded as one path segment. No extra API request or cached run lookup is
needed. The button is omitted if neither a usable URL nor slug is supplied.

The existing guild-link fixtures do not confirm that FullParty already returns
the slug. Guild run payloads include it, but the bot does not persist it in server
settings, so make sure the link response contains it. No separate
`discord_settings_url` field is needed when the slug is present.

The feedback and image destinations above are illustrative; send the website's
real routes. No additional user IDs or names are needed for these designs.
`discord.user_app.installed` still accepts `data.welcome_message`, now as a custom
introduction inside the V2 message, followed by the settings and help sections.
The message copy remains English. Recipient selection, first-login skipping,
webhook signatures, delivery queuing/deduplication, and command visibility are
unchanged. Older queued messages retain their original presentation.

## Expanded guild schedules: run API fields

Selecting **Expanded** in `/setup` applies to manual `/postruns` and both automatic
schedule modes. This format uses the existing
`GET /api/integrations/v1/bot/discord-guilds/<guild_id>/upcoming-runs` response,
not a `discord.notification.delivery` payload. The run-change webhook still needs
only `data.discord_guild_id`; the bot fetches the current run list separately.

Each run receives a purple Components V2 card. These are the preferred response
fields; existing title, count, date and URL aliases continue to work:

| Response field                                               | Display / fallback                                                                                                                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data[].title`                                               | Run title; existing `activity_title` and activity-name fallbacks remain supported.                                                                                                    |
| `data[].target_prog_point_label`                             | Optional progress label appended to the title.                                                                                                                                        |
| `data[].starts_at`                                           | ISO 8601 timestamp with time zone. Discord renders both the viewer's local date/time and relative time; missing or invalid dates show “Time TBD”.                                     |
| `data[].participant_count` and `data[].participant_capacity` | Current and maximum participants. Missing counts show `?`.                                                                                                                            |
| `data[].applications_count`                                  | Number of applications. Missing counts show `?`.                                                                                                                                      |
| `data[].host.discord_user_id`                                | Host mention without a ping. Without a Discord ID, `host.character.name` / `host.character.world` or `host.name` supplies the label.                                                  |
| `data[].host.avatar_url`                                     | **New optional presentation field:** host profile thumbnail. Falls back to `host.character.avatar_url`; omitted when absent, null, blank, or unsafe.                                  |
| `data[].urls.overview`                                       | **View Run** button destination. Also accepts `urls.run`, `urls.activity`, `urls.view`, `run_url`, `activity_url`, `url`, or `link`. Missing or unsafe destinations omit this button. |
| `data[].urls.apply`                                          | **Apply Now** button destination. Existing application/action URL aliases remain supported; missing or unsafe destinations omit this button.                                          |
| `meta.group.name`, `meta.group.slug`                         | Full schedule footer; an explicit `meta.urls.schedule` can override the derived schedule URL.                                                                                         |

To complete the thumbnail, include a publicly accessible HTTP(S) image URL:

```json
{
  "host": {
    "discord_user_id": "234567890123456789",
    "avatar_url": "https://assets.example.com/characters/host.jpg",
    "character": {
      "name": "Ari Vale",
      "world": "Lich"
    }
  }
}
```

This is an excerpt of one `data[]` run object. The bot passes the image URL to
Discord and does not perform a Lodestone lookup for live schedules. The format
picker and workshop use a fixed sample avatar independently of the production API.
Missing thumbnails do not prevent posting. Long run lists are capped to Discord's
component and text limits, with an overflow count and link to the full schedule.

## Fields to add or confirm on the website

In the following tables, `payload` means
`data.notification.payload` in the wrapped webhook format. The existing unwrapped
delivery format is also accepted; omit the leading `data.` in that case.

These are optional presentation fields. Add the fields applicable to each event
to reproduce its complete design. A missing image, date, detail, or usable URL
omits that element; it does not prevent the notification being delivered. Missing
run text falls back to existing fields, then to “Your run”. The bot never fills
missing information with the workshop's sample people, images, or links.

| New or newly explicit path              | Used by                                                    | Value                                                                                                                    |
| --------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `payload.run_title`                     | All 20 types                                               | Full display title including a custom run name. Optional override of existing activity text.                             |
| `payload.group_name`                    | All 20 types                                               | Human-readable hosting group name. Existing group text remains a fallback.                                               |
| `payload.group_icon_url`                | All 20 types                                               | Hosting group's logo shown as a thumbnail.                                                                               |
| `payload.banner_image_url`              | Application and run types                                  | Banner image shown above the run details.                                                                                |
| `payload.run_url`                       | Application and run buttons; assignment fallback           | Canonical website URL for this run. Supply this separately from an account/application page.                             |
| `payload.discord_url`                   | Application types except new-for-review; assignments; runs | Host's Discord invite or accessible server/channel URL.                                                                  |
| `payload.application_url`               | Application types except new-for-review                    | URL for the recipient's application. Falls back to `data.notification.action_url`.                                       |
| `payload.character_world`               | New-for-review and detailed roster cards                   | Character world, appended as `[World]`. Send a bare character name in the existing character field to avoid duplication. |
| `payload.character_avatar_url`          | New-for-review and detailed roster cards                   | Character portrait thumbnail.                                                                                            |
| `payload.applicant_name`                | `applications.new_for_review`                              | Applicant's FullParty display name shown beneath the character.                                                          |
| `payload.applicant_profile_url`         | `applications.new_for_review`                              | Applicant's FullParty profile URL.                                                                                       |
| `payload.roster.fields[].meta.icon_url` | Detailed roster cards                                      | Image for that specific field, such as Class or Phantom job. The existing field structure is reused.                     |
| `payload.party_finder.datacenter`       | `runs.party_finder_published`                              | Data center displayed after the PF world, e.g. `Light`. Spelling is `datacenter`.                                        |
| `payload.party_finder.region`           | `runs.party_finder_published`                              | Region displayed after the data center, e.g. `EU`.                                                                       |
| `payload.party_finder.character_world`  | `runs.party_finder_published`                              | PF host character's world, shown after `@`. It can differ from the PF listing's `world`.                                 |

“Detailed roster cards” means `assignments.assigned`,
`assignments.roster_published_assigned`, and
`assignments.roster_published_bench`. Benched publication always displays
`Position: Bench`. Other roster notifications use the compact status design.

For fill-ins on `assignments.assigned` and
`assignments.roster_published_assigned`, send `payload.roster.is_fill_in: true`
and `payload.roster.filled_group_label`, for example `"Party B"`. The bot keeps
the supplied slot label (`"Fill in 1 (Party B)"`) in the position summary and adds
`Filling in for Party B` beneath it. The target party comes from
`filled_group_label`, not the roster's own `group_label` (`"Fill-ins"`). An absent,
null, or blank target label omits this extra line. Benched publication never shows
the fill-in line. Keep both notification type fields consistent with the event.

For new-for-review notifications, `data.user` and `data.discord_user` identify the
**recipient/reviewer**, not the applicant. Populate the explicit applicant fields
from the application being reviewed. The bot does not infer the applicant from
the recipient.

Only populate `data.notification.payload.discord_url` when the hosting group has
a linked Discord server. Otherwise send `null` or omit the field. Every
**Discord Server** button is optional: a missing, null, empty, or whitespace-only
URL hides the button entirely. The bot never substitutes the run URL or a default
Discord server, and the other action buttons remain available.

Notification URLs may be absolute HTTP(S) URLs or paths resolved against
`FULLPARTY_WEB_BASE_URL`. Use HTTPS URLs reachable by Discord for images. Media
URLs are limited to 2,048 characters; button URLs must fit within 512 characters
after resolution. Invalid or unusable URLs are omitted. The bot passes image URLs
to Discord; it does not download, crop, or host images. To keep banners thin,
provide an already cropped banner asset, for example a 3:1 image.

## Existing fields retained

These paths are already understood by existing formatters or appear in local
fixtures. They do not need to be renamed. Send the actual event values, not the
example values from the workshop.

| Information                           | Existing paths / precedence                                                                                                                                                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Activity/run title fallback           | `data.notification.params.activity`, then `payload.activity_title`                                                                                                                                                           |
| Host name fallback                    | `data.notification.params.group`, then `payload.group_slug`                                                                                                                                                                  |
| Scheduled start                       | `data.notification.params.starts_at` or `start_at`; then `payload.starts_at` or `start_at`; then those keys under `payload.run` or `payload.activity`. Use an ISO 8601 timestamp with a time zone.                           |
| Character name                        | `data.notification.params.character`, then `payload.character_name`                                                                                                                                                          |
| Application host note                 | `data.notification.params.reason`, then `payload.review_reason`                                                                                                                                                              |
| Applications waiting                  | Numeric `data.notification.params.count` on new-for-review                                                                                                                                                                   |
| Designation                           | `payload.designation_label`, then legacy `data.notification.params.designation`, then humanized `payload.designation_key`; for example `Trapper` or `Raid Leader`                                                            |
| Roster position                       | `data.notification.params.position`, then `payload.roster.selected_position.label` or `name`, then a roster field named `Position` or `Raid Position`                                                                        |
| Party/group label beside position     | `data.notification.params.slot`, then `payload.slot_label`, then `payload.roster.slot_label`; fallback to `params.slot_group` or `payload.slot_group`. If no position is available, the slot/group label is displayed alone. |
| Roster detail fields                  | `payload.roster.fields[]` with `key`, `label`, `display_value`; existing `value`/`meta` display fallbacks remain supported                                                                                                   |
| Roster field images                   | `payload.roster.fields[].icon_url`, then `.value.icon_url`, then `.meta.icon_url`                                                                                                                                            |
| Roster fallback without usable fields | `data.notification.params.class`, `class_shorthand`, and `position`                                                                                                                                                          |
| Completion summary                    | `payload.completion.completed_at`, `furthest_progress_label` or `furthest_progress_key`, `furthest_progress_percent`                                                                                                         |
| Completion milestones                 | `payload.completion.milestones[]` with `milestone_label` or `milestone_key`, `best_progress_percent`, `kills`, `notes`                                                                                                       |
| Extra completion information          | `payload.completion.progress_entry_mode`, `progress_recorded_at`, `progress_notes`, `progress_link_url`                                                                                                                      |
| Party Finder                          | `data.notification.params.character`, `world`, `password`; fallbacks from `payload.party_finder.character_name`, `world`, `password`; `payload.party_finder.published_at`                                                    |

Roster labels may be strings or localized objects such as `{ "en": "Class" }`.
Use `display_value` for the intended visible text. Class and Phantom job are
ordinary roster fields: there is no new top-level phantom-job object. Fields named
`Position` or `Raid Position` are shown in the position summary rather than repeated
as detail cards. Up to six other roster fields are rendered.

Primary action buttons continue to use `data.notification.action_url`: it is the
assignment/roster/queue destination for roster types and a run link fallback for
run types. For application types, send both `payload.application_url` and
`payload.run_url` when they differ. The application run link only falls back to an
action URL recognizable as `/runs/<id>` or `/activities/<id>`; new-for-review also
accepts its action URL as the run destination. The new-for-review profile button
only uses the explicit applicant profile URL.

## Designation assignment and removal

The same `discord.notification.delivery` event and V2 status layout cover:

| `payload.designation_key` | Display label | Activity   |
| ------------------------- | ------------- | ---------- |
| `trapper`                 | Trapper       | BA and DRS |
| `darter`                  | Darter        | BA         |
| `duelist`                 | Duelist       | DRS        |

Send `assignments.designation_assigned` with
`payload.designation_assigned: true`, and
`assignments.designation_removed` with
`payload.designation_assigned: false`. Set both `data.type` and
`data.notification.type` to the matching notification type. The type selects the
assigned/removed message; the display label never controls behavior. The key
remains the machine identifier, with a humanized key used only as a fallback when
neither the display label nor the legacy params label is available. Existing Raid
Leader and future designation keys continue to work without a bot-side allowlist.
FullParty determines designation availability for each activity.

The DM recipient is `data.discord_user.id`. The **View run** button uses
`data.notification.action_url`; send the actual run URL there. If it is missing or
unusable, the button is omitted rather than linking to a different payload URL.
No webhook subscription or Discord permission changes are required.

Continue including the existing positive integer `data.notification_delivery_id`
and `data.notification_event_id` in the full delivery envelope. The production
SQLite DM queue deduplicates queued/sent notifications by delivery ID and Discord
recipient, including after a restart, for the existing 30-day sent-job retention
period. Repeating a delivery returns `duplicate: true` without adding another DM.
Use a new delivery ID for a distinct assignment/removal notification. Temporary
network and HTTP 408/5xx failures retry after 5 and 30 seconds, up to three total
attempts within 60 seconds of the first attempt, using the same persisted Discord
nonce and delivery ID. Outcomes that remain uncertain stop with
`DM_DELIVERY_UNCERTAIN`; their original delivery ID stays reserved for the same
30-day retention period to prevent blind duplicate sends. Only definite failed
jobs can be resubmitted with their original ID. Signature verification still applies to
every request, including duplicates. The optional in-memory/no-queue development
path does not provide persistent deduplication.

## Full notification example

This is a fictional enriched new-for-review delivery. It includes reusable roster
fields to show their exact shape; those field cards are rendered by the three
detailed roster types, not by the new-for-review design. Include only applicable
fields for an individual event. Replace example URLs with real destinations and
assets. The recipient is reviewer `42`; the applicant shown in the message is Ari.

```json
{
  "event": "discord.notification.delivery",
  "request_id": "notification-456-delivery-123",
  "data": {
    "notification_delivery_id": 123,
    "notification_event_id": 456,
    "type": "applications.new_for_review",
    "category": "applications",
    "user": {
      "id": 42,
      "name": "Run Reviewer"
    },
    "discord_user": {
      "id": "100000000000000002"
    },
    "notification": {
      "type": "applications.new_for_review",
      "category": "applications",
      "action_url": "/en/groups/aether-collective/activities/123",
      "params": {
        "activity": "Futures Rewritten (Ultimate)",
        "group": "Aether Collective",
        "character": "Ari Vale",
        "starts_at": "2026-10-16T18:00:00Z",
        "count": 2,
        "position": "Healer 1",
        "slot_group": "Party B"
      },
      "payload": {
        "run_title": "Futures Rewritten — Friday progression",
        "group_name": "Aether Collective",
        "group_icon_url": "https://assets.example.com/groups/aether-collective.png",
        "banner_image_url": "https://assets.example.com/runs/fru-banner-1200x400.webp",
        "run_url": "/en/groups/aether-collective/activities/123",
        "application_url": "/en/account/applications",
        "discord_url": "https://discord.gg/example",
        "character_name": "Ari Vale",
        "character_world": "Twintania",
        "character_avatar_url": "https://assets.example.com/characters/ari-vale.jpg",
        "applicant_name": "Ari",
        "applicant_profile_url": "/en/users/ari",
        "roster": {
          "fields": [
            {
              "key": "character_class",
              "label": "Class",
              "display_value": "White Mage",
              "meta": {
                "icon_url": "https://assets.example.com/classes/whm.webp"
              }
            },
            {
              "key": "phantom_job",
              "label": "Phantom job",
              "display_value": "Phantom Berserker",
              "meta": {
                "icon_url": "https://assets.example.com/phantom-jobs/berserker.webp"
              }
            }
          ]
        }
      }
    }
  }
}
```

For roster publication, use `assignments.roster_published_assigned` or
`assignments.roster_published_bench` in both `type` positions and category
`assignments`. Set `notification.action_url` to the roster destination. Applicant
fields can be omitted. For a declined application, use `applications.declined` and
include `notification.params.reason` or `notification.payload.review_reason` when
there is a host note.

For a cancelled-run DM, send the cancellation reason alongside `data.notification`:

```json
{
  "event": "discord.notification.delivery",
  "data": {
    "type": "runs.cancelled",
    "category": "runs",
    "discord_user": { "id": "234567890123456789" },
    "cancellation_reason": "Not enough participants.",
    "notification": {
      "type": "runs.cancelled",
      "category": "runs",
      "params": {
        "activity": "Saturday DRS",
        "group": "Example Raiders"
      },
      "action_url": "/en/runs/123"
    }
  }
}
```

`data.cancellation_reason` takes precedence over
`data.notification.payload.cancellation_reason`, which takes precedence over the
legacy `data.notification.params.reason`. The first nonblank string becomes a
separate purple **Note from the Host** container, matching the application notices.
If no usable reason is present, that optional container is omitted. This affects
the `runs.cancelled` DM only; the guild role-cleanup webhook is unchanged.

For `runs.party_finder_published`, this optional addition produces the expanded
world/character lines without changing existing fields:

```json
{
  "party_finder": {
    "world": "Lich",
    "datacenter": "Light",
    "region": "EU",
    "character_name": "Ari Vale",
    "character_world": "Twintania",
    "password": "8246",
    "published_at": "2026-10-16T17:55:00Z"
  }
}
```

Place that object inside `data.notification.payload`.

## Automation event addition

Add optional `data.run_url` to `discord.guild.run_reminder`,
`discord.guild.run_completed`, and `discord.guild.run_cancelled` to display the
View Run button. It must be an absolute HTTP(S) URL of at most 512 characters.
An absent or invalid URL is ignored and does not stop automation. All other
required event fields and execution behavior remain the same.

```json
{
  "event": "discord.guild.run_completed",
  "data": {
    "discord_guild_id": "100000000000000001",
    "run_id": 123,
    "group_slug": "aether-collective",
    "run_url": "https://fullparty.gg/en/groups/aether-collective/activities/123"
  }
}
```

For cancellation, change `event` to `discord.guild.run_cancelled`. For reminders,
add `run_url` alongside the existing `run_id`, `starts_at`, `reminder_type`, `type`,
and participant fields. The role-assignment API response can include the same
`run_url` beside its run data for manually triggered automation logs. Cleanup
still relies only on the guild/run mapping and does not require participant data.

## Icons and Discord-specific behavior

The bot resolves known workshop icon names at delivery from its cached Discord
emoji. Application emoji are preferred over guild emoji with the same name; the
bot loads its application emoji on startup. Upload the purple icons with the
names below to the bot application, or make them available in a guild the bot can
see. When a named icon is unavailable, the message uses a readable Unicode
fallback. The website does not need to send icon IDs.

`fpcheck`, `fperrorx`, `fpupdate`, `fpnote`, `fpdocument`, `fppercent`,
`fpatsymbol`, `fpnametag`, `fpflag`, `fppin`, `fpclock`, `fpedit`, `fpchart`.

The bot sets `IS_COMPONENTS_V2` (`32768`) and sends text and images inside
components. V2 messages cannot also carry legacy top-level content/embeds, and a
message's V2 flag cannot later be removed. See Discord's
[Using Message Components](https://docs.discord.com/developers/components/using-message-components).

Website and Discord destinations use link buttons (`style: 5`). The workshop's
primary-colored Discord button used a design-only `custom_id`; production uses
its real URL. Link buttons cannot also use `custom_id`. The bot's existing
Failure Details button remains interactive. See the official
[component reference](https://docs.discord.com/developers/components/reference#button).

The bot limits rendered text and roster fields to Discord's message limits,
preserves V2 flags/components in the durable DM queue, and disables mentions on
these messages. Older queued legacy DMs remain readable. Rendering missing
optional data gracefully does not relax the existing required webhook fields or
authentication.
