# Connectors

Contrack Connectors sync communication and calendar activity into your personal CRM automatically, keeping your timeline up-to-date with the people you talk to.

Manage connectors in Contrack under **Settings → Connect → Connectors** (`/settings/connectors`).

---

## 1. Overview & Architecture

Connectors run in-process on the Contrack server and poll external services on configurable schedules (15m, 30m, hourly, daily):

- **Pluggable Adapters**: Built on a unified streaming adapter interface (`server/connectors/types.ts`). Currently supports **Calendar (ICS)** feeds, with IMAP, Google Workspace, iMessage, and WhatsApp export support planned.
- **Background Scheduler**: A single 60-second tick checks due connectors, running at most one connector per account per tick to prevent resource hogging. Overall server concurrency is controlled by `CONNECTOR_SYNC_CONCURRENCY` (default: 2).
- **Graceful Shutdown**: All active sync runs listen to an `AbortSignal` wired to process termination (`SIGINT` / `SIGTERM`), cleanly wrapping up transactions.
- **Manual Sync**: The "Sync now" button triggers immediate execution, operating synchronously when background workers are disabled (`DISABLE_BACKGROUND_JOBS=true`).

---

## 2. Privacy by Design

Contrack is designed for total data sovereignty:

- **Sealed Credentials**: All secrets (OAuth tokens, app passwords, private feed URLs) are encrypted with AES-256-GCM using a persistent encryption key located at `$DATA_DIR/secret.key` (or provided via `APP_SECRET_KEY`). Credentials never appear in API responses or logs.
- **SSRF Protection**: All outbound network requests are validated against private/internal IP ranges by default (`server/utils/urlSafety.ts`). For test environments or self-hosted intranet setups, `CONNECTORS_ALLOW_PRIVATE_HOSTS=true` may be configured (with a prominent server startup warning).
- **Minimal Metadata**: The Calendar adapter only imports event timestamps, titles, and participant emails. Agenda notes and descriptions are excluded by default unless explicitly enabled.
- **Private Mention Extraction**: Interactions created by connectors bypass the AI mention-extraction queue (`skipMentions: true`) to keep external communication logs private.

---

## 3. Matching & Contact Provenance

Incoming events are matched against your existing network:

1. **Participant Matching**: Matches participant email addresses and phone numbers against your contacts.
2. **Self Address Exclusion**: Your own email addresses (and aliases) are recognized and excluded from becoming contacts.
3. **Primary Ownership & Mentions**: The first matched non-self participant becomes the primary contact for the interaction. Any additional matched attendees are recorded as mentions.
4. **Correspondents & Ghosts**: Unmatched attendees are tracked as correspondents. When an unknown person reaches the configured ghost threshold (default: 3 interactions), a ghost contact is automatically suggested so you can promote them with one click.
5. **Timeline Attribution**: Interactions imported by connectors display a "via Calendar" badge on the contact's timeline.

---

## 4. Calendar (ICS) Setup Guide

The Calendar connector connects to any feed publishing an iCalendar (ICS) URL.

### Finding your private ICS URL

- **Google Calendar**:
  1. Open Google Calendar on the web → Settings → Settings for my calendars → select your calendar.
  2. Scroll down to **Integrate calendar**.
  3. Copy the URL under **Secret address in iCal format** (`https://calendar.google.com/calendar/ical/.../basic.ics`).
- **Apple iCloud**:
  1. In the macOS or iOS Calendar app, click the share icon next to your calendar.
  2. Enable **Public Calendar** (Apple uses a random, unguessable link with no search indexing).
  3. Copy the URL and replace `webcal://` with `https://`.
- **Fastmail**:
  1. Settings → Calendars → click the calendar.
  2. Look for **Export / Sync** and copy the private iCalendar URL.
- **Microsoft Outlook**:
  1. Outlook Web → Settings → Calendar → Shared calendars.
  2. Under **Publish a calendar**, choose permissions and copy the ICS link.

### Connector Configuration Options

- **Sync Schedule**: How often Contrack polls the feed (15 minutes, 30 minutes, 1 hour, or 24 hours).
- **Initial Lookback**: On the first sync run, how far into the past to import meetings (30 days, 90 days, or 1 year).
- **Attendee Filter**: "Skip events with more than N attendees" (default: 25) prevents large company all-hands or webinars from polluting your CRM.
- **Include Descriptions**: When enabled, copies the full event description into the interaction content.
- **Ghost Threshold**: Number of times an unknown person must appear before generating a ghost contact (default: 3).

---

## 5. Operations & Troubleshooting

### Connector States

- `active`: Functioning normally and syncing on schedule.
- `paused`: Sync schedule is paused. Can be manually triggered or resumed at any time.
- `error`: The last sync attempt failed (e.g., DNS error, network timeout). Exponential backoff delays the next run up to 4 hours. Click **Retry now** to trigger an immediate run.
- `needs_reauth`: The remote server returned an authentication error (`401` / `403` / invalid token). Click **Reconnect** to re-enter feed credentials.

### Run History

Click **Run history** from any connector card to view the last 20 sync runs, including trigger origin, execution duration, items fetched, contacts/ghosts touched, and raw error messages.

### Backups

Because credentials are encrypted with `$DATA_DIR/secret.key`, always keep a backup of `secret.key` alongside your SQLite database snapshots (`contrack.db`). Restoring a database without its corresponding `secret.key` will prevent connectors from reading their stored secrets.
