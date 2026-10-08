# fullparty-discord-bot

Discord.js management bot for Fullparty.gg.

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
npm run dev              # start the compiled bot
npm run dev:build        # build and start the bot
npm run dev:watch        # start the bot with tsx watch
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

## Server resources

Every member of a linked Discord server can use `/info` to post a paginated list of
its FullParty resources. `/info name:bridges` posts an exact match publicly in the
channel where the command was used. Partial matches return a private, paginated
search list; no matches and request errors are private too. No moderator role or
personal account link is required.
Run `npm run commands:deploy:global` to register new commands after deploying.

The bot requests ten entries per page and follows `meta.next_page` when Next is
clicked, retaining the original search query. Only the command's author can change
pages; controls expire after 15 minutes or a restart. Public resource-page buttons
are taken from the list/search response's top-level `components` array, when supplied
(at most four action rows, leaving one for pagination). No public URL is guessed
for private groups. Exact resources retain their own `data.components` (up to five
rows). Resource embeds and supplied link buttons are validated before posting.
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
- Pending notification DMs and cooldown timestamps survive restarts. An abrupt
  crash between Discord accepting a DM and the local completion write can still
  cause a repeat delivery; this is not exactly-once delivery. Failed DM jobs are
  terminal, not retried forever. Completed/failed queue history is pruned after
  30 days during normal queue activity/startup.

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

Notification delivery DMs are rendered as Discord embeds by the notification
message service. Supported notification copy lives in
`src/notifications/notificationCopy.json`; unknown notification types fall back
to a readable title generated from the type key.

In the running bot, HTTP 200 with `result.queued: true` acknowledges that the DM
has been saved for background delivery; it does not confirm that Discord has
received it. `result.rateLimited` indicates whether the per-user cooldown is
currently active. Discord delivery failures appear in bot logs and DM telemetry.

For debugging, the bot stores the most recent signed `POST /events` payload or
the latest `/link`, `/applications`, or `/runs` API response/error in memory.
Run `/payload` to view it; payloads are not sent as automatic DMs.

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

Delivery uses the existing durable DM queue and per-user limit (by default, two DMs
per five minutes, shared with other DMs to that account). HTTP 200 with
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

The command opens an ephemeral setup panel for:

- Bot-log channel
- Run announcement channel
- Upcoming raider role
- Discord-name to FF14-character-name sync preference

New temporary run roles use `Run: <English activity type name> <HH:mm UTC>`.
The name comes from `data.run.activity_type.name.en` in reminder webhooks or
`data.activity_type.name.en` in the run API, never the custom run display title.
Older payloads missing the English name fall back to `Run: #<run_id> <HH:mm UTC>`.
Existing roles keep their names and remain tracked and cleaned up by run ID.

Settings are stored locally in SQLite:

```env
DATABASE_PATH=data/fullparty-discord-bot.sqlite
```

### Automatic schedule refresh

In `/setup`, select **Automatic schedule**, choose a channel, choose **Daily**, **Every
2-6 days**, or **Weekly**, then enable it. Manage Server permission and a linked
FullParty group are required. It is disabled by default and uses a separate channel
setting from the Member-Facing Channel.

The bot's background scheduler checks for due jobs every minute and processes one
guild at a time. Enabling or changing schedule settings makes that guild due; after
a successful post, the next refresh is one to seven days later. SQLite preserves
the message ID and next due time across restarts. Missed days produce one catch-up
refresh, not a backlog of repeated posts. No OS crontab, extra process, or command
registration is needed for this setting; deploy/restart the bot normally. The new
SQLite table is migrated automatically.

The job fetches and validates the replacement first, then deletes only its previous
automatic post and sends a fresh plain-text `/postruns` summary. It does not delete
manual posts, send host pings, or add embeds/buttons. Disabling leaves the last post
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

Guild settings snapshots and `discord.guild.settings_updated` also support:

```json
{
  "schedule_refresh_enabled": true,
  "schedule_refresh_channel_id": "123456789012345678",
  "schedule_refresh_interval_days": 7
}
```

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
FULLPARTY_API_BASE_URL=http://fullparty.test/api
FULLPARTY_WEB_BASE_URL=http://fullparty.test
```

The shared `/link token:<token from FullParty>` command works in two contexts:

- In a DM, it links the invoking Discord user to FullParty.
- In a guild channel, it links that Discord server to FullParty and replies
  ephemerally so the token/result stay private.

If `/link` is run without a token, the bot explains where to generate the right
code: user settings for account linking, or the group Discord linking flow for
server linking. If a FullParty-backed command is used before the Discord user is
linked, the bot prompts them to run `/link token:<code>` first.

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
