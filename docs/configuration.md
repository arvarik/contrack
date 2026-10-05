# Configuration reference

This page lists every environment variable and every setting, with its
default. For the steps, see [Self-hosting](self-hosting.md) and [AI](ai.md).

## How settings and variables combine

Contrack needs no configuration to start. Most settings live in the app.
Environment variables cover what the app cannot set for itself, such as the
port, the data folder and sign-in, and setups that never open the app.

- **Where variables come from.** The server reads `.env` from the folder it
  starts in. A variable that the environment already sets wins over the file.
  `.env.example` holds the common ones: `cp .env.example .env`.
- **Docker.** `docker run -e NAME=value` sets a variable. Compose reads `.env`
  beside `docker-compose.yml` and passes the variables that its `environment:`
  block lists.
- **Which one wins.** A variable and an app setting can name the same thing:

| App setting                                    | Variable                                                                      | Which one wins                                                                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| A provider key                                 | `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`                       | The variable. The provider row says which, such as **Set by GEMINI_API_KEY**                                              |
| A model: Fast, Strong, web search or embedding | `AI_QUICK_MODEL`, `AI_DEEP_MODEL`, `AI_RESEARCH_MODEL`, `AI_EMBEDDINGS_MODEL` | A model pinned in the app. With none, the variable, and the select says **From AI_QUICK_MODEL** or its own variable       |
| **SearXNG address**                            | `SEARXNG_URL`                                                                 | The variable. The field is locked                                                                                         |
| **Use AI on this instance**                    | `AI_DISABLED`                                                                 | The variable holds AI off, and the switch is locked                                                                       |
| **Outgoing mail**                              | `SMTP_URL`, with `MAIL_FROM` and `MAIL_REPLY_TO`                              | The variable. The page shows its values read only                                                                         |
| **Google OAuth client**                        | `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`                     | The variables, when both are set. The field is locked                                                                     |
| **Trash**, **Backups**, **Snapshots to keep**  | `TRASH_RETENTION_DAYS`, `BACKUP_INTERVAL_HOURS`, `BACKUP_KEEP`                | A value saved in the app, then the variable, then the default. While the variable is set, the app cannot change the field |

For the last row, set the variable before anyone saves a value in the app. A
value saved earlier keeps winning.

## Environment Variables

