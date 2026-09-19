# Connectors

Contrack Connectors sync communication and calendar activity into your personal CRM automatically, keeping your timeline up-to-date with the people you talk to.

Manage connectors in Contrack under **Settings → Connect → Connectors** (`/settings/connectors`).

---

## 1. Overview & Architecture

Connectors run in-process on the Contrack server and poll external services on configurable schedules (15m, 30m, hourly, daily):

- **Pluggable Adapters**: Built on a unified streaming adapter interface (`server/connectors/types.ts`). Supports **Calendar (ICS)**, **Mailbox (IMAP)**, and **Google Workspace** (Google People, Gmail, and Google Calendar).
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
5. **Timeline Attribution**: Interactions imported by connectors display provenance badges (e.g. "via Calendar", "via Email", "via Google") on the contact's timeline.

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

## 5. Mailbox (IMAP) Setup Guide

The Mailbox connector connects directly to any IMAP server over TLS/SSL (port 993) to sync incoming and outgoing correspondence.

### App Passwords & Security

Always use an **app-specific password** rather than your primary account password. Most providers require this when 2-Factor Authentication (2FA) is enabled:

- **Fastmail**: Settings → Password & Security → **New App Password** (select "Mail (IMAP/POP)").
- **Gmail / Google Workspace**: Google Account → Security → 2-Step Verification → **App Passwords**.
- **Apple iCloud**: appleid.apple.com → Sign-In and Security → **App-Specific Passwords**.
- **Generic IMAP / Self-hosted**: Ensure port 993 (SSL/TLS) is open and accessible from your Contrack host.

### Configuration Options

- **IMAP Host & Port**: Hostname (e.g. `imap.fastmail.com`, `imap.gmail.com`) and port (default: `993`).
- **Folders**: List of folders to monitor (default: `INBOX`, `Sent`). Contrack tracks message UIDs per folder to sync only new arrivals.
- **My Aliases**: List your personal email addresses and aliases. Any message matching these will be recognized as outgoing from you.
- **Roll up emails per contact per day**: Enabled by default. Groups multiple emails exchanged with the same contact on the same date into a single timeline interaction with a bulleted digest. This prevents high-frequency email threads from drowning your timeline.
- **Generate AI summaries**: Disabled by default. When enabled, Contrack reads message bodies and invokes the quick AI model (`connectorSummary` task) to generate a concise 1–2 sentence summary of the thread. Summaries are capped at 50 per sync run to manage AI token budgets and rate limits. All untrusted email body content is strictly shielded before AI evaluation.

---

## 6. Google Workspace Setup Guide

The Google Workspace connector syncs contacts, emails, and calendar events via Google OAuth 2.0 and official Google APIs (Google People API, Gmail API, Google Calendar API).

### Google Cloud Console Setup

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and create a project (e.g. `Contrack CRM`).
2. Navigate to **APIs & Services → Library** and enable:
   - **Google People API**
   - **Gmail API**
   - **Google Calendar API**
3. Navigate to **APIs & Services → OAuth consent screen**:
   - **User Type**:
     - For Google Workspace organizations: choose **Internal** (recommended — no verification needed, any org member can connect).
     - For personal `@gmail.com` accounts: choose **External**. Under **Test users**, add your Gmail address.
4. Navigate to **APIs & Services → Credentials**:
   - Click **Create Credentials → OAuth client ID**.
   - Application type: **Web application**.
   - Authorized redirect URIs: Add your Contrack instance callback URL:
     ```
     https://your-contrack-domain.com/api/connectors/google/callback
     ```
     _(For local development: `http://localhost:3210/api/connectors/google/callback`)_.
   - Copy the generated **Client ID** and **Client Secret**.

### Configuring OAuth in Contrack

1. Log in to Contrack as an administrator.
2. Go to **Settings → Administration → General** (`/settings/admin/general#integrations`).
3. Under **Google OAuth Integration**, paste your Client ID and Client Secret, then click **Save Google OAuth Configuration**.
   - Alternatively, you can set `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` in your server `.env` file.
4. Once saved, all users on the instance can add Google Workspace connectors from **Settings → Connect → Connectors**.

### Bypassing "Google hasn't verified this app"

If using an External app in Testing status:

1. When clicking **Connect Google Workspace**, Google will display a warning: _"Google hasn't verified this app"_.
2. Click **Advanced** at the bottom of the prompt.
3. Click **Go to Contrack (unsafe)** to complete the authorization flow.
4. Grant the requested scopes.

### Scopes & Privacy

Contrack requests the minimum necessary scopes:

- `https://www.googleapis.com/auth/contacts.readonly`: Imports names, email addresses, and phone numbers.
- `https://www.googleapis.com/auth/calendar.events.readonly`: Imports meeting titles, dates, and attendee lists.
- **Gmail Access**:
  - _Standard Mode (AI summaries OFF)_: Requests `https://www.googleapis.com/auth/gmail.metadata`. Contrack never downloads or accesses email message bodies.
  - _Summary Mode (AI summaries ON)_: Requests `https://www.googleapis.com/auth/gmail.readonly` to read email bodies solely for generating local 1–2 sentence meeting/email digests. Capped at 50 summaries per sync run.

---

## 7. Unconfirmed Correspondents & Ghost Contacts

As connectors sync emails and calendar meetings, they discover people you communicate with who are not yet in your contacts:

1. **Correspondents Review**: Access **Settings → Connect → Correspondents** (`/settings/connectors/people`) to review all discovered correspondents.
2. **One-Click Add**: Click **Add as contact** to create a contact immediately with their name, email, and phone pre-populated.
3. **Ignore**: Click **Ignore** to dismiss a correspondent (e.g. automated notification senders, newsletters). Ignored senders will not appear in correspondents review again.
4. **Automatic Ghost Contacts**: When an unknown correspondent reaches the configured **Ghost threshold** (default: 3 interactions), Contrack automatically suggests a ghost contact in your contact list so they seamlessly appear in your relationship network.

---

## 8. Operations & Troubleshooting

### Connector States

- `active`: Functioning normally and syncing on schedule.
- `paused`: Sync schedule is paused. Can be manually triggered or resumed at any time.
- `error`: The last sync attempt failed (e.g., DNS error, network timeout). Exponential backoff delays the next run up to 4 hours. Click **Retry now** to trigger an immediate run.
- `needs_reauth`: The remote server returned an authentication error (`401` / `403` / invalid token). Click **Reconnect** to re-authenticate.

### Run History

Click **Run history** from any connector card to view the last 20 sync runs, including trigger origin, execution duration, items fetched, contacts/ghosts touched, and raw error messages.

### Backups

Because credentials and OAuth refresh tokens are encrypted with `$DATA_DIR/secret.key`, always keep a backup of `secret.key` alongside your SQLite database snapshots (`contrack.db`). Restoring a database without its corresponding `secret.key` will prevent connectors from reading their stored secrets.
