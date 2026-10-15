# Malik POS

A desktop point-of-sale workspace built with React, Vite, and Electron.

## Included features
- Product catalog with search and category filters
- Cart quantity controls, discounts, optional 5% sales tax, and cash/card/digital payment selection
- Checkout, transaction history, and printable receipts
- Inventory management, stock decrement on sale, and low-stock alerts
- Customer directory and lifetime spending totals
- Sales overview, transaction exports (CSV), and full JSON data backup
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
This starter release stores records in the local browser profile using localStorage. Export the JSON backup regularly. Data is not yet synchronized between computers, and multi-user authentication, supplier purchasing, expense entry, barcode hardware integration, and a production database/API require additional implementation before a multi-terminal production rollout. Currency formatting currently uses PKR.
