# Malik POS

A desktop point-of-sale workspace built with React, Vite, and Electron.

## Included features
- POS checkout, cart editing, discounts, configurable GST and service charges, cash/card/digital payments, printable receipts, and transaction history
- Product catalog search with SKU/barcode matching, partial/fuzzy terms, and keyboard shortcuts for common counter workflows
- Product/category sales reporting, date-range filters, CSV exports, and dashboard net-sales calculations that account for recorded refunds
- Customer and supplier directories with search, filters, credit/payable visibility, and CSV exports
- Business command center with actionable alerts for pending kitchen orders, unpaid orders, customer dues, supplier dues, and unassigned deliveries
- Inventory and ingredient stock management, recipe-based ingredient costing, opening-stock helpers, low-stock alerts, demand-based restock suggestions, and restock CSV export
- Ingredient purchase receiving with pack-to-base-unit conversion, weighted average ingredient costing, stock movements, batch/expiry tracking, expired-stock write-offs, supplier invoice balances, payment history, due-date aging, supplier payment exports, and purchase price comparisons
- Recipe and portion management, recipe library, waste recording, and stock movement reports
- Cash drawer shifts with expected-vs-counted cash reconciliation and shift report export
- Manual no-purchase seat/table timers with configurable hourly rates, a free grace period, rounded-up billable hours, and charges recorded as normal pending orders
- Customer/product/report exports in CSV, plus JSON data backup
- Editable company profile, PKR / Rs. currency formatting, and 58mm/80mm thermal paper preferences
- Bluetooth Low Energy printer discovery and remembered-device reconnect where supported; classic Bluetooth SPP printers may require Windows pairing/driver and use the system print dialog
- First-launch business type setup for fast food, medical store, super store, restaurant, showroom, and other businesses
- Windows NSIS installer build via GitHub Actions


## Automatic desktop backups

The Electron desktop app now writes a daily JSON snapshot of its `malik-*` local POS records to the application's user-data `backups` folder, refreshes the snapshot every 15 minutes while the app is open, and retains the most recent 30 daily files. Session/token/password/credential-like keys are excluded. The latest snapshot is also written as `latest.json`. In the desktop app, the folder can be opened through the exposed desktop backup action. These files are local backups, not Google Drive backups; protect the Windows user account and copy backups to encrypted off-device storage.

**Google Drive setup is available in the desktop app, but requires your own OAuth client ID and explicit account authorization.** It cannot silently reuse a browser or Windows sign-in.

