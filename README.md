# fullparty-discord-bot

Discord.js management bot for Fullparty.gg.

The approved application, roster, run, automation, account welcome, and linking
messages use Discord Components V2.
Other responses keep their existing formatting. See [the V2 payload contract](docs/discord-v2-payloads.md)
for the exact website fields, example webhooks, image URLs, and custom emoji setup.

## Stack

- Discord.js 14
- TypeScript with strict compiler settings
- Vitest for tests and coverage
- ESLint and Prettier
- Zod-backed environment validation
- SQLite for local bot state
- Vue 3 / Vite admin dashboard in the `@fullparty/admin` npm workspace

## Project layout

```text
src/
  application/       # startup, dependency composition, shutdown
  bot/               # Discord client and event wiring
  commands/          # slash commands
  http/              # routing, signatures, payload validation, responses
  guildIntegration/  # website settings, snapshots, unlink handling
  guildAutomation/   # role/nickname services, queue, permissions, presentation
  guildMembership/   # member cache and scheduler
  notifications/     # formatting registry, focused formatters, JSON text catalog
  dm/                # DM delivery, durable queue, per-user cooldown
  health/            # health checks and failure reporting
  database/          # versioned SQLite migrations
  admin/             # bot-to-admin adapters and telemetry recording only
admin/
  src/server/        # admin HTTP handlers and telemetry repositories
  src/shared/        # API contracts and runtime validation schemas
  ui/src/            # Vue pages, composables, API client, chart helpers
  tests/             # admin-specific tests
tests/               # bot and integration tests
```

