# Malik POS

A desktop point-of-sale workspace built with React, Vite, and Electron.

## Included features
- Product catalog with search and category filters
- Cart quantity controls, discounts, configurable GST (default 0%), service charges (default 0%), and cash/card/digital payment selection
- Checkout, transaction history, and printable receipts
- Inventory management, stock decrement on sale, and low-stock alerts
- Customer directory and lifetime spending totals
- Sales overview, transaction exports (CSV), and full JSON data backup
- Default company profile: The Slice Of Heaven, Bhakkar, Punjab, Pakistan; editable contact/address details
- First-launch business type setup for fast food, medical store, super store, restaurant, showroom, and other businesses
- PKR / Rs. currency formatting and 58mm/80mm thermal paper preferences
- Bluetooth Low Energy printer discovery and remembered-device reconnect where supported; classic Bluetooth SPP printers may require Windows pairing/driver and use the system print dialog
- Store preferences and responsive interface
- Windows NSIS installer build via GitHub Actions

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

## Data and production notes
This starter release stores records in the local browser profile using localStorage. Export the JSON backup regularly. Data is not yet synchronized between computers, and multi-user authentication, supplier purchasing, expense entry, barcode hardware integration, and a production database/API require additional implementation before a multi-terminal production rollout. Currency formatting is fixed to PKR (Rs.). Bluetooth printer discovery depends on the printer exposing a supported BLE interface; it cannot guarantee direct printing to every classic Bluetooth thermal printer.


## Multi-computer architecture decision (planned; not yet implemented)

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
This section records the architecture decision and rollout gates only. The backend, local database, authentication, event synchronisation, and offline recovery are **not yet implemented by this documentation change**. The current localStorage application remains the active system until each gate is implemented and verified.
