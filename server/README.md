# Malik POS API (foundation)

This is the first backend foundation for central PostgreSQL storage, staff authentication, location-scoped records, and idempotent event ingestion. The React application now has an opt-in **Settings → Multi-computer sync** panel for API login and manual local-first snapshot transfer. Existing POS screens still use localStorage, so sync is not automatic or real-time; starting this service does **not** enable reliable offline operation or multi-branch synchronization.

## Requirements

- Node.js 22+
- PostgreSQL 16+
- A private network or HTTPS reverse proxy. Never expose PostgreSQL directly to the internet.

## Start locally

1. Set a strong database password and create a database named `malik_pos` owned by a dedicated user.
2. Copy `.env.example` to `.env` and fill in real values. Do not commit secrets.
3. Copy `server/.env.example` to `server/.env` and replace every placeholder with strong, private values. The `server` script loads this file automatically.
4. For local PostgreSQL via Docker, run `docker compose --env-file server/.env up -d db`. Keep the database bound to localhost for development.
5. Run `npm install`, then `npm run server`.
6. Verify `GET /health`, then sign in with the bootstrap account using `POST /api/auth/login`.

The bootstrap administrator is created only when the username does not already exist. Store credentials in a secret manager, rotate the bootstrap password after first use, and terminate TLS at a trusted reverse proxy.

## API

- `POST /api/auth/login` — username/password login; returns an 8-hour signed bearer token.
- `GET /api/me` — current authenticated user.
- `GET /api/records?entity=orders` — records for the signed-in user's location.
- `POST /api/sync/push` — atomically ingests up to 500 events, deduplicated by event UUID. Admins/managers can sync all entity types; cashiers are restricted to orders, time charges, cash entries, audit trail, and attendance.
- `GET /api/sync/pull?after=0` — fetches the signed-in location's event stream.
- `GET /api/admin/locations` — list locations for an administrator.

The service uses parameterized SQL, scrypt password hashes, short-lived HMAC-signed tokens, role-aware entity permissions on write ingestion, request-size limits, and database transactions. Configure CORS to the exact trusted client origin if browser clients need it.

## Not production-complete yet

- The desktop UI is not yet migrated to this API; current operational data remains in each browser profile.
- The local durable database/outbox agent needed to keep multiple counters working when the shop internet is down is not yet implemented.
- Cross-location synchronization, conflict resolution, central catalog ownership, remote user administration, token revocation/refresh, rate limiting, and disaster-recovery automation still require implementation and acceptance tests.
- Before production, add HTTPS, firewall rules, backups and tested restores, migrations, security review, audit monitoring, rate limiting, and automated integration tests. Do not rely on this foundation as the sole record of real sales until the desktop migration and offline/recovery gates pass.
