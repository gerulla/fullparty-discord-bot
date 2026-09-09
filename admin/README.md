# FullParty Bot Admin

This npm workspace contains the admin API, telemetry persistence/query layer,
shared contracts, and Vue dashboard. It runs inside the bot's HTTP process.

## Layout

- `src/server/`: token validation, `/admin/api/*` routes, static `/admin/` serving.
- `src/server/store/`: separate telemetry writes, record queries, aggregate metrics,
  guild queries, and row mappings. `SqliteAdminStore` composes these repositories.
- `src/shared/`: TypeScript DTOs and Zod response schemas shared with the UI.
- `ui/src/pages/`: independently loaded sidebar pages; login loads without charts.
- `ui/src/composables/`: session, dashboard metrics, and cancellable log polling.
- `ui/src/api/`: authenticated request client with validation and timeouts.
- `tests/`: API-client regression tests. Root tests exercise the bot/API contract
  using real in-memory SQLite data.

## Boundary

The package exports `@fullparty/admin`, `@fullparty/admin/contracts`, and
`@fullparty/admin/schemas`. It does not import Discord or files under the bot's
`src/`. `src/server/ports.ts` describes the runtime callbacks supplied by the bot
adapter in the root `src/admin/integration.ts`.

The bot owns and opens SQLite connections. This package owns its telemetry schema
and migrations. Admin reporting also reads the bot's settings, failures, member
cache, and automation-queue tables as a shared database read model; root integration
tests cover that schema contract. It does not independently create those tables.

Changing a response requires updating the shared contract/schema, server response,
and relevant UI consumer together. New notification/automation behavior belongs
in the bot, not in this package.

## Development

From the repository root:

```sh
npm ci
npm run build
npm run dev:watch     # bot/API on its configured HTTP port
```

In a second terminal:

```sh
npm run admin:dev     # Vite serves /admin/, proxies /admin/api to port 3000
```

The dev server prints its available URL. If the bot uses a different local port,
update the target in `ui/vite.config.ts`. Production has no Vite process.

```sh
npm run typecheck
npm run lint
npm test
npm run format:check
npm run build
```

To run just this workspace's checks:

```sh
npm run typecheck --workspace @fullparty/admin
npm run test --workspace @fullparty/admin
npm run build --workspace @fullparty/admin
```

## Deployment

Existing `npm ci`, `npm run build`, and `npm start` commands remain the deployment
entry points. The root build emits bot code into `dist/`, API code into
`admin/dist/`, and browser assets into `admin/ui/dist/`. Deploy them together with
the workspace manifests and dependencies. `/admin/`, token login, and API URLs
are unchanged. The dashboard never manufactures demo metrics in production.

The browser keeps the bearer token in session storage as before. Treat it as a
credential: use HTTPS, restrict who can retrieve it, and log out on shared devices.
