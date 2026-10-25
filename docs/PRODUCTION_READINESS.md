# Malik POS Production Readiness

This checklist is a release gate, not a claim that the current application is production-ready. The desktop register currently uses browser localStorage as its active record store; the PostgreSQL API is only partially integrated.

## Required before unattended business operation

- [ ] Make the local register service and durable local database authoritative for each shop; the UI must not finalize money or stock changes solely in localStorage.
- [ ] Add a durable transactional outbox/inbox for sales, tenders, refunds, stock movements, cash shifts, and audit events. Persist before network requests; use stable UUID idempotency keys and safe replay after crashes.
- [ ] Keep multiple counters at one location sharing data while internet is unavailable, using a shop-LAN service/database.
- [ ] Implement central cross-location synchronization with authenticated TLS, explicit ownership/version rules, retry queues, and human-reviewed conflicts. Never silently resolve money or stock conflicts with last-write-wins.
- [ ] Enforce role and location permissions at the API/database boundary for every read and write. Add session revocation/expiry handling and shared rate limiting for multi-instance deployments.
- [ ] Migrate every operational workflow to the authoritative service: checkout, refunds, inventory, recipe ingredients, purchases, supplier balances, customer credit, expenses, cash drawer shifts, time/table charges, staff attendance, and reporting. Clearly identify any workflow still operating locally only.
- [ ] Add owner monitoring for sales, net sales/refunds, cash variance, low/out-of-stock items, overdue customer/supplier balances, pending orders, staff activity, sync backlog, offline locations, failed backups, and application/service health. Alerts must be durable, deduplicated, actionable, and visible even when a register is closed.
- [ ] Configure production HTTPS, private-network firewall rules, secret management, least-privilege database credentials, dependency/security scanning, and audit-log retention.
- [ ] Back up the central database and local shop databases to encrypted off-device storage; monitor backup failures and run scheduled restore drills.
- [ ] Add schema migrations, rollback procedures, safe import/duplicate detection for existing local data, and a documented deployment/update process.

## Mandatory acceptance tests

- [ ] Two counters at one shop create sales concurrently without lost or duplicate sales.
- [ ] Disconnect internet, continue selling from multiple counters on the LAN, reconnect, and verify exact reconciliation.
- [ ] Disconnect power/network before, during, and after payment confirmation; restart and prove each sale is recovered exactly once.
- [ ] Retry the same sale/refund request repeatedly; the ledger and stock change exactly once.
- [ ] Run concurrent sales, returns, purchases, wastage, and stock adjustments; inventory never becomes silently inconsistent.
- [ ] Verify staff cannot read or modify another location's data or perform unauthorized refunds, discounts, or stock adjustments.
- [ ] Restore both local and central backups onto a clean machine and verify record counts, balances, and audit history.
- [ ] Verify owner alerts are delivered for offline locations, failed sync, low stock, unusual cash variance, and failed backups.
- [ ] Run migration tests against a copy of real existing data before enabling shared mode.

## Release rule

Do not advertise or use multi-computer/offline mode as production-ready until the above gates are implemented and tested. A dashboard that refreshes while open is not equivalent to continuous monitoring or automated alerting. A JSON snapshot in localStorage is not a transactional backup or a shared database.