| Variable                         | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Default                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| `AI_PROVIDER`                    | The provider that **Automatic** tries first: `gemini`, `openai` or `anthropic`. A bare model name in an `AI_*_MODEL` pin also goes to it                                                                                                                                                                                                                                                                                                                                                                                       | `gemini`                                        |
| `GEMINI_API_KEY`                 | Google Gemini API key. It wins over a key saved in the app                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | None                                            |
| `OPENAI_API_KEY`                 | OpenAI API key. It always calls OpenAI itself: a local model server is an OpenAI-compatible server                                                                                                                                                                                                                                                                                                                                                                                                                             | None                                            |
| `ANTHROPIC_API_KEY`              | Anthropic API key                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | None                                            |
| `AI_DISABLED`                    | `true` or `1` turns AI off for the whole instance. **Use AI on this instance** cannot turn it back on. Local search keeps working                                                                                                                                                                                                                                                                                                                                                                                              | `false`                                         |
| `AI_QUICK_MODEL`                 | Pins the **Fast model**, as `model` or `provider:model`, such as `anthropic:claude-sonnet-5`. A model pinned in the app wins                                                                                                                                                                                                                                                                                                                                                                                                   | Automatic                                       |
| `AI_DEEP_MODEL`                  | Pins the **Strong model**, in the same form                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Automatic                                       |
| `AI_RESEARCH_MODEL`              | Pins the **Web search model**, in the same form                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Automatic                                       |
| `AI_EMBEDDINGS_MODEL`            | Pins a hosted embedding model, in the same form. A change rebuilds both vector indexes                                                                                                                                                                                                                                                                                                                                                                                                                                         | The built-in local model                        |
| `SEARCH_RERANK_MODEL`            | The local model that reorders the top of Ask Contrack's local list. `off` turns it off. Another model downloads once, which needs `MODEL_DOWNLOADS=true`                                                                                                                                                                                                                                                                                                                                                                       | `Xenova/ms-marco-TinyBERT-L-2-v2`               |
| `SEARCH_RERANK_BUDGET_MS`        | The most milliseconds that model may add to a question. Later scores are dropped, and the list keeps its order                                                                                                                                                                                                                                                                                                                                                                                                                 | `25`                                            |
| `MODEL_DIR`                      | The folder of model files that the server reads before it downloads anything, as `<folder>/<model id>/<file>`. `npm run models:fetch` fills it                                                                                                                                                                                                                                                                                                                                                                                 | `DATA_DIR/models` (image: `/app/models`)        |
| `MODEL_DOWNLOADS`                | `false`, `0`, `off` or `no` stops model downloads from huggingface.co. A model that is not on disk then fails to load, and the log says how to fetch it                                                                                                                                                                                                                                                                                                                                                                        | `true` (image: `false`)                         |
| `TRANSFORMERS_CACHE`             | The folder that the server writes downloaded model files to                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `DATA_DIR/.cache` when `DATA_DIR` is set        |
| `SEARXNG_URL`                    | The base URL of your SearXNG, for contact research. It wins over an address saved in the app                                                                                                                                                                                                                                                                                                                                                                                                                                   | None                                            |
| `HOST`                           | The interface that the server listens on. `0.0.0.0` listens on every interface                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `127.0.0.1` (image: `0.0.0.0`)                  |
| `PORT`                           | The port that the server listens on                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `3210`                                          |
| `PUBLIC_URL`                     | The address people open, such as `https://crm.example.com`, with no path. Mail sends no sign-in, reset or invitation link without it. A bad value stops the start                                                                                                                                                                                                                                                                                                                                                              | Taken from each request                         |
| `TRUST_PROXY_HOPS`               | How many reverse proxies are in front, from 0 to 10. `0` believes no `X-Forwarded-*` header. Set `1` behind one proxy. Another value stops the start                                                                                                                                                                                                                                                                                                                                                                           | `0`                                             |
| `CORS_ORIGIN`                    | Allows cross-origin requests from this one origin. The app itself needs none                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Off                                             |
| `ALLOWED_HOSTS`                  | While sign-in is off, and until the first account exists, the server answers only local names: an IP address, `localhost`, a name with no dot, or one under `.local`, `.lan`, `.home`, `.corp`, `.localdomain`, `.home.arpa` or `.internal`, plus the `PUBLIC_URL` host. List other names, comma-separated, such as a Tailscale `.ts.net` name. `.example.com` allows every name under it, `*` allows all. A reverse proxy must pass the original Host on (nginx `proxy_set_header Host $host`, Apache `ProxyPreserveHost On`) | Local names only                                |
| `AUTH_REQUIRED`                  | `true` makes everyone sign in with an account. The first visit creates the first account                                                                                                                                                                                                                                                                                                                                                                                                                                       | `false`                                         |
| `API_TOKEN`                      | **Deprecated.** One machine token for `Authorization: Bearer`, which acts as the first admin. Setting it also turns sign-in on. Use a personal token instead. Removed in 3.0                                                                                                                                                                                                                                                                                                                                                   | None                                            |
| `AUTH_TOKEN`                     | **Removed.** The server refuses to start while it is set                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | None                                            |
| `SMTP_URL`                       | The mail server, as `smtp://user:pass@host:587` or `smtps://user:pass@host:465`. It wins over **Outgoing mail**                                                                                                                                                                                                                                                                                                                                                                                                                | None                                            |
| `MAIL_FROM`                      | The sender address, such as `Contrack <noreply@example.com>`. Read only with `SMTP_URL`                                                                                                                                                                                                                                                                                                                                                                                                                                        | The SMTP user name, when it is an email address |
| `MAIL_REPLY_TO`                  | The Reply-To address. Read only with `SMTP_URL`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | None                                            |
| `GOOGLE_OAUTH_CLIENT_ID`         | The OAuth client ID for the **Google Workspace** connector. Read only when `GOOGLE_OAUTH_CLIENT_SECRET` is set too                                                                                                                                                                                                                                                                                                                                                                                                             | None                                            |
| `GOOGLE_OAUTH_CLIENT_SECRET`     | The OAuth client secret for the **Google Workspace** connector                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | None                                            |
| `CONNECTOR_SYNC_CONCURRENCY`     | The most connector syncs that run at once                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `2`                                             |
| `JOB_CONCURRENCY`                | The most background jobs that run at once, such as a backup or the daily sweep. An integer of at least 1. Another value logs a warning and runs the default                                                                                                                                                                                                                                                                                                                                                                    | `2`                                             |
| `CONNECTORS_ALLOW_PRIVATE_HOSTS` | `true` lets the **Calendar** and **Mailbox (IMAP)** connectors reach private network addresses. The server logs a warning at start                                                                                                                                                                                                                                                                                                                                                                                             | `false`                                         |
| `MAP_STYLE_LIGHT`                | The basemap style for the light palette: an `https://` URL or a root-relative path such as `/map/style.json`                                                                                                                                                                                                                                                                                                                                                                                                                   | OpenFreeMap `positron`                          |
| `MAP_STYLE_DARK`                 | The basemap style for the dark palette, with the same rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | OpenFreeMap `dark`                              |
| `DATA_DIR`                       | The folder for the database, uploads, backups, model files and `secret.key`                                                                                                                                                                                                                                                                                                                                                                                                                                                    | The working folder (image: `/app/data`)         |
| `CONTRACK_SECRET_KEY`            | 64 hex characters that encrypt the credentials the database stores. A bad value stops the start                                                                                                                                                                                                                                                                                                                                                                                                                                | A key in `DATA_DIR/secret.key`                  |
| `TRASH_RETENTION_DAYS`           | Days a deleted contact stays in **Trash**, from 1 to 365                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `30`                                            |
| `BACKUP_INTERVAL_HOURS`          | Hours between snapshots, from 0 to 168. `0`, or a value that is not a number, turns the schedule off                                                                                                                                                                                                                                                                                                                                                                                                                           | `24`                                            |
| `BACKUP_KEEP`                    | How many snapshots to keep, from 1 to 100                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `7`                                             |
| `NODE_ENV`                       | `production` serves the built app from `dist/` with the strict Content-Security-Policy. Anything else runs the Vite dev server, and the policy also allows its inline script and reload socket                                                                                                                                                                                                                                                                                                                                 | Development (image: `production`)               |
| `DISABLE_BACKGROUND_JOBS`        | `true` skips the model load, the backfills, backups, the trash purge and every schedule. For tests and throwaway instances                                                                                                                                                                                                                                                                                                                                                                                                     | `false`                                         |
| `DISABLE_CPU_WORKER`             | `true` runs the embedding model on the request thread, not on a worker thread. Only for a Node build that cannot start threads. Ask Contrack then skips its local reranker                                                                                                                                                                                                                                                                                                                                                     | `false`                                         |

