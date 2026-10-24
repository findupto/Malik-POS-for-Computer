# Malik POS API (foundation)

This is the first backend foundation for central PostgreSQL storage, staff authentication, location-scoped records, and idempotent event ingestion. The React application has a **Settings → Multi-computer sync** panel for API login, delta sync, delete tombstones, conflict review, and background retry every 30 seconds while the app is open and online. Existing POS screens still use localStorage; this is not a server-authoritative register or reliable offline-first multi-branch system.

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

## Docker Compose deployment

The Compose stack starts PostgreSQL and the API, plus a backup service that takes an immediate verified backup and repeats every 24 hours by default. Copy `.env.example` to `.env` inside `server/`, replace all placeholder secrets, and run from the repository root:

```sh
docker compose --env-file server/.env up -d --build
docker compose --env-file server/.env ps
curl http://127.0.0.1:8787/health
```

The API port is bound to loopback by default. To make it reachable by other computers, set `API_BIND_IP` to the host's private LAN address and configure the operating-system firewall to allow only the shop LAN. Do not expose this plain-HTTP port to the public internet: bearer tokens and passwords require HTTPS protection. Prefer a trusted TLS reverse proxy and set `CORS_ORIGIN` to the exact browser origin. For the desktop renderer, test the actual origin policy in the packaged app before deploying.

Use a strong unique `POSTGRES_PASSWORD`, `JWT_SECRET` (at least 32 characters), and `BOOTSTRAP_ADMIN_PASSWORD` (at least 12 characters). Keep `server/.env` private and out of source control.

## API

- `POST /api/auth/login` — username/password login; returns an 8-hour signed bearer token.
- `GET /api/me` — current authenticated user.
- `GET /api/records?entity=orders` — records for the signed-in user's location.
- `POST /api/sync/push` — atomically ingests up to 500 events, deduplicated by event UUID. Admins/managers can sync all entity types; cashiers are restricted to orders, time charges, cash entries, audit trail, and attendance.
- `GET /api/sync/pull?after=0` — fetches the signed-in location's event stream.
- `GET /api/admin/locations` — list locations for an administrator.\n- `GET /api/admin/users` and `POST /api/admin/users` — list/create staff accounts for the administrator's current location; new passwords must be at least 12 characters.
- `POST /api/admin/users/:id/activate` and `/deactivate` — enable or disable a staff account; admins cannot deactivate themselves or the last active administrator at a location.
- `POST /api/admin/users/:id/role` — change a staff role; demoting the last active administrator is blocked.
- `POST /api/admin/users/:id/reset-password` — set a new password (minimum 12 characters) for a staff account at the administrator's location.

The service uses parameterized SQL, scrypt password hashes, 8-hour HMAC-signed tokens, role-aware entity permissions on write ingestion, request-size limits, database transactions, per-record optimistic concurrency checks for updated sync clients, and basic in-memory per-IP login throttling. Configure CORS to the exact trusted client origin if browser clients need it. Login throttling is process-local and should be replaced with a shared reverse-proxy or datastore-backed limiter for multi-instance production.

## Database backup and restore

The API repository now includes Linux shell scripts for verified PostgreSQL backups and guarded restores:

```sh
export DATABASE_URL='postgresql://user:password@host:5432/malik_pos'
BACKUP_DIR=/secure/backups BACKUP_RETENTION_DAYS=14 sh server/backup.sh
```

The script creates a custom-format `.dump`, validates it with `pg_restore --list`, writes a SHA-256 checksum, and prunes old dump/checksum pairs. Compose runs it automatically via the `backup` service. Tune `BACKUP_INTERVAL_SECONDS` and `BACKUP_RETENTION_DAYS` in `server/.env`; inspect `docker compose --env-file server/.env logs backup`. Backups use a Docker volume on the same host by default, so configure that volume for encrypted external/off-device storage and test restores on a separate machine.

To restore, first stop writers and verify the target database carefully. This command replaces matching database objects and is intentionally guarded:

```sh
CONFIRM_RESTORE=YES DATABASE_URL='postgresql://user:password@host:5432/malik_pos' sh server/restore.sh /secure/backups/malik-pos-YYYYMMDDTHHMMSSZ.dump
```

After restoring, verify `/health`, sign-in, record counts, and a controlled test sync before returning registers to service. This covers the PostgreSQL API database only; it does **not** back up the active register's localStorage data. Continue exporting the app's JSON backup and testing restores on a separate machine.

## Not production-complete yet

- The desktop UI is not yet migrated to this API; current operational data remains in each browser profile. The API can now be deployed with Compose and the sync Settings panel includes staff account management for connected administrators.
- The local durable database/outbox agent needed to keep multiple counters working when the shop internet is down is not yet implemented.
- Cross-location synchronization, the local LAN database/outbox agent, central catalog ownership, token refresh, shared rate limiting, and disaster-recovery automation still require implementation and acceptance tests. Password resets and account changes invalidate previously issued tokens on the next request.
- Before production, add HTTPS, firewall rules, off-device backups and tested restores, migrations, security review, audit monitoring, and shared rate limiting. PostgreSQL API integration tests now run in CI, but multi-register acceptance tests for simultaneous sales, refunds, inventory conflicts, and network/power loss are still required. Do not rely on this foundation as the sole record of real sales until the desktop migration and offline/recovery gates pass.
