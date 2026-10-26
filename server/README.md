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
- `POST /api/transactions` — records a sale, its line items, tenders, and audit event in one PostgreSQL transaction. The server recalculates totals and uses a location-scoped UUID idempotency key so network retries do not create a second sale.
- `GET /api/transactions?limit=50` — lists recent transactions for the authenticated user's location. Add `orderId=<local-order-id>` for an exact location-scoped lookup used by recovery; that exact-order response includes the idempotency key so a register only reconciles an outbox entry when both the order ID and original key match.
- `POST /api/inventory/initialize` — admin/manager-only, initializes a product's opening stock only if no location-scoped balance exists; repeated calls preserve the existing balance.
- `POST /api/inventory/adjustments` — admin/manager-only, idempotent stock adjustment. Use a positive `quantityDelta` for opening stock/receipts and a negative delta for wastage or corrections; a required reason is audited.
- `GET /api/inventory` — lists location-scoped tracked product balances and reorder points.
- `POST /api/transactions/:id/refunds` — admin/manager-only partial or full refund with a unique idempotency key, reason, method, optional returned item quantities, and optional restocking. Refund amounts cannot exceed the remaining sale total or refunded quantities exceed sold quantities.
- `GET /api/sync/pull?after=0` — fetches the signed-in location's event stream.
- `GET /api/admin/overview?from=YYYY-MM-DD&to=YYYY-MM-DD&locationId=<uuid>` — administrator-only owner snapshot; optional `locationId` selects another active branch, and all sales, inventory, staff and audit queries remain scoped to that branch with gross sales, refunds, net sales, average sale, transaction count, tracked inventory units, active staff, up to 100 tracked products at or below their configured reorder point, including zero-stock products, and the latest 10 audit events for the selected period (defaults to the location's current day; maximum 366 days). The Overview screen displays this data for connected administrator sessions, allows selecting a branch, and refreshes every 60 seconds while the screen is open. It is not an always-on alerting service and does not monitor a closed register.
- `POST /api/inventory/reorder-point` — administrator/manager-only, sets an audited per-product reorder threshold for an already tracked product. Owner overview includes items at or below their configured reorder point.
- `GET /api/admin/locations` — list locations for an administrator; `POST /api/admin/locations` creates an audited branch/location with a validated IANA timezone.
- `POST /api/admin/users` accepts an optional `locationId` for an active branch, allowing an administrator to provision branch-specific staff. Usernames are globally unique.
- `GET /api/admin/users` and `POST /api/admin/users` — list/create staff accounts for the administrator's current location; new passwords must be at least 12 characters.
- `POST /api/admin/users/:id/activate` and `/deactivate` — enable or disable a staff account; admins cannot deactivate themselves or the last active administrator at a location.
- `POST /api/admin/users/:id/role` — change a staff role; demoting the last active administrator is blocked.
- `POST /api/admin/users/:id/reset-password` — set a new password (minimum 12 characters) for a staff account at the administrator's location.

The explicitly configured bootstrap account is marked as the global administrator. Branch-local administrators can manage staff only at their own location; only the global administrator can enumerate/create locations, inspect another location's overview, or provision staff at another location. Existing staff default to branch-local scope. The service uses parameterized SQL, scrypt password hashes, 8-hour HMAC-signed tokens, role-aware entity permissions on write ingestion, request-size limits, database transactions, per-record optimistic concurrency checks for updated sync clients, and PostgreSQL-backed login throttling shared across API replicas. The limiter stores a SHA-256 digest of the client address, allows up to 10 attempts per 15-minute window, clears the window after successful sign-in, and periodically removes expired rows. Configure CORS to the exact trusted client origin if browser clients need it.

## Database backup and restore

The API repository now includes Linux shell scripts for verified PostgreSQL backups and guarded restores:

```sh
export DATABASE_URL='postgresql://user:password@host:5432/malik_pos'
BACKUP_DIR=/secure/backups BACKUP_RETENTION_DAYS=14 sh server/backup.sh
```

The script creates a custom-format `.dump`, validates it with `pg_restore --list`, writes a SHA-256 checksum, and prunes old dump/checksum pairs. The Compose backup service has a health check that verifies the latest backup is no older than 25 hours, verifies its checksum, and validates the archive with `pg_restore --list`; Docker marks the service unhealthy when checks fail. The backup loop also runs a monitor after each backup cycle. If the latest backup is missing, stale, or invalid, it sends a static alert to an optional Slack-compatible incoming webhook configured as `BACKUP_ALERT_WEBHOOK_URL` in `server/.env`; no database credentials or POS data are included in the alert. Without that setting, the failure is logged but no remote notification is sent. Keep the webhook URL secret and test delivery before relying on it. Run `docker compose --env-file server/.env ps` to inspect service health and `docker compose --env-file server/.env logs backup` to inspect backup output. Tune `BACKUP_INTERVAL_SECONDS` and `BACKUP_RETENTION_DAYS` in `server/.env`; set `BACKUP_MAX_AGE_SECONDS` on the backup container if your backup interval differs from the default. This health check detects stale or corrupted local backups, but does not send notifications or replace off-device copies. Backups use a Docker volume on the same host by default, so configure that volume for encrypted external/off-device storage and test restores on a separate machine.

To restore, first stop writers and verify the target database carefully. This command replaces matching database objects and is intentionally guarded:

```sh
CONFIRM_RESTORE=YES DATABASE_URL='postgresql://user:password@host:5432/malik_pos' sh server/restore.sh /secure/backups/malik-pos-YYYYMMDDTHHMMSSZ.dump
```

After restoring, verify `/health`, sign-in, record counts, and a controlled test sync before returning registers to service. This covers the PostgreSQL API database only; it does **not** back up the active register's localStorage data. Continue exporting the app's JSON backup and testing restores on a separate machine.

## Not production-complete yet

- When a register is connected to the API, confirming payment posts the completed sale to `POST /api/transactions` before marking its local order completed. The exact request payload and idempotency key are saved in a localStorage outbox before sending. If the response is lost, an online background recovery check queries the server by exact order ID; if the server confirms the sale, the app persists the local completed order and customer totals before clearing the queued request. Successful checkout responses also retain the queue until those local records are saved, so a crash between server acceptance and local persistence remains recoverable. Otherwise the original request stays queued for a safe retry. Retries reuse the stored idempotency key. Without an API session, checkout remains local-only. The localStorage order list remains the active UI record store; this is not full server-authoritative checkout. The ledger deducts stock for products that have been explicitly initialized in `inventory_balances`; sales of untracked products remain allowed and do not change the inventory ledger. The Inventory screen can initialize untracked catalog products from local opening quantities, view server balances without overwriting existing quantities, and record reasoned signed stock adjustments as an admin/manager. After a successful adjustment it refreshes the server quantity and reconciles the matching local product stock. The Inventory screen also exposes a location-scoped recent movement history for adjustments, sales, and refunds, with product filtering available through the API. The Orders refund dialog records the backend refund before changing local records when connected; it supports returned quantities and optional server restocking. A restock request fails safely if a returned product has no tracked server balance. The dialog also offers a separate, explicit local-only option to restore recipe ingredient stock, intended only when those ingredients are physically recoverable. Backend inventory remains separate from local recipe ingredient stock. The API can be deployed with Compose and the sync Settings panel includes staff account management for connected administrators.
- The local durable database/outbox agent needed to keep multiple counters working when the shop internet is down is not yet implemented.
- Cross-location synchronization, the local LAN database/outbox agent, central catalog ownership, token refresh, and disaster-recovery automation still require implementation and acceptance tests. Login attempts are throttled in PostgreSQL using a hashed client-address key, so the 15-minute limit is shared across API replicas; successful sign-in clears that address's window. Password resets and account changes invalidate previously issued tokens on the next request.
- Before production, configure HTTPS and firewall rules, off-device backups, tested restores, database migrations, security review, and audit-log monitoring. Shared PostgreSQL-backed login throttling is covered by an API integration test when `TEST_DATABASE_URL` is configured. PostgreSQL API integration tests now run in CI, but multi-register acceptance tests for simultaneous sales, refunds, inventory conflicts, and network/power loss are still required. Do not rely on this foundation as the sole record of real sales until the desktop migration and offline/recovery gates pass.
