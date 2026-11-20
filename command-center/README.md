# command-center: n8n workflows + a Google Sheets CRM

The voice agent's tools are webhooks; this folder is what answers them. The CRM is a Google Sheet on purpose: the owner can read every lead on day one, with no CRM licence and no onboarding.

## CRM (sheets/setup-crm-sheet.gs)

An idempotent Apps Script that builds 5 tabs plus a live Dashboard, with headers, drop-down validation, conditional formatting and KPI formulas (calls today, bookings, call-to-booking conversion, unhandled hot alerts, callbacks due).

| Tab | Written by |
|---|---|
| `Leads` (20 columns) | `create_lead` |
| `Bookings` (12 columns) | `book_consultation` |
| `Calls` (15 columns) | `end_call_summary` (designed) |
| `Materials_Sent` | `send_materials` (designed) |
| `Hot_Alerts` (checkbox "handled") | `notify_owner_telegram` (designed) |

The tab layout is the schema contract: `npm run check:agent` verifies that the workflows write only columns that exist and only values the validation lists accept.

## Workflows (n8n/)

| File | Status | Shape |
|---|---|---|
| `acme-setup-crm-sheets.json` | built | manual trigger -> creates the 5 tabs (the n8n alternative to the Apps Script) |
| `acme-tool-create-lead.json` | built | webhook -> **respond first** -> normalise 11 fields -> append to `Leads` |
| `acme-tool-book-consultation.json` | built | webhook -> **respond first** -> normalise 8 fields -> append to `Bookings` with status `requested` |
| send_materials, transfer_to_human, notify_owner_telegram, end_call_summary | designed | schemas are final in `voice-agent/config/tools.json`; workflows not built yet |
| Google Calendar event on booking, Telegram hot-lead alert | designed | next workflows |

Every built tool workflow answers before it works: the agent waits at most 30 s for a webhook (gotcha #4).

The contract check caught one real mismatch: `book_consultation` writes `status = "requested"`, but the Bookings validation list only allowed `scheduled / done / no_show / cancelled`. Validation is soft in the sheet, so such rows would go in flagged as invalid. Fixed in `setup-crm-sheet.gs` by adding `requested` as the first state.

`create_lead` appends a row keyed by phone; de-duplicating repeat callers (upsert) is on the roadmap.

## Import

Import the JSON files in n8n, attach a Google Sheets credential to the Sheets nodes and put your spreadsheet ID where the exports say `<DOCUMENTID>`. All instance IDs, credentials and webhook IDs were stripped from the exports.