**Retired variables.** Contrack does not read `AI_TIER` or `MAPBOX_API_KEY`.
When one of them is set, the server logs one warning at start that says what
replaced it. `AUTH_TOKEN` is different: it stops the start, as its row says.

**Development and test switches.** These change one process. A deployment does
not need them.

| Variable                      | What it does                                                                                                 | Default |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ | ------- |
| `DISABLE_HMR`                 | `true` turns off Vite hot reload. Each dev server keeps its reload socket on its own port                    | `false` |
| `VITEST`                      | Vitest sets it, never a person. Under it, the server refuses to open `./curator.db` unless `DATA_DIR` is set | None    |
| `IMPORT_SETTLE_MS`            | How long an import that does not stream waits before its duplicate check, in milliseconds. Tests shorten it  | `3000`  |
| `AI_GATEWAY_TIMEOUT_OVERRIDE` | Replaces the time limit of every AI call, in milliseconds. Tests and evals use it                            | None    |

**Docker.** `docker-compose.yml` passes every variable in the first table to
the container, except eight. The image sets `HOST`, `PORT`, `DATA_DIR` and
`NODE_ENV` itself, and a value meant for a local run would break it.
`DISABLE_BACKGROUND_JOBS` and `DISABLE_CPU_WORKER` are switches for one
process, and a value meant for development would stop backups or the
embedding worker in the container. `TRANSFORMERS_CACHE` follows `DATA_DIR`
there, and `AUTH_TOKEN` stops the start. Compose passes `MODEL_DIR` and
`MODEL_DOWNLOADS` with the image's own values as defaults (`/app/models` and
`false`), because an empty value would point the server away from the models
that the image ships. `tests/unit/repo/envDocs.test.ts` fails when this table,
`.env.example`, the compose file and the code disagree.