Services receive their dependencies explicitly; repositories own persistence;
formatters own presentation. The admin package does not import bot implementation
files. The bot supplies runtime information through the admin package's ports.
See [admin/README.md](admin/README.md) for the workspace and API boundary details.

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env` with your Discord application details and Fullparty API settings.

## Scripts

```bash
npm run dev              # build bot + dashboard, then start locally
npm run dev:build        # alias for npm run dev
npm run dev:watch        # build dashboard, then watch bot source with Node + tsx
npm run commands:deploy  # register slash commands with Discord
npm run commands:deploy:global # force global command registration for user installs/DMs
npm run commands:deploy:guild  # force guild-scoped command registration for quick testing
npm run typecheck        # strict TypeScript, including Vue templates
npm run lint             # ESLint
npm test                 # bot, integration, and admin tests
npm run coverage         # Vitest coverage report
npm run build            # build bot + admin API + Vue dashboard
npm run admin:dev        # Vite dashboard, API proxy to localhost:3000
npm start                # run compiled bot
```

Run these commands from the repository root. `npm ci` installs both workspaces.
Production still uses one bot process: `npm start` serves `/events`, `/health`,
`/admin/api/*`, and the built dashboard at `/admin/` on the existing HTTP port.

For local testing, run `npm run dev` and open `http://127.0.0.1:3000/admin/`.
Use `ADMIN_API_TOKEN` from your local `.env` to sign in, or retrieve the generated
token with `!token` if no stable token is configured. Stop the bot with Ctrl+C.
Use a separate Discord test application and keep only one process running for it.
The start scripts load `.env` before Node initializes so startup settings such as
local certificate trust are applied.

If Windows PowerShell blocks `npm.ps1` because scripts are disabled, use the
Windows command launcher instead. This requires no execution-policy changes:

```powershell
npm.cmd run dev:watch
```

Use `npm.cmd` in place of `npm` for the other commands above as well.

## Server resources

Every member of a linked Discord server can use `/info` to browse a private,
paginated Components V2 list of its FullParty resources. Each entry has a **Show**
button that posts the selected resource publicly in the channel, then dismisses the
private list. Failed posts leave the list available for another attempt. Rapid Show
clicks cannot post twice, and successful posts retire the list's controls even if
Discord cannot delete the private message. `/info name:bridges` also posts an exact match publicly in
the channel where the command was used. Partial matches return a private,
paginated search list; no matches and request errors are private too. No moderator
role or personal account link is required.
Run `npm run commands:deploy:global` to register new commands after deploying.

The bot requests up to eight entries per page and follows `meta.next_page` when
Next is clicked, retaining the original search query. Only the command's author can
use its pagination and Show controls; they expire after 15 minutes or a restart.
Each entry displays `/info <name>` and the optional embed title, with the resource
title beneath it in smaller text. The actual slash-command option is still `name`.

List and search rows use `embed_title` beside the command and `resource_title`
on the smaller second line, without extra lookups. `title` remains an alias for
the embed title if `embed_title` is omitted:

```json
{
  "command_name": "drs-preparation",
  "title": "Before entering DRS",
  "embed_title": "Before entering DRS",
  "resource_title": "DRS Preparation Guide"
}
```

These explicit fields take precedence; null or blank `resource_title` omits the
second line. When `resource_title` is absent, older nested `embed.title` and
`embed.author.name` summaries remain supported and take precedence over the legacy
flat pair (`embed_title` for the first line, `title` for the second). For
older responses without both titles, the bot looks up the visible page's exact
resources. Optional metadata resolution has a one-second budget per page, a shared
four-request limit across guilds, and no waiting queue when that limit is full.
Successful metadata is cached for five minutes and failures for 30 seconds, with
at most 256 entries per API client. These lookups do not download attachments;
if they fail or time out, the list remains usable with the available titles and
its Show buttons. Timed-out metadata requests are cancelled.

Public resource-page links are taken from the list/search response's top-level
`components` array and displayed as compact footer links. Disabled links are shown
as unavailable. No public URL is guessed for private groups. Exact resources,
including those selected with Show, retain their existing embed and
`data.components` (up to five rows). Resource embeds and supplied links are validated
before posting.
Declared assets are fetched from the matching FullParty
API endpoint with the integration token, then uploaded with their original filenames
so `attachment://` references work. Ordinary HTTP(S) image URLs are passed through
without fetching them or sending credentials. Authenticated requests reject redirects.

The bot needs View Channel, Send Messages (Send Messages in Threads for threads),
and Embed Links; resources with assets also require Attach Files. Downloads are
limited to the channel's per-file upload allowance and 25 MiB combined per resource.
Missing resources, access failures, invalid data, and oversized attachments produce
readable errors; diagnostic details go through the existing failure reporter.

## Reliability and state

- API requests have a 15-second deadline; HTTP, transport, and malformed-response
  failures remain distinguishable. Browser requests are cancelled on logout.
- Error reporting retains nested error messages, codes, causes, and stacks.
  Structured secret fields are redacted. Expected Discord permission/access
  failures are recorded without degrading overall health.
- Startup failures and shutdown close resources in reverse order, continuing
  cleanup if one resource fails. Active workers finish before their stores close.
- SQLite migrations run automatically. Back up the database before deployment;
  do not delete it for this upgrade. Old incompatible template-override tables
  are retained with a `_legacy` suffix for recovery.
- Webhook DMs are saved to the persistent queue before HTTP 200 is returned,
  including messages within the per-user allowance. Discord delivery runs in the
  background so slow Discord requests do not hold the webhook response open.
- Pending notification DMs, send nonces, attempt timestamps, and cooldowns survive
  restarts. Retried sends reuse the same nonce with Discord's `enforceNonce` option.
  Temporary network and HTTP 408/5xx failures retry after 5 and 30 seconds, up to
  three total attempts, only within 60 seconds of the first attempt. Discord's
  nonce deduplication is short-lived; this is not exactly-once delivery. Uncertain
  sends that cannot safely retry, including old attempted jobs without nonce
  protection, stop with `DM_DELIVERY_UNCERTAIN` for operator review. Their delivery
  IDs remain reserved so repeated webhooks cannot start another send. Definite
  permanent rejections (such as blocked DMs) remain terminal and can be resubmitted
  after the underlying problem is fixed. Retry state and recipient order survive
  restarts, and retrying a completion database write never repeats the Discord send.
  Completed/failed queue history, including uncertain outcomes, is retained for
  30 days; indexed cleanup runs at startup and at most once per five minutes during
  normal queue activity.
- Queued guild reminders are also saved before any Discord request. Their
  automation-started notice runs on the worker's first attempt, so duplicate
  webhooks and worker retries do not repeat that notice.
- `/clearrole` only deletes active FullParty run roles tracked for the current
  server. Manage Server and configured bot-moderator access do not permit deleting
  unrelated roles. If tracking cannot be verified, the command refuses deletion.
- `/link` requires Manage Server when used in a server, before any linking API
  request or settings change. Personal linking in DMs does not require server permissions.

## Fullparty integration endpoint

When the bot is running, it exposes:

```text
GET  /health
GET  /events
POST /events
```

Fullparty should sign webhook events with the webhook signing secret. The bot
expects:

```http
Content-Type: application/json
X-FullParty-Timestamp: <unix timestamp>
X-FullParty-Signature: sha256=<hmac>
```

Signed healthchecks should call `GET /events` with:

```http
X-FullParty-Event: integration.healthcheck
X-FullParty-Timestamp: <unix timestamp>
X-FullParty-Signature: sha256=<hmac>
```

The local `GET /health` endpoint is still available for simple process checks.

The HMAC input is:

```text
<timestamp>.<raw request body>
```

Laravel example:

```php
$timestamp = (string) time();
$body = $requestBodyJson;
$signature = 'sha256=' . hash_hmac(
    'sha256',
    "{$timestamp}.{$body}",
    $webhookSigningSecret
);
```

Example payload:

```json
{
  "event": "discord.user_app.installed",
  "requestId": "optional-idempotency-or-trace-id",
  "data": {
    "discord_user": {
      "id": "123456789012345678"
    },
    "welcome_message": "Welcome to Fullparty.gg."
  }
}
```

Disconnect event payload:

```json
{
  "event": "discord.user_app.disconnected",
  "requestId": "optional-idempotency-or-trace-id",
  "data": {
    "discord_user": {
      "id": "123456789012345678"
    }
  }
}
```

The connection/disconnection messages use V2. Optional `data.account_settings_url`
customizes the installed message's settings button; `data.welcome_message` replaces
its introduction. For disconnection, `data.feedback_url` enables **Leave Feedback**
and `data.disconnect_guide_image_url` adds the removal guide image. Missing URLs
omit those optional elements. See [the V2 payload contract](docs/discord-v2-payloads.md#account-and-server-linking-new-optional-fields).

Notification delivery payload:

```json
{
  "notification_delivery_id": 123,
  "notification_event_id": 456,
  "type": "user.settings.username_updated",
  "category": "account_character_updates",
  "user": {
    "id": 42,
    "name": "Giki"
  },
  "discord_user": {
    "id": "123456789012345678"
  },
  "notification": {
    "type": "user.settings.username_updated",
    "category": "account_character_updates",
    "params": {
      "changed_setting_label_keys": ["general.username"]
    },
    "action_url": "/settings",
    "payload": null
  }
}
```

The bot also accepts the same notification delivery object wrapped as
`{ "event": "discord.notification.delivery", "data": { ... } }`.

Notification delivery DMs use the approved Components V2 designs where available,
with legacy embeds for account/system messages. See
[the V2 payload guide](docs/discord-v2-payloads.md) for supported layouts and fields.
Legacy notification copy lives in `src/notifications/notificationCopy.json`;
unknown notification types fall back to a readable title generated from the type key.

In the running bot, HTTP 200 with `result.queued: true` acknowledges that the DM
has been saved for background delivery; it does not confirm that Discord has
received it. `result.rateLimited` indicates whether delivery currently waits for
per-user pacing or an earlier job's retry backoff. Discord delivery attempts and
failures appear in bot logs and DM telemetry.

The bot's default pacing is five DMs per recipient per five seconds; Discord.js
also handles Discord's own API limits. Override `USER_DM_RATE_LIMIT_COUNT` and
`USER_DM_RATE_LIMIT_WINDOW_MS` if needed. Older deployments with an explicit
`USER_DM_RATE_LIMIT_WINDOW_MS=300000` still wait five minutes until that setting
is updated. Pacing settings, queued messages, completed deliveries, and duplicate
suppression are logged at INFO so accepting an event is distinguishable from
sending its DM.

For debugging, the bot stores the most recent signed `POST /events` payload or
the latest `/link`, `/applications`, or `/runs` API response/error in memory.
Run `/payload` to view it; payloads are not sent as automatic DMs.

### Welcome after the first Discord website login

Send the standalone `user.discord_login` event through the existing signed
`POST /events` endpoint. It sends a welcome DM explaining how to authorize the
FullParty Discord app. The message also introduces `/runs` and `/applications`.

```json
{
  "event": "user.discord_login",
  "data": {
    "user": {
      "id": 123,
      "name": "Example User"
    },
    "discord_user_id": "234567890123456789",
    "locale": "en",
    "discord_app_install_url": "https://fullparty.gg/auth/discord-app/user/redirect",
    "discord_app_installed": false
  }
}
```

The website owns the **first-login-only** rule: after verifying the Discord login,
create this notification once per FullParty user, only if bot setup is incomplete.
Persist that decision on the website so later logins do not create another welcome,
even if setup is still incomplete. Take `discord_user_id` from the verified Discord
identity, not a client-supplied ID. If `discord_app_installed` is `true`, the bot
acknowledges the event with `skipped: true` and
`reason: "discord_app_already_installed"`, without sending setup instructions.

The **Finish Discord Setup** button uses `discord_app_install_url`. Supply
an absolute HTTP(S) URL without credentials, at most 512 characters. The V2 welcome
shows automated setup and a manual `/link token:<code>` alternative. Optional
`data.account_settings_url` overrides the default `/settings` destination for
manual setup. `locale` is accepted but optional;
welcome copy currently uses English for every locale. `user` identifies the
FullParty account; the DM is addressed only to `discord_user_id`.

This standalone payload does not require notification event or delivery IDs. It
uses the existing durable DM queue, rate limits and transient-error retries, but
does not deduplicate repeated webhook submissions because the payload has no
delivery ID. A successful queued response acknowledges storage, not Discord
delivery. The website must prevent repeat first-login submissions.

The earlier `discord.notification.delivery` variant with type `user.discord_login`
is still supported, using `notification.action_url` for the button and its existing
delivery-ID deduplication. Both routes use the same welcome renderer.
`discord.user_app.installed` remains the separate, already-connected welcome.

Discord login alone does not guarantee that the bot can DM the user. Keep these
setup instructions available on the website as well, since Discord can reject the
DM if the user is not reachable or has blocked it. See Discord's
[OAuth2 scopes](https://docs.discord.com/developers/topics/oauth2#shared-resources-oauth2-scopes)
and [DM API](https://docs.discord.com/developers/resources/user#create-dm).

This notification is also listed as `user.discord_login` under **Account and system
notifications** in the response workshop, with V1 and V2 alternatives available.

### Send an admin report

The website can report an issue to the bot owner with a signed `POST /events`:

```json
{
  "event": "discord.admin.report",
  "requestId": "issue-123",
  "data": {
    "title": "Run cleanup delivery failed",
    "message": "Run 123 could not be cleaned up after three delivery attempts.",
    "severity": "error",
    "url": "https://fullparty.gg/admin/issues/123"
  }
}
```

Reports are DMed only to `PAYLOAD_COMMAND_ALLOWED_USER_ID`, the same account used
for `/payload` and `!token`. The payload cannot choose a different recipient. If
that environment variable is unset, the event returns HTTP 503 with
`admin_report_recipient_not_configured`.

`title` (1–256 characters) and `message` (1–4096 characters) are required and trimmed.
`severity` is `info`, `warning`, `error` (default), or `critical`. Optional `url` must
be an absolute HTTP(S) URL, up to 2048 characters; it makes the report title clickable.
The DM is an embed with a severity color and timestamp. Invalid data returns HTTP
400; the same signature headers and HMAC calculation above are required.

Delivery uses the existing durable DM queue and per-user limit (by default, five DMs
per five seconds, shared with other DMs to that account). HTTP 200 with
`result.queued: true` means saved for background delivery, with `queuePosition`
and `nextAttemptAt` in the result. Events and DM outcomes appear in admin telemetry.
Queue persistence failures return an error; Discord delivery failures after
acceptance are recorded in the bot logs and DM telemetry.
The recipient must allow DMs from the bot.

`requestId` is for tracing, not deduplication: resending an accepted report can
send another DM. Deploy/restart the bot to enable this event; no command
registration or new environment variable is needed if the owner ID is already set.

### Clean up a completed or cancelled run

Send a signed `POST /events` request when a run completes:

```json
{
  "event": "discord.guild.run_completed",
  "data": {
    "discord_guild_id": "123456789012345678",
    "run_id": 123
  }
}
```

Use `discord.guild.run_cancelled` for a cancelled run. Cleanup looks up and deletes
the existing role mapped to that guild/run. The guild ID must be a nonempty string
and the run ID a positive integer. Participant data is ignored; missing or malformed
rosters cannot prevent deletion. Optional activity/group metadata is used for logs
when valid and ignored otherwise. Reminder events still validate participant data
for role assignment and nickname syncing.

When the automation queue is configured, the response confirms the cleanup job
was queued; otherwise it contains the cleanup result. Repeated cleanup attempts
skip a role whose mapping is already marked deleted. Requests previously rejected
with HTTP 400 were not queued and must be resent after deploying the fix.

### Sync one run participant

The website can request a role/nickname update for one participant by sending a
signed `POST /events` request with this JSON:

```json
{
  "event": "discord.guild.run_participant_sync",
  "requestId": "run-123-user-234567890123456789",
  "data": {
    "discord_guild_id": "123456789012345678",
    "discord_user_id": "234567890123456789",
    "nickname": "Character Name [Twintania]",
    "run_id": 123
  }
}
```

Use the same `Content-Type`, `X-FullParty-Timestamp`, and `X-FullParty-Signature`
headers and HMAC calculation documented above. Discord IDs must be strings;
`run_id` must be a positive integer. `nickname` is the complete desired nickname,
trimmed and validated to 1–32 characters, with no character/world suffix added.

The bot looks up the **existing active run role** by guild ID and FullParty run ID.
It does not create a role, call the website for run details, or modify any other
participant. Nickname changes respect **Sync Discord Names to FF14** in `/setup`.
The bot needs Manage Roles and a role above the run role; nickname changes also
need Manage Nicknames and a role above the participant's highest role (the server
owner cannot be renamed by the bot).

The event runs immediately and returns the outcome of both operations:

```json
{
  "event": "discord.guild.run_participant_sync",
  "ok": true,
  "requestId": "run-123-user-234567890123456789",
  "result": {
    "discordGuildId": "123456789012345678",
    "discordUserId": "234567890123456789",
    "runId": 123,
    "roleId": "345678901234567890",
    "status": "completed",
    "role": { "status": "updated" },
    "nickname": { "status": "updated" }
  }
}
```

Each operation has status `updated`, `unchanged`, `skipped` (nickname syncing
disabled), or `failed`. Failures include `errorCode` and `message`. The overall
`result.status` is `completed`, `partial`, or `failed`; **HTTP 200 / `ok: true` means
the event was processed, not that both Discord changes succeeded**. A failure in
one operation does not prevent the other. Results appear in automation telemetry
and the configured bot-log channel; individual failures use the failure reporter.

Missing/deleted run mappings return HTTP 409 with `run_role_not_active`. A tracked
role missing from Discord returns 409 with `run_role_unavailable`. A user who is
not in the server returns 404 with `guild_member_not_found`. Invalid payloads
return 400; unavailable run-role storage returns 503. These checks happen before
either update. Permission failures during updates are reported in the result.

The website can retry after resolving a failure: existing membership and an
already-matching nickname are left alone. `requestId` is a tracing value, not a
deduplication key; retries recheck the current state, and a new nickname for the
same participant/run is applied. Deploy/restart the bot to enable this event;
the event itself needs no Discord command registration.

## Guild setup

Server admins can run:

```text
/setup
```

The command requires Manage Server and posts a setup menu in the channel with four sections:

- **Bot Settings:** bot-log channel and bot moderator role.
- **Role Templates:** default run-role template and activity-specific overrides.
- **Nickname Sync:** Discord-name to FF14-character-name sync preference.
- **Schedule Settings:** Schedule Channel for `/postruns` and automatic refresh settings.

Selecting a section edits the same channel message to show its controls. Anyone who
can read the channel can see it; Manage Server permission is still required to use
the controls. Changes save immediately, except the format picker, which has its own
**Save** button. **Back** returns to the section menu.

The **Settings** shortcut under Role Templates uses the group's slug saved by
`/link`. To supply or refresh this for an already-linked server, include the optional
`data.group_slug` alongside `data.settings` in `discord.guild.settings_updated`:

```json
{
  "event": "discord.guild.settings_updated",
  "data": {
    "discord_guild_id": "123456789012345678",
    "group_slug": "example-raiders",
    "settings": {}
  }
}
```

The bot builds `/groups/<slug>/dashboard/discord-integration` on
`FULLPARTY_WEB_BASE_URL`. Omitting `group_slug` preserves the saved value; `null`
clears it. No relinking is required. The shortcut is omitted until a slug is known,
and unlinking clears the saved slug.

New temporary run roles use `Run: <English activity type name> <HH:mm UTC>`.
The name comes from `data.run.activity_type.name.en` in reminder webhooks or
`data.activity_type.name.en` in the run API, never the custom run display title.
Older payloads missing the English name fall back to `Run: #<run_id> <HH:mm UTC>`.
Existing roles keep their names and remain tracked and cleaned up by run ID.

Settings are stored locally in SQLite:

```env
DATABASE_PATH=data/fullparty-discord-bot.sqlite
```

### Schedule modes

In `/setup`, select **Schedule Settings** and choose a **Schedule Mode**:

- **Disabled** (the default): schedules are only posted manually with `/postruns`.
- **Timed Refresh**: automatically refresh every one to seven days. The interval
  selector is shown only in this mode.
- **Run Detection**: automatically refresh when FullParty reports that the group's
  runs have changed, such as a run being added or removed.

Both automatic modes use the same **Schedule Channel** as `/postruns`. There is no
separate automatic channel to configure. Manage Server permission and a linked
FullParty group are required to enable automatic schedules. The shared channel
selector remains available in Disabled mode for manual posts.

The bot's background scheduler checks for due jobs every minute and processes one
guild at a time. Enabling either automatic mode or changing its destination schedules
an initial refresh. After a successful post, Timed Refresh schedules the next run
one to seven days later; Run Detection waits for another website event. SQLite
preserves pending refreshes, the tracked message ID, and retry state across restarts.
Missed timed refreshes produce one catch-up refresh, not a backlog of repeated posts.
No OS crontab, extra process, or Discord command registration is needed; deploy/restart
the bot normally. Existing enabled schedules migrate to Timed Refresh. Existing
Schedule Channel settings are retained; the old automatic channel is used as a fallback
only if no Schedule Channel was configured.

The job fetches and validates the replacement first, then deletes only its previous
automatic post and sends a fresh schedule in the saved **Plain** or **Expanded** format.
It does not delete manual posts or send host pings. Disabling leaves the last post
in place. Leaving/unlinking a server stops refreshes; unlink archives the schedule
state with the other guild data and disables the setting.

The bot needs View Channel, Send Messages, and Read Message History in the selected
channel. Manage Messages is not required to delete its own post. Missing messages
are recreated; failed deletions prevent additional posts. Errors are logged to the
failure reporter/admin telemetry and shown in the setup panel, with an hourly retry.
Repeated identical errors do not repeatedly notify the bot-log channel. Permission
and expected configuration failures do not degrade bot health. Because deletion and
posting are separate Discord requests, a failed send can leave the channel without
a schedule until retry. A crash after sending but before recording its message ID
can still leave a duplicate; Discord's short-lived nonce deduplication reduces, but
does not eliminate, that window.

Guild settings snapshots and `discord.guild.settings_updated` support these settings:

```json
{
  "schedule_mode": "timed_refresh",
  "schedule_format": "plain",
  "run_announcement_channel_id": "123456789012345678",
  "schedule_refresh_interval_days": 7
}
```

`schedule_mode` accepts `disabled`, `timed_refresh`, or `run_detection`.
`run_announcement_channel_id` remains the API name for the single Schedule Channel.
The interval is retained when switching modes, but is used only by Timed Refresh.
The legacy `schedule_refresh_enabled` and `schedule_refresh_channel_id` fields remain
accepted for compatibility; new integrations should send the fields above. An explicit
`schedule_mode` takes precedence. Without it, legacy `false` disables scheduling and
legacy `true` enables Timed Refresh unless Run Detection is already selected. The legacy
channel field updates the shared channel; `run_announcement_channel_id` wins if both
channel fields are supplied.

#### Schedule format

The **Schedule Format** section appears below Automatic Schedule and above the
runtime status. Select **Pick Format** to open a deeper setup page in the same channel
message. Its **Plain / Expanded** dropdown updates a live preview beneath it. Select
**Save** to persist the choice, or **Back** to return to Schedule Settings without
saving the draft. Manage Server permission is required to use these controls.

- **Plain** keeps the existing compact text list.
- **Expanded** displays a purple Components V2 card per run, with the run title,
  localized start time and relative time, participant/application counts, host,
  **View Run** and **Apply Now** website buttons, and the host's profile picture
  when supplied by FullParty. Each button is shown when its destination is available.

Manual `/postruns` and both automatic schedule modes use the saved format. The live
preview and workshop use sample run data; published schedules use the API response.
Long schedules are capped to Discord's message limits and link to the full schedule.
Host mentions are displayed without pinging the host.

The preference persists across restarts and is included in guild snapshots as
`schedule_format`. Send `plain` (the default) or `expanded` in
`discord.guild.settings_updated`; omitting it preserves the saved value. Legacy
`interactive` values remain readable for compatibility and fall back to Plain;
Interactive is not an available picker option yet.

#### Website event for Run Detection

After committing a change to a group's runs, send a signed `POST /events` to the bot:

```json
{
  "event": "discord.guild.runs_changed",
  "data": {
    "discord_guild_id": "123456789012345678"
  }
}
```

Use the existing `X-FullParty-Timestamp` and `X-FullParty-Signature` headers and HMAC
calculation documented above. The bot fetches the group's current
upcoming runs, so no run IDs or run data are required. Emit the event after the website's
database transaction commits, so the subsequent API fetch sees the updated list.

The webhook saves a pending refresh before responding; it does not wait for Discord
to send the schedule. The background scheduler picks it up on its next check, normally
within a minute when it is ready and has no backlog. Events only schedule work for
linked servers using Run Detection with a Schedule Channel configured. Disabled and
Timed Refresh servers keep their selected behavior. The event uses the existing
webhook endpoint and signature verification.

Changes waiting for the same guild are coalesced into one refresh. A new change
received while a refresh is in flight remains pending for another refresh, so it
is not lost. An optional top-level `id` is for correlation only: this event has no
event-ID deduplication, and a retry after a completed refresh can schedule another.

Users can also run these DM-only commands:

```text
/applications
/runs
```

Those commands post normal Discord messages in the DM where they are run. They
call FullParty through `FULLPARTY_API_BASE_URL` using the configured
`FULLPARTY_API_TOKEN`. Keep `FULLPARTY_API_BASE_URL` pointing at the API root;
the client appends `integrations/v1/bot/` for all bot integration operations,
including account/guild linking, run lookups, and resource/asset requests.
For example, an API root of `https://fullparty.gg/api` produces
`https://fullparty.gg/api/integrations/v1/bot/resources/list`.
Do not include `/integrations/v1/bot` in the configured base URL.

Endpoint suffixes, tokens, scopes, and payloads are unchanged. Health requests
still use `<API root>/health`. Inbound FullParty events and notification deliveries
still use the bot's configured webhook URL. The separate member-action namespace
`/api/integrations/v1/*` is not used by these existing bot operations.

For local testing against Laravel, set:

```env
FULLPARTY_API_BASE_URL=https://fullparty.test/api
FULLPARTY_WEB_BASE_URL=https://fullparty.test
HTTP_HOST=127.0.0.1
NODE_OPTIONS=--use-system-ca
```

For HTTPS sites served by Herd, use Node 22.19+ or 24.6+ with
`NODE_OPTIONS=--use-system-ca` to trust the local certificate already installed in Windows.
Keep TLS certificate verification enabled. `api.fullparty.test` is the documentation
host; the bot API is served under `https://fullparty.test/api`.

The shared `/link token:<token from FullParty>` command works in two contexts:

- In a DM, it links the invoking Discord user to FullParty.
- In a guild channel, it links that Discord server to FullParty and replies
  ephemerally so the token/result stay private.

In a DM, `/link` without a token replies with V2 automated and manual setup panels,
including a **Finish Discord Setup** button.
Its static path, `/auth/discord-app/user/redirect`, is resolved against
`FULLPARTY_WEB_BASE_URL` (production: `https://fullparty.gg`). No webhook payload,
cached login event or additional configuration is needed. The website handles
sign-in and Discord authorization. Existing `/link token:<code>` account linking
remains supported.

In a server, `/link` without a token explains where to generate the group link code.
Both account and server confirmations use V2. The guild-link API response's
`data.group.slug` or `data.group_slug` builds the **Bot Settings** button URL as
`/groups/<slug>/dashboard/discord-integration` on `FULLPARTY_WEB_BASE_URL`.
Optional `data.discord_settings_url` overrides it. If neither is available, the
button is omitted. The user-link response may include `data.account_settings_url`
to override `/settings`. Unlinked
account/server warnings point to `/link` in the appropriate context. Only response
content changed; no slash-command registration is required.

## Help

`/help` adapts to its context. DMs list personal commands; server replies list
member commands such as `/info`, with an **Admin commands** section when the user
has relevant access. Run-management entries require Manage Server or the configured
bot moderator role. `/setup` appears only with Manage Server, and `/rolesync` only
with Manage Roles. Server help is ephemeral. The workshop includes all three help
layouts; actual admin entries are filtered to the invoking member's permissions.
`/ping` remains available but is omitted from server member help. `/faq` is
temporarily disabled in both runtime routing and command registration, and omitted
from every help layout. Its text remains in `src/commands/faq.ts` and the workshop.
After deploying, rerun command registration in each previously used scope to remove
any existing `/faq` entry from Discord's command picker.

## Copying role membership

Use the server-only `/rolesync` command to give a role to every member who has another
role. Select the roles in Discord's role picker (you can search by name or ID):

```text
/rolesync give-role-id:runpingsA to-users-with-role-id:runpingsB
```

This adds `runpingsA` to members with `runpingsB`, including offline members. It keeps
`runpingsB` and every other existing role. Members who already have `runpingsA` are
skipped, so the command can be rerun. The private result reports matched, added,
already-assigned, and failed counts; individual failures are logged and do not stop
the remaining assignments. This is a one-time copy, not ongoing synchronization.

The caller and bot need **Manage Roles**. The destination role must be below the
bot's highest role and the caller's highest role (except for the server owner).
Discord-managed roles and `@everyone` cannot be the destination. No FullParty link
is required. The bot's **Server Members Intent** must be enabled to fetch all members.
Register the new command after deployment with `npm run commands:deploy:global`.

## Discord install model

This bot is scaffolded for both user-installed and guild-installed command
metadata. For release, register commands globally so Discord can expose them to
user installs:

```env
DISCORD_COMMAND_REGISTER_SCOPE=global
```

You can also force global registration from any environment:

```bash
npm run commands:deploy:global
```

For faster development iteration, you can register into one test guild:

```env
DISCORD_COMMAND_REGISTER_SCOPE=guild
DISCORD_GUILD_ID=your-test-guild-id
```

Or force guild registration:

```bash
npm run commands:deploy:guild
```

Guild-scoped registration is useful during development, but user-installed apps
and bot DMs require global commands.

## Discord response workshop

The separate development bot can render a message payload directly in Discord:

```text
!json {"embeds":[{"title":"Run confirmed","description":"Your place is ready.","color":5763719}]}
```

Send this in a **DM with the development bot** from the account configured in
`PAYLOAD_COMMAND_ALLOWED_USER_ID`. Enable `DEV_JSON_ENABLED=true` in that bot's
`.env` with `NODE_ENV=development`, then restart it. No slash command registration
or new privileged Discord intent is required. The feature defaults to disabled
and is always disabled in production/test environments.

Paste the workshop's **Copy JSON** output after `!json`; JSON code blocks and
saved-version objects containing `message` are also accepted. Both V1 embeds and
V2 components work, with V2 inferred when its component types are present. The
preview suppresses mentions, ignores ephemeral flags in DMs, and gives buttons
and selects preview-only actions. Link buttons keep their destination. Use hosted
HTTPS image/media URLs: this text command does not upload local workshop files.
The pasted command must fit within your Discord message length limit. Malformed
JSON and Discord validation errors are returned as readable replies.

Run `npm.cmd run preview:discord` (or `npm run preview:discord` outside PowerShell)
and open <http://127.0.0.1:4318/>. This builds the message catalogue from fictional
fixtures and starts a separate local editor. Generating the catalogue is offline;
the editor server reads the repository's `.env` for the optional DM sender and
does not start another bot session.
Set `PREVIEW_PORT` to use another port.

Choose **Add Version V1** for the message/embeds editor, or **Add Version V2** for
the component layout editor. V2 starts with a conversion of the original text,
embeds, and controls into a draft layout. Its Layout tab supports containers,
sections, text, thumbnails, media galleries, files, separators, buttons, and selects.
Buttons, selects, and thumbnails added at the top level get their required row or
section automatically. Uploaded V2 assets also get a visible media/file component.
Saved alternatives show their V1/V2 type and reopen in the matching editor. Conversion
is a starting point: embed field grids, author/footer icons, polls, and stickers are
not reproduced as their original V1 structures. Review the layout and limit warnings.
Both editors include attachments, delivery settings, and a live preview.
The JSON tab preserves additional payload
properties. Common Discord limits are shown as advisory warnings, so unfinished
designs can be saved. The local rendering approximates Discord; use **Send Version**
to check the current draft in Discord itself.

**Send Version**, beside **Save Version**, sends the current draft (including unsaved
edits) to `PAYLOAD_COMMAND_ALLOWED_USER_ID` using the development bot's `DISCORD_TOKEN`.
It requires `DEV_JSON_ENABLED=true` and `NODE_ENV=development`; credentials stay on
the local server. Sending does not save the version. The button displays delivery
success or Discord's validation error, and blocks repeat clicks while sending.
If a connection fails, check your DMs before manually retrying.

V1 and V2 messages, hosted media URLs, and uploaded workshop attachments are supported.
Uploads are sent from the editor's stored bytes, with at most 10 files and 8 MiB
combined. File paths and remote attachment downloads are rejected. Mentions are
suppressed and interactive controls use preview-only actions, as with `!json`.
The JSON can exceed Discord's pasted-message length limit; Discord's actual message
and component limits still apply. The bot does not need to be connected for sending,
but it must be running to respond to preview button/select interactions.

**Save Version** persists alternatives and uploaded files in
`data/discord-preview/versions.json`, alongside the generated catalogue. Rebuilding
preserves this file. It is local, ignored by Git, and separate from the bot database.
Saved alternatives can be edited, duplicated, removed, or restored with **Undo remove**.
**Export alternatives** includes the library and local assets; **Import JSON** imports
a library as new alternatives or a single message into the open draft. Individual
message JSON exports contain only the payload, not local attachment bytes.

Use `npm.cmd run preview:discord:test` to check the editor's storage, API, rendering,
and common-limit diagnostics. Existing contact-sheet images are static reference
exports; new alternatives appear in the interactive catalogue.
