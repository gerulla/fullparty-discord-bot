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

For debugging, the bot stores the most recent signed `POST /events` payload or
the latest `/link`, `/applications`, or `/runs` API response/error in memory.
Run `/payload` to view it; payloads are not sent as automatic DMs.

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

Settings are stored locally in SQLite:

```env
DATABASE_PATH=data/fullparty-discord-bot.sqlite
```

Users can also run these DM-only commands:

```text
/applications
/runs
```

Those commands post normal Discord messages in the DM where they are run. They
call FullParty through `FULLPARTY_API_BASE_URL` using the configured
`FULLPARTY_API_TOKEN`. `FULLPARTY_API_BASE_URL` should point at the API root.
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