## AI

The steps are in [AI](ai.md). This section lists the parts and the rules.

### Models and their variables

| Model in the app     | What uses it                                                                                                                                                                  | Variable              | OpenAI-compatible server |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------ |
| **Fast model**       | Ask Contrack planning and checks, the group brief, briefings, the daily insight, **Add from text**, people named in notes, mail summaries, and the fields that research fills | `AI_QUICK_MODEL`      | Yes                      |
| **Strong model**     | Email file summaries, AI duplicate checks, and the pages that SearXNG finds                                                                                                   | `AI_DEEP_MODEL`       | Yes                      |
| **Web search model** | The provider's own web search in contact research                                                                                                                             | `AI_RESEARCH_MODEL`   | No                       |
| **Embedding model**  | Search by meaning and duplicate matching                                                                                                                                      | `AI_EMBEDDINGS_MODEL` | Yes                      |

Each model is found in this order:

1. A model pinned in **Settings → Administration → AI**.
2. The variable, when it names a connected provider. The select then says
   **From AI_QUICK_MODEL**, or the variable that is set.
3. **Automatic**: the provider in `AI_PROVIDER`, then a fixed order, then any
   other connected provider. The **Fast model** tries Gemini, OpenAI,
   Anthropic. The **Strong model** and the **Web search model** try Gemini,
   Anthropic, OpenAI. The web search model skips OpenAI-compatible servers.

The embedding model has no **Automatic**: with no pin, it is the built-in
model. A pin written as `model` goes to the `AI_PROVIDER` provider. A pin
written as `provider:model` names `gemini`, `openai` or `anthropic`. To pin a
model on an OpenAI-compatible server, use the app.

The **Reranker** row is read-only. Only `SEARCH_RERANK_MODEL` changes it.

### What Automatic picks

| Model                                     | Gemini                  | OpenAI       | Anthropic          |
| ----------------------------------------- | ----------------------- | ------------ | ------------------ |
| **Fast model**                            | `gemini-3.5-flash-lite` | `gpt-6-luna` | `claude-haiku-4-5` |
| **Strong model** and **Web search model** | `gemini-3.8-flash`      | `gpt-6-sol`  | `claude-sonnet-5`  |

These are the fallbacks before a model list loads. Once it loads, each provider
takes the newest model of the same family. Gemini also skips a model that
Google paused with a `429` answer, until the pause ends. An OpenAI-compatible
server uses the first chat model in its list, for both the **Fast model** and
the **Strong model**.

Contrack loads each provider's model list when a key or a server is saved,
at start, and once a day. **Refresh the model list** loads it at once. The list
leaves out models that do not chat, deprecated models, and chat models more
than a year old when the provider dates them. **(?)** after a model name marks
a guess from the name, because OpenAI and OpenAI-compatible servers report
bare model names. A pin to Gemini, OpenAI or Anthropic gets one small test request before
it saves.

### OpenAI-compatible servers

| Field                  | Rule                                                                         |
| ---------------------- | ---------------------------------------------------------------------------- |
| **ID**                 | Letters, numbers and hyphens. The provider's ID becomes `custom:<ID>`        |
| **Name**               | The label in the app                                                         |
| **Base URL**           | An `http` or `https` URL that ends in `/v1`, such as `http://alpha:11434/v1` |
| **API key (optional)** | Stored encrypted. A local server needs none                                  |

