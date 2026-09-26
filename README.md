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

The local development Docker database (used in this repo's dev environment):

```powershell
docker run -d --name dentalistics-mysql -p 3306:3306 `
  -e MYSQL_ROOT_PASSWORD=dev_root_pw_2026 -e MYSQL_DATABASE=dentalistics `
  --health-cmd="mysqladmin ping -h 127.0.0.1" --health-interval=10s `
  --health-timeout=5s --health-retries=10 mysql:8.4
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start server with hot reload (tsx watch) |
| `npm run migrate` | Apply pending SQL migrations from `migrations/` |
| `npm test` | Run unit + integration tests (Vitest) |
| `npm run lint` | ESLint over the repository |
| `npm run typecheck` | TypeScript type checking (no emit) |
| `npm run build` | Compile to `dist/` |
| `npm run verify` | lint + typecheck + test + build (M1 gate) |
| `npm start` | Run the compiled server from `dist/` |

## Environment variables

See `.env.example`. Required: `DB_HOST`, `DB_USER`, `DB_PASSWORD` (may be
empty), `DB_NAME`. Optional: `NODE_ENV`, `PORT`, `LOG_LEVEL`, `DB_PORT`,
`MIGRATIONS_DIR`, `TEST_DB_*` (enables DB integration tests; when unset those
tests are reported as skipped).

## Endpoints

- `GET /` – service descriptor
- `GET /health` – 200 `{status:"ok", database:"up|unconfigured"}` when healthy,
  503 `{status:"degraded", database:"down"}` when the database is unreachable

## Notes

- Secrets are never logged (logger redacts password/token/secret-like keys)
  and `.env` is git-ignored.
- Migrations are applied explicitly via `npm run migrate`; the server does not
  auto-migrate at startup.
