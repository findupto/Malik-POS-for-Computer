# Malik POS API (foundation)

This is the first backend foundation for central PostgreSQL storage, staff authentication, location-scoped records, and idempotent event ingestion. The existing React desktop application still uses localStorage until a client migration is implemented and verified; starting this service does **not** automatically connect existing registers or enable offline/multi-branch operation.

## Requirements

- Node.js 22+
- PostgreSQL 16+
- A private network or HTTPS reverse proxy. Never expose PostgreSQL directly to the internet.

## Start locally

1. Set a strong database password and create a database named `malik_pos` owned by a dedicated user.
2. Copy `.env.example` to `.env` and fill in real values. Do not commit secrets.
3. Export those environment variables in the shell running the service.
4. Run `npm install`, then `npm run server`.
5. Verify `GET /health`, then sign in with the bootstrap account using `POST /api/auth/login`.

The bootstrap administrator is created only when the username does not already exist. Store credentials in a secret manager, rotate the bootstrap password after first use, and terminate TLS at a trusted reverse proxy.

## API

- `POST /api/auth/login` — username/password login; returns an 8-hour signed bearer token.
- `GET /api/me` — current authenticated user.
- `GET /api/records?entity=orders` — records for the signed-in user's location.
- `POST /api/sync/push` — manager/admin only; atomically ingests up to 500 events, deduplicated by event UUID.
- `GET /api/sync/pull?after=0` — fetches the signed-in location's event stream.
- `GET /api/admin/locations` — list locations for an administrator.

The service uses parameterized SQL, scrypt password hashes, short-lived HMAC-signed tokens, role checks on write ingestion, request-size limits, and database transactions. Configure CORS to the exact trusted client origin if browser clients need it.

## Not production-complete yet

- The desktop UI is not yet migrated to this API; current operational data remains in each browser profile.
- The local durable database/outbox agent needed to keep multiple counters working when the shop internet is down is not yet implemented.
- Cross-location synchronization, conflict resolution, central catalog ownership, remote user administration, token revocation/refresh, rate limiting, and disaster-recovery automation still require implementation and acceptance tests.
- Before production, add HTTPS, firewall rules, backups and tested restores, migrations, security review, audit monitoring, rate limiting, and automated integration tests. Do not rely on this foundation as the sole record of real sales until the desktop migration and offline/recovery gates pass.