Contrack asks an OpenAI-compatible server for a strict JSON schema first. When the
server refuses it, Contrack falls back to JSON mode, then to instructions in
the prompt, and remembers what each model accepts.

### Embedding model changes

- One model serves both vector indexes: search and duplicates.
- The built-in model is `Xenova/all-MiniLM-L6-v2`, with 384 dimensions. It runs
  on a worker thread on the CPU.
- A hosted model is an embedding model that Gemini, OpenAI or an
  OpenAI-compatible server lists. Anthropic has none. Contrack embeds a short text first to learn the
  vector width, and refuses a model that returns nothing.
- Gemini embeds a question, a contact and a duplicate check each with its own
  task type, which ranks better than one type for all three.
- A change rebuilds both indexes and embeds every contact again, in the
  background. Keyword search keeps working meanwhile.
- While AI is off for the instance, the built-in model serves, whatever is
  pinned.
- With a hosted model, the search index embeds new and changed contacts only
  after someone confirms on the **Search by meaning** card, under the
  embedding model.
- A hosted model embeds no contact of an account with **Use AI for my
  account** off, for search or for duplicates.

### Model files and offline installs

Two small models run on the CPU:

| Model                             | Use                                 | Size        |
| --------------------------------- | ----------------------------------- | ----------- |
| `Xenova/all-MiniLM-L6-v2`         | The built-in embedding model        | About 24 MB |
| `Xenova/ms-marco-TinyBERT-L-2-v2` | The local reranker for Ask Contrack | About 5 MB  |

The server looks for each file in this order:

1. the download cache, `TRANSFORMERS_CACHE` (`DATA_DIR/.cache` when `DATA_DIR`
   is set, else a folder inside `node_modules`)
2. the model folder, `MODEL_DIR` (default `DATA_DIR/models`)
3. huggingface.co, when `MODEL_DOWNLOADS` allows it

A download needs no Hugging Face account and sends no contact data. Hugging
Face sees the server's address and the model names.

- **Docker.** The image downloads both models at build time into
  `/app/models`, and sets `MODEL_DOWNLOADS=false`. A container never reaches
  huggingface.co.
- **Without Docker.** `npm run models:fetch` downloads the files, pinned to one
  upstream commit, into `MODEL_DIR`. It checks each file's SHA-256 and skips a
  file that is already there. Then set `MODEL_DOWNLOADS=false`.
- **Script options.** `npm run models:fetch -- --check` checks the folder and
  downloads nothing. `npm run models:fetch -- <folder>` fills another folder.
  `HF_ENDPOINT` points the script at a mirror. The script reads `.env` in the
  working directory, as the server does, so it fills the folder that
  `DATA_DIR` or `MODEL_DIR` names there.
- **Another model.** A `SEARCH_RERANK_MODEL` or embedding model outside the
  pinned list is not in the image. Set `MODEL_DOWNLOADS=true` to let the server
  download it once, or copy its files into `MODEL_DIR/<model id>/`.

With `MODEL_DOWNLOADS=false` and a file missing, the model does not load. The
log names the folder and the command that fixes it, and search keeps working
on keywords.

## Map

### Basemap