1. In [Google Cloud Console](https://console.cloud.google.com/), create/select a project and enable the Google Drive API.
2. Configure the OAuth consent screen. If the app is in Testing mode, add the Google account you will use as a test user.
3. Create an OAuth client ID with application type **Desktop app**. Do not create or share a client secret for this desktop flow.
4. Open Malik POS → **Settings** → **Automatic local backups**. Paste the client ID and select **Connect Google Drive**. Complete Google's consent flow in the browser.
5. The app stores the refresh token encrypted using the operating system's secure credential storage, uploads daily JSON snapshots to the **Malik POS Backups** Drive folder, and updates the current day's file while the app is running. The app shows a one-second daily reminder if Drive is not connected, and a one-second daily alert if an upload keeps failing.

Use **Restore from backup file** in Settings to select and validate a JSON backup. The app asks for confirmation and creates a safety backup before replacing saved `malik-*` business records.

**Limitations:** these are snapshots of the POS records stored in browser localStorage, not a replacement for a fully server-authoritative database backup. Automatic snapshots and uploads require Malik POS to be running and online. No Drive account is connected until you complete the OAuth steps above. Test restoration on a non-production copy before relying on these backups for disaster recovery.

## Run locally
Requires Node.js 22 or newer.

```bash
npm install
npm run dev
```

For the desktop development window:

```bash
npm run dev:desktop
```

## Build the Windows installer
On Windows:

```bash
npm install
npm run build:win
```

The installer is written to `release/`. Every push to `main` also starts the **Build Malik POS for Windows** GitHub Actions workflow. On success, download the `Malik-POS-Windows-Installer` artifact from the completed workflow run.

## Backend foundation (early implementation)

A PostgreSQL-backed API starter now lives in `server/`, with password hashing, signed staff sessions, role-checked event ingestion, location-scoped records, and idempotent sync events. The Settings page includes an opt-in manual sync panel for connecting to this API and transferring local snapshots. See [`server/README.md`](server/README.md) and `server/.env.example` for setup. A local PostgreSQL development service is provided in `docker-compose.yml`.

**Important:** sync now sends changed records and deletion tombstones, checks for conflicting edits, and retries every 30 seconds while the app is open and online, including when you navigate away from Settings. The register still reads/writes `localStorage`; a durable local LAN database/outbox for general record sync, cross-location synchronization, and tested disaster recovery remain incomplete. The API rejects stale writes from updated clients using per-record sequence checks. Do not use this early sync panel as the sole source of truth for live sales.

Shared checkout has a narrower durable retry safeguard: before posting a sale, the desktop client saves its exact request payload and idempotency key in a localStorage outbox. If the connection drops before the response arrives, retrying that order replays the same payload so a sale that already committed on the server is not accidentally changed or duplicated. A successful server response does not clear the queued entry immediately: the app first persists the completed local order and customer totals, then clears the matching entry. If local persistence fails, background reconciliation checks the exact order ID and idempotency key against the server and retries the local updates idempotently. Server rejections are retained in the recovery queue until an operator resolves the cause, so expired sessions or conflicts cannot silently discard the original sale payload. If the saved recovery data is malformed, the app preserves it and warns staff instead of replacing it with an empty queue. This is not a general offline queue and does not make the full register server-authoritative.

## Data and production notes
The current desktop app stores operational records in the local browser profile using `localStorage`. Export the JSON backup regularly and test restore procedures before relying on the app for critical operations. The Settings page has an early sync workflow with manual sync and periodic retry, but it is not real-time and is not yet safe for unattended multi-computer production use. Supplier purchases, expense tracking and stock/recipe workflows exist in the app, but they are not a substitute for a server-side accounting or inventory system with centralized access controls. Currency formatting is fixed to PKR (Rs.). Product restock recommendations and ingredient cost/profit estimates are heuristics; accuracy depends on complete product history, correct recipes, and current costs. Bluetooth printer discovery depends on the printer exposing a supported BLE interface and cannot guarantee direct printing to every classic Bluetooth thermal printer.

## Multi-computer architecture and rollout gates

Malik POS currently uses browser `localStorage` as its record store. Do not treat this build as shared-database or offline-synchronisation capable.

### Requirements
- Support 2–5 POS computers at multiple physical locations.
- Keep counters at the same location selling and sharing local data during internet outages.
- Synchronise locations when connectivity returns without silently losing or duplicating sales.
- Enforce staff permissions at the trusted service/database boundary, not only in React UI.

### Target architecture
1. Each physical location has a small always-on local service and durable local database on its LAN. Counter apps connect to that service over the private local network.
2. The local service is authoritative for that location's operational transactions while disconnected. Sales, tenders, refunds, stock movements and audit events are written atomically and assigned stable UUID/idempotency keys.
3. A central PostgreSQL service stores consolidated data and receives a durable, retryable outbox of location events over authenticated TLS connections. Retries are idempotent. Each event includes location ID, event ID, entity ID, schema version and creation time.
4. Master-data ownership and conflict rules must be explicit: stock movements and sales are append-only events; a location owns its local transactions; centrally managed catalog/settings changes carry versions and are applied only when compatible. Conflicts are surfaced for review rather than silently using last-write-wins for money or stock.
5. Every location has monitored sync status, durable retry queue, backup/restore procedures and a documented recovery drill. No counter should report a sale as synchronised until the central service acknowledges it.
6. Authentication and role permissions are checked by the local service for local operations and by the central service for remote administration. Secrets are stored server-side, never embedded in the desktop renderer or committed to source control.

### Implementation gates
- Gate A: document the entity/event model, data ownership, conflict policy, threat model and migration/rollback plan.
- Gate B: add a versioned database schema and backend API with authentication, permission checks, audit events and idempotent transaction endpoints.
- Gate C: import existing localStorage data using a preview, validation, duplicate detection and explicit confirmation; keep a verified backup and rollback route.
- Gate D: implement and test the local durable outbox/inbox, retry, reconnect and conflict review workflow.
- Gate E: prove two clients at one location share data offline; prove two disconnected locations can operate independently and later sync; test duplicate retries, crashes, restore, refunds and concurrent stock sales.
- Gate F: only after acceptance tests pass, enable the shared mode for production users.

### Important deployment constraint
A central cloud database by itself cannot satisfy the requirement that counters at a shop continue sharing live data when that shop loses internet. A local service/database is required at each physical shop for that requirement. The central service is for cross-location synchronisation and consolidated reporting, not a substitute for the local service.

### Current status
The PostgreSQL API foundation, Compose deployment, delta snapshots, delete tombstones, conflict review, app-wide periodic retry, staff account API/UI, per-record optimistic concurrency, session invalidation after account changes, basic login throttling, and an atomic/idempotent sales ledger with line items, tenders and audit events are implemented. When a register is connected to the API, checkout payment finalization records the sale in the ledger before marking the local order completed; network/API failures leave the order pending so the same idempotency key can be retried. The backend supports audited stock adjustments, location-scoped inventory balances, sale deductions for explicitly tracked products, and partial/full refunds. The Inventory screen can initialize only untracked catalog products, view server quantities without overwriting existing balances, record audited server stock adjustments with a required reason, and inspect recent shared stock movements from sales, refunds, and adjustments; the refund dialog posts to the backend before applying local refund records when connected, supports returned quantities, and can optionally restock tracked server/local product stock. A separate explicit option restores local recipe ingredient stock only when ingredients are physically recoverable. Registers without a connected API retain local-only checkout. The existing localStorage app remains the active register and is not yet server-authoritative; recipe ingredient stock and backend inventory are separate, and products not initialized in the backend ledger remain allowed without server-side stock deduction. There is no durable local LAN database/outbox, cross-location sync, or disaster-recovery validation. Treat multi-computer and multi-branch operation as **not production-ready** until each gate is implemented and verified.
