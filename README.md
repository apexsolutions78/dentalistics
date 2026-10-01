# Dentalistics

Dental clinic follow-up and appointment automation platform (TypeScript, Express 5, MySQL 8).

## Prerequisites

- Node.js >= 20 (developed on v24)
- MySQL 8 (local dev uses Docker: see below)

## Setup

```powershell
npm install
Copy-Item .env.example .env   # then edit DB credentials
```

The local development Docker database (used in this repo's dev environment).
Pick your own root password and put the same value in `.env` (`.env` is
git-ignored; never write real credentials into tracked files):

```powershell
docker run -d --name dentalistics-mysql -p 3306:3306 `
  -e MYSQL_ROOT_PASSWORD=your_dev_password -e MYSQL_DATABASE=dentalistics `
  --health-cmd="mysqladmin ping -h 127.0.0.1" --health-interval=10s `
  --health-timeout=5s --health-retries=10 mysql:8.4
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start server with hot reload (tsx watch) |
| `npm run migrate` | Apply pending SQL migrations from `migrations/` |
| `npm run seed:admin` | Create/update the platform admin from `ADMIN_EMAIL`/`ADMIN_PASSWORD` |
| `npm test` | Run unit + integration tests (Vitest) |
| `npm run lint` | ESLint over the repository |
| `npm run typecheck` | TypeScript type checking (no emit) |
| `npm run build` | Compile to `dist/` |
| `npm run verify` | lint + typecheck + test + build (M1 gate) |
| `npm start` | Run the compiled server from `dist/` |
| `npm run dev:frontend` | Vite dev server for `frontend/` |
| `npm run build:frontend` | Build the frontend to `frontend/dist` |
| `npm run verify:frontend` | Frontend lint + test + build |

## Environment variables

See `.env.example`. Required: `DB_HOST`, `DB_USER`, `DB_PASSWORD` (may be
empty), `DB_NAME`. Optional: `NODE_ENV`, `PORT`, `LOG_LEVEL`, `DB_PORT`,
`MIGRATIONS_DIR`, `TRUST_PROXY` (set `1`/`true` behind a reverse proxy so
rate limiting keys on real client IPs), `UI_DIST_DIR`, `REMINDER_TICK_MS`,
`TEST_DB_*` (enables DB integration tests; when unset those tests are
reported as skipped).

## Endpoints

- `GET /` – service descriptor
- `GET /health` – 200 `{status:"ok", database:"up|unconfigured"}` when healthy,
  503 `{status:"degraded", database:"down"}` when the database is unreachable

## Webhooks (provider-side configuration)

Configure the public HTTPS URL of your deployment at each provider:

- Telephony: `POST /api/webhooks/telephony/:provider/:orgId` -
  signature-verified with the provider's signing secret.
- WhatsApp: `GET /api/webhooks/whatsapp/:orgId` (verification handshake
  using the configured verify token) and
  `POST /api/webhooks/whatsapp/:orgId` (`X-Hub-Signature-256` verified
  against the app secret).

Provider credentials are entered in Settings -> Communication providers
(write-only, stored per clinic, never returned by the API). Incoming
webhook traffic is rate-limited per client IP.

## Monitoring and logs

- `GET /health` - `200 {"status":"ok"}` when healthy,
  `503 {"status":"degraded"}` when the database is unreachable.
- Authenticated observability endpoints under
  `/api/organizations/:orgId/observability/*` (automation, communication,
  webhook, error and audit logs, failed jobs, diagnostics) for clinic
  users; platform-wide error/audit logs under `/api/admin/observability/*`.
- Logs are structured JSON on stdout with secret values redacted; capture
  them with your process manager. No external uptime or log-aggregation
  integration ships with this repository.

## Backups and rollback

- No automated database backup ships with this repository - arrange
  backups (for example a scheduled `mysqldump`) on the server and test a
  restore before launch.
- Migrations are forward-only (there are no down migrations). Application
  rollback = redeploy the previous build; database rollback = restore a
  backup.

## Production deployment (outline)

1. `npm install`, then `npm run build` and `npm run build:frontend`.
2. Configure `.env`: `NODE_ENV=production`, database credentials,
   `TRUST_PROXY=1` behind a reverse proxy, `PORT` (see `.env.example`).
3. `npm run migrate` (explicit; the server does not auto-migrate).
4. First run only: `npm run seed:admin`.
5. `npm start` under a process manager (systemd, pm2, or your hosting
   panel's Node service). Run **one** instance: the automation scheduler
   is in-process, so multiple instances would run jobs twice.
6. Serve over HTTPS: with `NODE_ENV=production` session cookies are
   `Secure`, so browsers only send them over HTTPS.

## Notes

- Secrets are never logged (logger redacts password/token/secret-like keys)
  and `.env` is git-ignored.
- Migrations are applied explicitly via `npm run migrate`; the server does not
  auto-migrate at startup.
