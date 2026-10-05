# Privacy

Contrack holds personal data about other people: their names, how to reach
them, where they live, and what you talk about. This page says what the server
stores, what leaves it, who can see what, how long each kind of data stays,
and what a delete removes.

## What the database holds

One SQLite file, `curator.db` in the data folder, holds every account's data:

- contacts, with their emails, phones, addresses, birthdays, links, work
  history, tags and custom fields
- notes, calls, meetings and imported email text, with their follow-ups
- lists, saved map views, search history and settings
- what AI wrote: briefings, research records with their sources, summaries
- accounts, sessions, API tokens, passkeys and the audit log

Photos, attachments and link-preview images are files in `uploads/`, in one
folder per account. Snapshots in `backups/` are full copies of the database.

The database is **not encrypted at rest**. Anyone who can read `curator.db` or
a snapshot can read every contact. Only stored credentials are encrypted: AI
keys, the mail password, connector credentials and the Google client secret.
Use disk encryption when that matters. See
[Where your data lives](self-hosting.md#where-your-data-lives).

## What leaves the server

Contrack sends data out only for the features in this table. There is **no
telemetry, no update check and no CDN**. The app's scripts, styles and fonts
come from your server.

| Service                                                                        | When                                                                                                                                                                                                                                                                                                          | What it sends                                                                                                                | How to turn it off                                                                                                  |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| An AI provider: Gemini, OpenAI, Anthropic, or an OpenAI-compatible server      | On a click: briefings, research, AI scans, Ask Contrack's model steps. **With no click:** a saved note (to find the people it mentions), Pulse's daily insight when Pulse opens, an attached `.eml` file's summary, a connector's mail summaries when that option is on, and a hosted embedding model's input | The text the feature needs: note text, contact fields, an email's subject and body, the question you asked                   | **Use AI for my account**, **Use AI on this instance**, or `AI_DISABLED=true`. See [Turn AI off](ai.md#turn-ai-off) |
| The provider's web search, or your SearXNG                                     | Contact research, on a click, or for a new contact when **Enrich new contacts automatically** is on                                                                                                                                                                                                           | The contact's name and details, as search terms                                                                              | **Allow web search**, or either AI switch                                                                           |
| The web pages research reads                                                   | During research: the server fetches each SearXNG result page, and after a Gemini search it follows each source link at `vertexaisearch.cloud.google.com` to the page it names                                                                                                                                 | A request for the page, from the server                                                                                      | As for web search                                                                                                   |
| `huggingface.co`                                                               | The first start without Docker, to download the two search models                                                                                                                                                                                                                                             | No contact data                                                                                                              | `npm run models:fetch`, then `MODEL_DOWNLOADS=false`. The Docker image ships the models                             |
| Nominatim, at `nominatim.openstreetmap.org`                                    | In the background when an address changes, at start for contacts with an address and no pin, and in the map's place search                                                                                                                                                                                    | The address text, or the place you typed                                                                                     | **Look up addresses for the map**, or `GEOCODING_DISABLED=true`. `NOMINATIM_URL` uses your own Nominatim            |
| Google's favicon service, at `www.google.com/s2/favicons`, asked by the server | The first time the app shows a domain's icon                                                                                                                                                                                                                                                                  | The domain: a work email's domain, a guess from a company name, a contact's website or link, a research source's site        | No switch. The server asks once per domain and keeps the icon. The browser never asks Google                        |
| Link previews                                                                  | When you paste a bare link into a note                                                                                                                                                                                                                                                                        | A request for that page and its preview image, from the server. The image is kept on your server                             | Either AI switch                                                                                                    |
| Connectors: Google APIs, your IMAP server, your calendar feed                  | On each sync of an active connector, and when you test one                                                                                                                                                                                                                                                    | Your credentials for that service. A Google contact's photo is copied from `googleusercontent.com`                           | Pause or delete the connector                                                                                       |
| Your mail server (SMTP)                                                        | Invitations, password resets, sign-in links and test mail                                                                                                                                                                                                                                                     | The recipient's address and the message                                                                                      | Leave **Outgoing mail** unset                                                                                       |
| An app's OAuth client metadata document                                        | When an app such as Claude starts to sign in with an `https` client id                                                                                                                                                                                                                                        | A request for that document, from the server. No contact data                                                                | It runs only with sign-in on and a `PUBLIC_URL` that is `https` or `http://localhost`                               |
| OpenFreeMap tiles, in the browser                                              | The Map page, and the small map on the page of a contact with a pin                                                                                                                                                                                                                                           | Your IP address, and which tiles the map shows: the small map shows the contact's area                                       | Host the basemap yourself with `MAP_STYLE_LIGHT` and `MAP_STYLE_DARK` (see [Basemap](configuration.md#basemap))     |
| Open-Meteo, in the browser                                                     | A contact's page header, when **Weather** is on. It is off by default                                                                                                                                                                                                                                         | The contact's coordinates, rounded to about 1 km                                                                             | Leave **Weather** off                                                                                               |
| A photo's own host, in the browser                                             | When a contact's photo is a web address that a vCard or an API client stored                                                                                                                                                                                                                                  | Your IP address and your instance's address, each time the photo shows. That host learns that someone looked at that contact | Replace the photo with an uploaded one                                                                              |

## AI

- **Use AI for my account**, in **Settings → Privacy and AI**, stops every call
  to a provider for your data. **Use AI on this instance**, in **Settings →
  Administration → AI**, stops them for every account. `AI_DISABLED=true`
  holds the instance switch off.
- **Allow web search** stops contact research and leaves the other features
  on.
- With AI off, local search and the built-in embedding model keep working.
  They run on your server.
- **Gemini on Google's free tier:** Google may use prompts and answers,
  contacts' details included, to improve its products. Use a key from a
  Google Cloud project with billing (see [Privacy](ai.md#privacy)).
- **OpenAI:** Contrack sends `store: false` with every call, so OpenAI keeps no
  copy of an answer for later use. OpenAI can still keep traffic for a short
  time to check for abuse, under its own terms.
- Anthropic and an OpenAI-compatible server follow their own terms. A model
  server on your own machine keeps everything there.
- **An MCP client or an OAuth app** reads what its tools return, with your
  token, and sends it to its own AI provider. Contrack's AI switches do not
  stop that. Revoke the app's token to stop it (see [MCP](mcp.md)).

## Who can see what

| Who                            | What they can see                                                                                                                                                                                                            |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A member                       | Their own contacts, notes and files only. Other accounts' profile photos and the instance's name                                                                                                                             |
| An admin                       | Their own contacts. For other accounts: the name, role, number of contacts and last sign-in, AI usage counts, and the audit log with IP addresses. **Export data** downloads an account's data, and the audit log records it |
| The person who runs the server | Everything: `curator.db`, the snapshots, `uploads/` and the server log                                                                                                                                                       |

The server log names records by id and counts them. It does not write names,
notes or search text. `LOG_LEVEL` sets how much it writes, `info` by default
(see [Configuration reference](configuration.md#environment-variables)).

Two things are shared by every account on the instance: the cache of address
lookups, and the company and site icons in `uploads/logos/`.

## How long data stays

| Data                                       | Kept                                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| A deleted contact in **Trash**             | 30 days by default. An admin sets 1 to 365 days in **Trash**                             |
| A merged-away contact and its merge record | 90 days, the time a merge can be undone                                                  |
| Snapshots                                  | The newest 7 by default, one each day and one at each start                              |
| Audit log entries                          | 90 days                                                                                  |
| AI usage (`ai_invocations`)                | 30 days. Each row has a one-line description that can name a contact or quote a note     |
| Import records (`import_rows`)             | 30 days after the import ends. A row keeps the contact's name, and a failed row its data |
| Events (`events`)                          | 30 days. They hold ids and field names only                                              |
| Search history                             | Until you select **Clear history** in **Settings → Privacy and AI**                      |
| Cached address lookups (`geocode_cache`)   | While a contact uses the address, and one day more                                       |
| Company and site icons                     | Kept. A domain with no icon is asked again after 30 days                                 |
| Uploaded files that no row uses            | 2 days, or 31 for a link-preview image, which a note draft can hold                      |

The [Data lifecycle](configuration.md#data-lifecycle) table has the rest.

## What a delete removes

- **Delete** moves a contact to **Trash** and keeps everything, so
  **Restore** can bring it back.
- **Delete forever**, and the trash purge after the retention period, remove:
  - the contact, its notes, interactions, follow-ups and every detail
  - every contact that was merged into it, at any depth
  - the merge records that name any of them
  - their photos, attachments and link-preview images. A file that another
    contact or note still shows stays
  - the name an import kept for them
- Deleting a note removes its attachment and its link-preview images.
- After a merge's 90 days, the merged-away contact and its files go. The
  contact you kept keeps everything the merge gave it.
- Deleting an account removes every row it owns and its upload folder.

What a delete does not reach:

- Snapshots keep the deleted data until they rotate out, after about 7 days
  by default. A snapshot holds no files.
- AI usage descriptions stay for their 30 days.
- A note on another contact keeps any words about the deleted person.
- A cached address stays until a daily cleanup finds it a day old, and the
  server log keeps what it wrote.

## Export your data and delete your account

- **Settings → Export → Everything (.json)** downloads your contacts, notes,
  lists, follow-ups and the merges you can still undo.
  [Export](import-and-sync.md#export) says exactly what it holds.
- A member cannot delete their own account. Export your data, then ask an
  admin to delete the account in **Settings → Administration → Accounts**.
  The delete removes everything the account owns.
- On an instance that you run alone, stop the server and delete the data
  folder, with its snapshots.

## In your browser

| Key                          | Kind            | Holds                                                          | How long                                                                                                             |
| ---------------------------- | --------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `contrack_session`           | Cookie          | Your session. `HttpOnly`, `SameSite=Strict`, `Secure` on HTTPS | The session length, 30 days by default, or until the browser closes when **Keep me signed in on this device** is off |
| `contrack:draft:…`           | Local storage   | A note that you have not saved yet                             | Until you save it or sign out. A draft older than 30 days is dropped when it is next read                            |
| `contrack.map.lastView`      | Local storage   | Where the map last looked                                      | Until you sign out                                                                                                   |
| `contrack.lastIdentifier`    | Local storage   | Your username or email, for the sign-in form                   | Until you select **Not you?**                                                                                        |
| `contrack:import:…`          | Local storage   | The running import's file name                                 | Until the import ends                                                                                                |
| `contrack.theme` and others  | Local storage   | Your theme, layout and last import source                      | Kept                                                                                                                 |
| `contrack_recent_contacts:…` | Session storage | The ids of contacts you opened                                 | Until the tab closes                                                                                                 |
| `contrack_scroll_…`          | Session storage | The list's scroll place. The key holds the search you typed    | Until the tab closes                                                                                                 |

**Sign out** ends the session on the server, and removes your note drafts and
the map's last view from the browser. The remembered sign-in name and the
theme and layout choices stay. Session storage stays until the tab closes. On
a shared computer, also select **Not you?** on the sign-in screen.

## Related

- [AI](ai.md#privacy)
- [Self-hosting](self-hosting.md#security-checklist)
- [Accounts and sign-in](accounts.md)
- [Configuration reference](configuration.md#data-lifecycle)