The map draws [OpenFreeMap](https://openfreemap.org/) styles. They need no API
key and no sign-up. Two variables point each palette at another style:

```bash
MAP_STYLE_LIGHT="https://tiles.openfreemap.org/styles/positron"
MAP_STYLE_DARK="https://tiles.openfreemap.org/styles/dark"
```

These two values are the defaults. A value is an `https://` URL with no user
name or password, or a root-relative path such as `/map/style.json`. A value
the server cannot read writes one warning to the log, and the default style
loads.

The Content-Security-Policy allows the origin of each style URL. A
root-relative style adds nothing, because it is on the same origin. A style
cannot load tiles, glyphs or sprites from a third host. Serve them from the
style's host, or from Contrack.

### Self-hosted and offline basemaps

Contrack can serve its own basemap, with no tile server. The map reads tiles
from one `.pmtiles` archive with `pmtiles://`, and the server answers the
range requests.

1. **The tiles.** Get a planet build from
   [Protomaps](https://maps.protomaps.com/builds/), and cut it to your area
   with the `pmtiles` tool. The box is west, south, east, north:

   ```bash
   pmtiles extract https://build.protomaps.com/20260901.pmtiles \
     public/map/area.pmtiles --bbox=-0.6,51.2,0.4,51.8
   ```

2. **The glyphs and the sprite.** Copy the `fonts/` and `sprites/` folders of
   [protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets)
   into `public/map/`.
3. **The style**, at `public/map/style.json`. The source names the archive with
   a root-relative path. The
   [`@protomaps/basemaps`](https://www.npmjs.com/package/@protomaps/basemaps)
   package writes the layers for a named theme.

   ```json
   {
     "version": 8,
     "glyphs": "/map/fonts/{fontstack}/{range}.pbf",
     "sprite": "/map/sprites/v4/light",
     "sources": {
       "protomaps": {
         "type": "vector",
         "url": "pmtiles:///map/area.pmtiles",
         "attribution": "© OpenStreetMap"
       }
     },
     "layers": [
       {
         "id": "background",
         "type": "background",
         "paint": { "background-color": "#f4f2ee" }
       },
       {
         "id": "water",
         "type": "fill",
         "source": "protomaps",
         "source-layer": "water",
         "paint": { "fill-color": "#cfe0f0" }
       }
     ]
   }
   ```

4. **The setting.** Set `MAP_STYLE_LIGHT="/map/style.json"`, and a dark style
   in `MAP_STYLE_DARK`, then restart.

The build copies `public/` into `dist/`. On a running production instance, put
the files under `dist/map/`. With Docker, mount the folder at `/app/dist/map`.

### Geocoding

Contrack places addresses on the map with Nominatim (OpenStreetMap). It needs
no key and no setting.

- The server sends each address to `nominatim.openstreetmap.org` in the
  background, one request a second.
- When an address finds nothing, the server tries a broader one: it drops the
  first part before a comma, up to four tries.
- Answers are cached for every account. An address that found nothing is tried
  again after 7 days.
- At start, the server queues contacts that have an address and no pin.
- The geocoder never moves a pin that a person placed (see
  [Move a pin by hand](map.md#move-a-pin-by-hand)).

## Mail

Set the mail server in **Settings → Administration → Outgoing mail**, or with
`SMTP_URL`.

- The page's fields are **Host**, **Port**, **Use TLS**, **Username**,
  **Password**, **From address** and **Reply-to**. The password is stored
  encrypted.
- `SMTP_URL` uses `smtp://` (plain or STARTTLS, port 587 by default) or
  `smtps://` (TLS from the start, port 465 by default). Percent-encode special
  characters in the user name and the password.
- With `SMTP_URL` set, the page shows its values read only, and `MAIL_FROM`
  and `MAIL_REPLY_TO` apply.
- Mail counts as set up only with a host and a sender address. Without
  `MAIL_FROM`, the sender is the SMTP user name, when it is an email address.
- Links in mail need `PUBLIC_URL` (see
  [Outgoing mail](accounts.md#outgoing-mail)).

## Encryption key

Contrack encrypts every credential that the database stores, with AES-256-GCM:
AI provider keys and OpenAI-compatible server keys saved in the app, the SMTP password,
connector credentials, and the Google OAuth client secret. Keys given as
variables are not stored.

- `CONTRACK_SECRET_KEY` holds the key as 64 hex characters (32 bytes). Make
  one with `openssl rand -hex 32`.
- Without it, Contrack writes a key to `DATA_DIR/secret.key`, with mode
  `0600`, the first time it stores a credential.
- A value that the key cannot open reads as missing. An AI provider then shows
  as not connected, and the log says that the saved key "cannot be decrypted".
  Enter the credential again.
- There is no key rotation. A new key means entering every stored credential
  again.
- Snapshots hold the encrypted values, so keep the key with them. The rest of
  the database is not encrypted.

## Data lifecycle

| What                            | Kept for                                   | Setting                                             |
| ------------------------------- | ------------------------------------------ | --------------------------------------------------- |
| Deleted contacts in **Trash**   | 30 days, then deleted at the daily cleanup | **Trash** in **General**, `TRASH_RETENTION_DAYS`    |
| Snapshots                       | The newest 7                               | **Snapshots to keep** in **General**, `BACKUP_KEEP` |
| Audit log entries               | 90 days                                    | None                                                |
| Connector run history           | 90 days                                    | None                                                |
| AI usage activity               | 30 days                                    | None                                                |
| Finished imports and their rows | 30 days                                    | None                                                |
| Revoked API tokens              | 30 days after the revoke                   | None                                                |
| Revoked or expired invitations  | 30 days                                    | None                                                |
| Sign-in and reset link records  | 30 days                                    | None                                                |
| Weekly score snapshots          | 26 weeks                                   | None                                                |

The trash cleanup runs at start and every 24 hours. A daily sweep removes the
other rows and expired sessions, and checkpoints the database's write-ahead
log. The snapshot schedule is in [Backups and restore](self-hosting.md#backups-and-restore).

## Personal settings

Each account keeps its own settings on the server. They follow the person to
another device, and two accounts in one browser never share them. A settings
page with a changed value ends with **Reset to defaults**. Scripts read and
change them with `GET` and `PATCH /api/auth/preferences` (see
[Authentication](api-reference.md#authentication)).

| Setting                               | Page                 | Choices                            | Default          | Key                  |
| ------------------------------------- | -------------------- | ---------------------------------- | ---------------- | -------------------- |
| **Theme**                             | Appearance           | Light, Dark, System                | System           | `theme`              |
| **Accent colour**                     | Appearance           | Any colour                         | `#006a91`        | `accent`             |
| **Text size**                         | Appearance           | Default, Large                     | Default          | `textScale`          |
| **Motion**                            | Appearance           | System, Reduced                    | System           | `motion`             |
| **Corvid motion**                     | Appearance           | Full, Subtle, Off                  | Full             | `mascotMotion`       |
| **List density**                      | Appearance           | Comfortable, Compact               | Comfortable      | `listDensity`        |
| **Where Contrack opens**              | Network and contacts | Network, Pulse                     | Network          | `startPage`          |
| **Default sort**                      | Network and contacts | Name, Recent                       | Name             | `listSort`           |
| **Recent contacts**                   | Network and contacts | 0 to 10. 0 hides the row           | 3                | `recentLimit`        |
| **Default cadence**                   | Network and contacts | Weekly, Monthly, Quarterly, Yearly | Quarterly        | `defaultCadenceDays` |
| **Track new contacts**                | Network and contacts | On, Off                            | Off              | `trackNewContacts`   |
| **Week starts on**                    | Network and contacts | Monday, Sunday                     | Monday           | `weekStart`          |
| **Weather**                           | Network and contacts | On, Off                            | Off              | `showWeather`        |
| **Temperature unit**                  | Network and contacts | °C, °F                             | °C               | `tempUnit`           |
| **Single-key shortcuts**              | Keyboard             | On, Off                            | On               | `singleKeyShortcuts` |
| **Use AI for my account**             | Privacy and AI       | On, Off                            | On               | `aiAssist`           |
| **Auto-merge sensitivity**            | Duplicates           | Cautious, Balanced, Eager          | Balanced         | `dedupePreset`       |
| **Check new contacts automatically**  | Duplicates           | On, Off                            | On               | `dedupeOnCreate`     |
| **Check imports automatically**       | Duplicates           | On, Off                            | On               | `dedupeOnImport`     |
| **Enrich new contacts automatically** | Contact enrichment   | On, Off                            | Off              | `autoEnrich`         |
| **Web search engine**                 | Contact enrichment   | Instance default, or an engine     | Instance default | `webSearchEngine`    |

- **Default cadence** stores days: 7, 30, 90 or 365. A value of 60 or 180 still
  loads, and the select shows it as a fifth choice.
- **Auto-merge sensitivity** stores `conservative`, `default` or `aggressive`.
- **Use AI for my account** shows as one **Use AI** switch on an instance
  with one account. That switch is the instance's switch, and turning it on
  also turns `aiAssist` back on.
- **Web search engine** stores `default`, `provider`, `searxng` or
  `combined`. `default` follows the engine that an admin sets for the
  instance. On an instance with one account, the page shows and changes the
  instance's engine, so this stays `default`.
- **Search history** on **Privacy and AI** is not a preference. Contrack keeps
  each question that you ask in Ask Contrack and the command palette, and
  **Clear history** deletes them all (see [History](search.md#history)).
- The app also remembers four choices outside **Settings**: the Pulse layout
  (`pulseLayout`), whether the Ask Contrack history panel is open
  (`askHistoryOpen`, open by default), whether **Map insights** is open
  (`mapPaneOpen`, open by default), and the map layer (`mapLayer`, **Pins** or
  **Heat**, **Pins** by default).

## Instance settings

An admin sets these for every account. They are in **Settings →
Administration**.

| Setting                                     | Page          | Default                   | Range or form                                                        | Variable                                                |
| ------------------------------------------- | ------------- | ------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------- |
| **Instance name**                           | General       | None (Contrack)           | Up to 60 characters                                                  | None                                                    |
| **Anyone can create an account**            | General       | Off                       | On, Off                                                              | None                                                    |
| **Sign in by emailed link**                 | General       | Off                       | Needs **Outgoing mail**                                              | None                                                    |
| **Session length**                          | General       | 30 days                   | 1 to 365 days, for new sign-ins                                      | None                                                    |
| **Trash**                                   | General       | 30 days                   | 1 to 365 days                                                        | `TRASH_RETENTION_DAYS`                                  |
| **Backups**                                 | General       | 24 hours                  | 0 to 168 hours. Off is 0                                             | `BACKUP_INTERVAL_HOURS`                                 |
| **Snapshots to keep**                       | General       | 7                         | 1 to 50 in the app, 1 to 100 by variable                             | `BACKUP_KEEP`                                           |
| **Google OAuth client**                     | General       | None                      | A client ID and a client secret                                      | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`  |
| Mail server                                 | Outgoing mail | None                      | Host, port, TLS, user, password, sender, Reply-To                    | `SMTP_URL`, `MAIL_FROM`, `MAIL_REPLY_TO`                |
| **Use AI on this instance**                 | AI            | On                        | On, Off                                                              | `AI_DISABLED`                                           |
| Provider keys and OpenAI-compatible servers | AI            | None                      | One key per provider, any number of servers                          | `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` |
| **Fast model**, **Strong model**            | AI            | Automatic                 | A model                                                              | `AI_QUICK_MODEL`, `AI_DEEP_MODEL`                       |
| **Embedding model**                         | AI            | Built-in                  | A model                                                              | `AI_EMBEDDINGS_MODEL`                                   |
| **Allow web search**                        | AI            | On                        | On, Off                                                              | None                                                    |
| **Web search model**                        | AI            | Automatic                 | A Gemini, OpenAI or Anthropic model                                  | `AI_RESEARCH_MODEL`                                     |
| **SearXNG address**                         | AI            | None                      | An `http` or `https` URL, not a cloud metadata or link-local address | `SEARXNG_URL`                                           |
| **Web search engine**                       | AI            | The provider's own search | The provider, SearXNG, or both                                       | None                                                    |

The **Trash**, **Backups** and **Snapshots to keep** rows offer set choices. A
value set another way shows as it is, with a note. A change to **Backups**
restarts the schedule at once.

## Related

- [Self-hosting](self-hosting.md)
- [AI](ai.md)
- [Accounts and sign-in](accounts.md#administration)
- [Map](map.md)
- [REST API reference](api-reference.md#conventions)
