# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- **Mailed links take their address from `PUBLIC_URL` only.** A password-reset request built its link from the request's `X-Forwarded-Host` or `Host`, which the requester controls. Anybody could ask for a reset of a known address and have the real email carry a genuine token inside a link to their own server. `mailLinkOrigin()` (`server/utils/publicOrigin.ts`) returns `PUBLIC_URL` or null, and reset links, magic links, admin reset links and mailed invitations use it. Without `PUBLIC_URL`, a reset request answers 202 and sends nothing, magic-link sign-in is off, an admin reset answers `409 PUBLIC_URL_REQUIRED`, and an invitation is created but not mailed. `/api/auth/status` reports `mailConfigured` only when mail can carry a link, `GET /api/admin/mail` gains `publicUrl`, the Outgoing mail page says when it is missing, and the server warns at boot.
- **The server trusts no proxy unless told.** `trust proxy` was 1 always, so with no proxy in front a client's own `X-Forwarded-For` chose the address that the login, reset-link and AI rate limits counted and that the audit log wrote down. `TRUST_PROXY_HOPS` (default 0, a whole number up to 10, and a boot error otherwise) sets it. `publicOrigin` reads `req.host`, so `X-Forwarded-Host` also counts only from a trusted hop. Behind a reverse proxy, set `TRUST_PROXY_HOPS=1`, or HTTPS requests are no longer marked secure.
- **Docker Compose publishes the port on this machine only.** `"127.0.0.1:3210:3210"` replaces `"3210:3210"`, because auth is off by default and the old mapping handed every contact to anybody on the same network. The README's `docker run` does the same.
- **Every response carries a CSP, and two more headers.** The policy was production-only, so an instance run without `NODE_ENV=production` had none. Dev mode now gets the same policy plus `'unsafe-inline'` in `script-src` and `ws:` in `connect-src` for Vite. A `Permissions-Policy` switches off the camera, microphone, geolocation, payment, USB, screen capture and ad topics. A request that arrived over HTTPS gets `Strict-Transport-Security: max-age=31536000`. The policies live in `server/utils/securityHeaders.ts`. The client sets zod's `jitless`, so zod's `new Function` probe no longer reports a CSP violation on every page load.
- **The data is readable by its owner only.** At start the server sets its umask to 077 and removes group and other access from `curator.db`, its `-wal` and `-shm`, `secret.key`, `uploads/`, `backups/`, `.cache/` and `models/` (`server/utils/privateFiles.ts`). The database and backups were 0644, so on a machine with more than one account every other user could read every contact.
- **`secret.key` is in `.gitignore`.** Outside Docker the key sits in the project root, and only a global ignore file stopped a commit of the key that decrypts every stored credential.
- **The CSV export neutralizes formulas.** A cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading `'`, so a company name from a sync, an import or AI research cannot run as a formula when the owner opens the export.
- **Research citation links accept http(s) only.** `researchSourceSchema` and `researchFindingSchema` refuse any other scheme. A stored record with a bad source drops that source, and a bad finding URL becomes empty, so one bad URL never breaks the record. Both links in `ResearchCard` go through `safeHref()`.
- **Link previews fetch the page through `safeFetch`.** The unfurl used plain `fetch` after a separate address check, which left the DNS-rebinding gap that `safeFetch` closes at connect time.

### Added

- **The search benchmark compares local embedding models.** `node scripts/benchmark-search.ts --contacts 300 --embedder <model>` builds both indexes with another local model from its `EMBEDDERS` list and embeds every question with it. A local model is a card (`LocalModel` in `server/ai/embedder.ts`): its id, width, pooling and the prefix it wants for a question or a document. The CPU worker's embed job now names its model and pooling, as the rerank job names its model. At 300 contacts the quality numbers are the same on every run. Measured on 2026-10-01, the local answer's MRR before the cross-encoder was 0.956 with the bundled MiniLM, 0.959 with bge-small-en-v1.5, 0.966 with e5-small-v2, 0.960 with gte-small, 0.956 with multilingual-e5-small and 0.973 with nomic-embed-text-v1.5. A question took 0.7, 1.8, 1.4, 1.2, 1.6 and 4.5 ms to embed. The bundled model stays the default.
- **`npm run db:enrich` makes a test network that looks lived in, on any database.** `scripts/bench/run.ts` takes one account's contacts that carry the `benchseed` tag. When the account has none, `--apply` first creates 5,000 people (`--count` changes it), each with a name in the language of their city's country, one of 24 cities or 54 towns, an industry, a company, a role and one to three tags. Faker has no names in Latin letters for Japan, South Korea, Israel, Greece, Kenya, Singapore, Estonia and Lithuania, so `scripts/bench/names.ts` lists common ones, with the female form of a Greek or a Lithuanian surname. Then it gives every tagged contact a real street address with its pin, in one of 126 real neighbourhoods or near a town's centre, where a town's postcode starts with its real prefix and uses only the letters its country uses. Athens, Sapporo, Tallinn and Vilnius use real main streets. It also adds a work history, schools, links, custom fields, notes whose title and body belong together, follow-ups, pronouns that follow the name, and a local phone number. Text that a contact already has stays. It is dry-run unless you pass `--apply`, and it can run again: every row it adds has an id that starts with `be-`, and a run removes those rows and writes them again. The same `--seed` and `--now` give the same database, and the same people, ids included, on another database. With no tagged contact and no `--owner`, the account is the one the app uses when nobody signs in. A new contact gets the default avatar and the phonetic hash that the app gives, and a plan that adds pronouns redraws the default face, so the next boot leaves every planned date alone. The pin is written with the address, so the geocoder has nothing to fetch. Run it with the server stopped.
- **Addresses are searchable, by keyword at the lowest rank, and by Ask with AI.** `contacts_fts` has an `addresses` column with every address a contact has, at weight 0.5, below name 10, company 5, role 3, tags 3, headline 2, location 2, about 1, industry 1 and emails and phones 1. A street, a postcode or a city written only in an address finds the contact in the Network search box and the palette, and in Ask Contrack with AI off, where a contact found that way shows **Address** after its other matching fields. With AI on, Ask checks addresses too. A street or a postcode that the planner reads as a place, such as "Who lives on Clement St?" or "Who is in M4M 1H0?", is proved against the addresses by the database. The AI check sees each candidate's addresses and may cite one, and the server confirms the quote. The reason names the whole address: "Has an address at 1454 Clement St, San Francisco, CA 94118". Adding, changing or deleting an address updates the index. The FTS schema version is 6, so the first boot after upgrade rebuilds the index, which takes milliseconds.
- **Seven general questions join "Try asking".** "Who haven't I contacted in over 3 months?", "Who do I track?", "Who am I not tracking yet?", "Whose details haven't been updated in over 6 months?", "Who is missing an email address?", "Who is missing a phone number?" and "Who is missing a location?" name no value, so every network can ask them. `shared/generalQuestions.ts` holds each with its facets, the same ones the Pulse Inbox opens. A question is in the pool only when its facets find a contact, and the search reads the question, written exactly like that, as its facets, so it answers with no model and the same list as the facet.
- **A long answer to a question made only of facets counts, links and narrows.** Ask lists 30 people at most. For a question made only of facets, `POST /api/search/semantic` also answers `total`, `facets` and `refine`. The header says "30 of 1,501 matches", the palette's heading says "AI query results · 30 of 1,501", and the history saves 1,501. **See all in Network** opens the whole list for every such question the Network list can read, which leaves out `near:`. Up to six chips under the count narrow the answer: tracking, the most common industries, cities, companies and tags, and a contact in the last 30 days, each with the number of people it keeps. Each kind gives its first chip before any kind gives a second. A press asks the question again with the facet added. One pass over the list counts every chip with the search's own facet SQL, so a chip's number is the narrowed answer's total. On 5,825 contacts, "Who do I track?" answers in 14 to 37 ms with its chips.
- **Responses are compressed with brotli or gzip.** The server sent every body at full size, so an instance reached over the internet without a compressing proxy sent the slim contact list (6 MB for a network of 5,824 contacts) and the 1.1 MB map bundle as they were. `server/middleware/compression.ts`, with the `compression` package, now answers with brotli when the browser takes it, else gzip, else the body as it is, and sends `Vary: Accept-Encoding`. On that network the slim list goes out as 812 KB, the largest bundle as 295 KB and the starter pool as 4 KB instead of 28 KB, and over a 10 Mbit/s link the slim list arrives in 0.6 s instead of 4.6 s. Streams (`text/event-stream` and `application/x-ndjson`) go out uncompressed, so Ask's first line and the progress of an import, a duplicate scan or contact research still arrive as they are written. A byte range, a photo, a font and a body under 1 KB go out as they are. Brotli runs at quality 4, which costs about 14 ms of server CPU for the slim list, where gzip costs 31 ms. A reverse proxy needs no compression setting.
- **The palette's AI mode shows four of your own questions.** After `?` with nothing typed it showed four fixed examples, such as "Who do I know in London working in FinTech?", which find nobody in most networks. It now draws four from the same pool as "Try asking", through one hook (`useStarterDraw`) that the Ask page uses too.
- **The docs build as a GitHub wiki.** `npm run docs:wiki -- <folder>` (`scripts/docs/wiki.ts`) writes `Home.md`, a `_Sidebar.md` built from the index in `docs/README.md`, one page for each entry named from its title, and the images the pages show. A link to another page becomes a wiki link with its anchor, and a link to any other file in the repository points at GitHub.
- **The README's corvid moves on its perch.** `docs/brand/contrack-lockup-animated.svg` and its dark twin head the README with the bird alive: in a loop of about 25 seconds it blinks, looks about, preens, cocks its head, caws without a sound, looks back and stretches a wing. `scripts/brand/animatedLockup.ts` makes each act with the app's own makers in `src/lib/corvidMotion.ts`, from one fixed seed, and the rig draws every frame, written as SMIL animation so it plays inside an `<img>`. Each file is about 100 KB. With reduced motion the file shows the still logo. `npm run brand:icons` writes both files, and `tests/unit/frontend/brand/icons.test.ts` holds them to a fresh render and to the logo at every still moment.
- **Tests hold the docs to the code.** `tests/unit/repo/docsLinks.test.ts` fails on a broken link, image or anchor in the docs, the README, CONTRIBUTING or the agent notes, and on a page in `docs/` that the index does not list. `tests/unit/repo/docsCoverage.test.ts` fails when `docs/api-reference.md` misses a route in `ROUTE_MANIFEST` or names one that is gone, and when `docs/keyboard-shortcuts.md` misses a shortcut in `SHORTCUTS`.
- **Ask shows which fields make each person a match.** Each result carries `matchedOn`: the fields that answer the question, the contact's own text, and the question's words marked in it. The card shows one line per field, so "Who is interested in machine learning?" reads **Interests:** Machine Learning for one person and **Role:** Machine Learning Engineer for another. A field a filter or the AI check proved comes first, and one the AI check cited carries the sparkle. It needs no model call (`server/services/search/matchedOn.ts`, about 0.2 ms for 30 matches), so a list AI did not check, or with AI off, explains itself too.
- **"Try asking" draws six questions at random from a pool built from your contacts.** `GET /api/search/starters` returns up to 500 questions (it began at 40, which left a network of thousands asked about its six biggest companies and nothing else) about the industries, cities, companies, roles, interests, tags and industry-and-city pairs that two contacts share, and never more questions than contacts. A general question that finds some contacts and not all of them is offered past that cap, so a network of three still sees "Who is missing an email address?". The page draws six on each visit and after Clear, at most two of a kind. The server builds every account's pool after boot and again when an import commits, and the app fetches it when idle, so the questions are there when Ask opens. The Ask page no longer loads every contact to build its suggestions.
- **The search models ship with the Docker image, and nothing downloads them at boot.** `scripts/fetch-models.ts` (`npm run models:fetch`) downloads `Xenova/all-MiniLM-L6-v2` and `Xenova/ms-marco-TinyBERT-L-2-v2`, pinned to one upstream commit, and checks each file's SHA-256 against `PINNED_MODELS` (`server/services/search/modelFiles.ts`). The Docker build runs it into `/app/models`. `MODEL_DIR` (default `DATA_DIR/models`) is where the server reads model files before anything else, and `MODEL_DOWNLOADS=false` (the image's default) stops it from downloading at all. A container started with no network loads both models. A model that is not on disk fails with a log line that names the folder and the fix. `--check` checks a folder and downloads nothing, and `HF_ENDPOINT` names a mirror. The README and the AI search doc said search worked offline, which was not true on a first boot.
- **An instance-wide AI switch.** Settings → Administration → AI providers → "Use AI on this instance", or `AI_DISABLED=true`, which the switch cannot override. While it is off, `getProvider()` returns null, so no generation, provider embedding, model discovery, daily model-list refresh, auto-enrichment or email summary reaches a provider. The AI routes answer `403 AI_OFF_FOR_INSTANCE`, and Ask Contrack answers from local data. Stored keys stay. Embeddings move to the built-in model, and both vector indexes rebuild. `PUT /api/settings/ai/instance` (admin, audited, `409 AI_LOCKED_BY_ENV`) and `GET /api/ai/instance` are new, and the Privacy page shows the account switch off and disabled while the instance switch is off.
- **`npm run knip` finds code that nothing uses.** It reads `knip.jsonc`, checks `src` for unused files, exports and types, and counts the server, `shared`, `scripts` and the tests as users. It reports nothing today. `src/db/schema.ts` is left out of the check, because Drizzle reads that file's exports as the schema.

### Changed

- **Gemini embeddings say what each text is for.** A question is embedded as `RETRIEVAL_QUERY`, a contact or a passage as `RETRIEVAL_DOCUMENT`, and a duplicate check's text as `SEMANTIC_SIMILARITY`. Measured with `gemini-embedding-001` on the search gate's 300 contacts and 79 questions, the vector channel alone went from 0.906 to 0.924 recall@10 and from 0.858 to 0.899 MRR. On the labelled duplicate corpus (221 true pairs, 111 hard negatives), the rank of a duplicate's partner went from 0.809 to 0.892 MRR, and the separation from hard negatives from 0.762 to 0.873 AUC. `RETRIEVAL_DOCUMENT` for duplicates scored worse than no task type (0.756 MRR), and so did `CLUSTERING` (0.737), which is why the embedder has a third use, `similarity`, for dedupe. `gemini-embedding-2` answered the same with or without a task type. The id a Gemini model gives the vector stores ends in `+tasks`, so the first boot rebuilds both indexes once and embeds every contact again. That includes `gemini-embedding-2`, whose vectors do not change. A pin's dimension probe now sends the `document` use, so the pin is tested with the request the index makes. The built-in model reads no use, and its vectors do not change.
- **Search and dedupe reach their models through two interfaces, `Embedder` and `Reranker`.** `server/ai/embedder.ts` holds the embedder: the built-in model on the CPU worker, or a provider model through `AIProvider.embed`, as the embeddings capability names it. `server/ai/reranker.ts` holds the reranker: the cross-encoder on the CPU worker, as `SEARCH_RERANK_MODEL` names it. Each one says whether it is local, and the privacy and cost rules read that instead of the model's kind, so a model that is not local reads nothing of an account with AI off. Every embedding call says whether its text is a question or a document, for a model that embeds the two differently. Dedupe embeds through the embedder, no longer through search's code. The stage that reorders the local list moved to `server/services/search/rerank.ts`. The vectors, the rankings and the eval baselines are the same as before.
- **A draw for "Try asking" picks kinds first.** It shuffled the whole pool of 500, so seven general questions would almost never have shown. It now takes one question from each kind in turn, then a second, so six questions come from six different kinds when the pool has them. The Ask page still draws on a visit and after Clear.
- **The search gate measures addresses, and it fails when the address weight moves.** A third of its 300 contacts have a home or a work address, or both, in the format of their city: 18 targets by hand, and the distractors from a random stream of their own, so no other field changes. Nine queries are new. `address` holds a street, a postcode and a town that only one address names, which keyword search did not find before, and an address pasted with its country. `address-collision` holds a word that an address shares with a name, a company, a role, a location or a note, where the other field must rank first. An address weight of 3 fails all five channels, 0 fails four, and an index without the address text fails all five and the replay check. A weight of 0 still matches the column, so only the pasted address, whose city six contacts share, sees it. One of the 70 older queries moves: in `hybrid`, "product manager at Northwind Logistics" ranks its answer first, not second, because a new work address makes a rival's row longer and BM25 scores it lower. At 300 contacts and 79 queries, recall@10 / MRR is 0.684 / 0.684 for `sidebar`, 1.000 / 0.943 for `lexical`, 1.000 / 0.948 for `fused`, 1.000 / 0.984 for `hybrid` and 1.000 / 0.994 for `reranked`.
- **The Tracked chip on the Network list no longer shows a "Manage" link.** The chip keeps the list to the people you track. The Tracked contacts page is in Settings and behind "Manage" on the Keeping up card in Pulse.
- **The docs are rewritten for v2.** Twenty-one pages become seventeen flat pages in `docs/`, each written for the person who uses or runs Contrack: getting started, contacts, Pulse and tracking, search and Ask Contrack, the map, duplicates, import and sync, AI, keyboard shortcuts, accessibility, self-hosting, accounts, the configuration reference, MCP, the REST API reference and the architecture. Each page leads with tasks, uses the app's own words and links its neighbours, and the screenshots in `docs/images/` show fictional people. Facts that had gone stale were checked against the code and corrected, such as port 3000 in the examples, `APP_SECRET_KEY`, `contrack.db`, and duplicate detection on Gemini embeddings only.
- **CONTRIBUTING.md says how to do things.** Set up, where things live, the everyday commands, the rules a review checks, tests, docs, database changes, brand assets, commits, CI and releases, in one short page. The CI and release notes move there from `docs/ci-and-release.md`, with the coverage floor the config enforces.
- **The agent notes are condensed.** `.agent/ARCHITECTURE.md`, `STYLE.md` and `TESTING.md` keep the rules and drop the file inventories, the measurements and the resolved findings. `PHILOSOPHY.md` describes v2: accounts, tracking as a choice, local-first search and AI as a choice. `STATUS.md` says where v2 stands, what it changed, what is open, and the resolved issues that code comments still cite.
- **The corvid hunts beside and above the search column while AI works, never over the results.** It leaves the search box upward, hunts in the page's left or right margin (crossing over the top now and then), or along the band over the search box on a tablet or a phone, and comes home round the column, landing from above. A window with no room round the column shows the still bird instead.
- **Ask has no Refresh button.** It asked the same question again, and the server answered it from its cache with the same list. A list AI could not check, which the server never caches, has **Ask AI again** beside "Not verified by AI" instead.
- **Company logos are cached on disk, misses included.** `/api/logos/:domain` asks Google's favicon service at most once per domain, re-encodes the answer as a PNG of at most 128 px, and writes it atomically. A domain with no logo gets a `.miss` file and is asked again after 30 days. A failure that may pass waits 10 minutes in memory and answers `503` with `no-store`. Concurrent requests for one domain share one download, and the download has a timeout.
- **Google contact photos are copied into uploads.** A synced contact stored its `googleusercontent.com` URL, and the browser asked Google for it on every view. The sync now saves each photo as a 256 px JPEG in the owner's avatars folder, named by the digest of its URL, so an unchanged photo is not downloaded again (`saveContactPhoto` in `server/connectors/ingest.ts`, at most 6 at a time). A boot sweep (`server/connectors/photoSweep.ts`) copies the Google photo URLs already stored, and clears the ones Google no longer serves.
- **Link-preview images are copied into uploads.** The unfurl downloads the page's `og:image` once, re-encodes it as a JPEG at most 800 px wide in `uploads/u/<owner>/previews/`, and returns that path. It never returns a remote image URL, and the editor draws only a local one, so an old note with a remote image shows the placeholder instead of loading it. `GET /api/link-preview/unfurl` is now a `scoped` route with an isolation test.
- **Remote images go through one helper.** `server/utils/remoteImage.ts` downloads through `safeFetch` under one deadline, refuses a body over its cap and anything but JPEG, PNG, GIF, WebP and AVIF, re-encodes with sharp, writes atomically, and tells a permanent failure from one that may pass.
- **Connector email summaries obey both AI switches.** A Gmail or IMAP sync downloads no message body and sends nothing to a provider when AI is off for the owner's account or for the instance. The Privacy page already promised that.
- **Weather sends rounded coordinates.** The browser sends Open-Meteo the contact's latitude and longitude to 2 decimals, about 1.1 km, not the exact point.
- **The legacy `ai.generate` refuses when no provider is available.** With AI off it would otherwise have sent the request to Google with a placeholder key.
- **"Use AI for this account" covers every path.** With it off, four paths still reached a provider while AI was on for the instance. Mention detection on a saved note (`runMentionExtraction`) and the summary of an attached `.eml` file (`handleAttachment`) now read `aiAllowedForUser`. An `.eml` file is saved with no summary when AI is off or no provider is set up, where before the upload failed. The MCP `search_people` tool passes `aiAllowed`, as Ask Contrack does. A hosted embedding model embeds no contact of an account with AI off, for search or for duplicates (`mayEmbedContactsFor` in `server/ai/embedder.ts`), and `POST /api/search/refresh-index` answers `403 AI_OFF_FOR_ACCOUNT` for that account. The **Semantic search coverage** row and card offer that account no **Index missing**. `docs/ai.md` drops "What the account switch does not stop".
- **A scan never merges a pair marked as different people.** The exact-match step (`runDeterministicPass`) ignored the exclusions and the people named in one note, so a dismissed pair that shared an email address or a phone number could auto-merge. It now skips every known-distinct pair, as the funnel and the automatic checks do.
- **The CSV and vCard exports leave out merged-away contacts, and the CSV leaves out ghosts.** The kept contact already holds a merged contact's emails and phones, so the other row wrote the same person twice.
- **Research leaves no topic out.** Every prompt left out relatives, health, religion, politics, sexuality and home purchases, and reported an email or a phone only when the person or their employer published it. Those rules limited what research kept, not what it found: on 15 imported contacts, a prompt without them found facts for 6, and one with them for 7. The search prompt now asks for every email and phone number that a page about the person lists, and no prompt names a topic to leave out. `PRIVATE_TOPICS` is gone.
- **Research may report a home or office address.** Home addresses were on the list of private topics that every research prompt leaves out. Address is now a topic: a page that states a home or office street address gives an Address fact, and the extraction writes it to the contact's addresses, labelled home or work. The prompt also names each address the contact has, when it differs from the place research searches with.
- **"Off — never research online" stops SearXNG research.** With no provider for research and a SearXNG address set, research fell back to SearXNG even when an admin had turned research off. `isResearchOff()` (`server/ai/capabilities.ts`) now rules SearXNG out of the default strategy, and it stops `validateEnrichmentStrategy` (`503 RESEARCH_OFF`), a SearXNG batch that is already running, and the research capacity on the Enrichment page.
- **"Enrich new contacts automatically" researches only the contacts a person adds.** It also researched the contacts that a Google sync or an MCP client added, while the page said "every contact you add". `createContact` takes `autoEnrich`, and only `POST /api/contacts` sets it. The page now says "Researches each contact that you add yourself, at Standard depth. Not the contacts from an import, a sync or an MCP client".

### Removed

- **The old doc pages.** `docs/features/`, `docs/ai-hardening.md`, `docs/answer-evaluation.md`, `docs/search-foundations.md`, `docs/search-hardening.md` and `docs/ci-and-release.md`. What in them is still true lives in the new pages.
- **`.cursorrules` and `.agent/AUDIT_FINDINGS.md`.** The first pointed agents at `.agent/project-context.md`, which does not exist, and the second held no audit.
- **`POST /api/contacts/merge-batch` and `POST /api/dev/seed-duplicates`.** The first merged many pairs in one call, and the second made four duplicate contacts in development. Nothing in the app called either. `useMergeBatch`, `useSeedDuplicates` and the engine's `seedDuplicates` go with them, and so do their rows in the route manifest and the tenancy tests.
- **The dedupe scan modes `deterministic`, `ai` and `both`.** `POST /api/dedupe/scan` takes `quick`, `deep` or `full`, and any other mode answers `400`. The three old names ran as `quick`, `deep` and `deep`, and the picker never offered them.
- **The redirects from old paths.** `/settings/dedupe`, `/settings/ai-search`, `/settings/ai-stats`, `/settings/ai-config`, `/settings/admin/instance` and `/tracked` no longer redirect. An old bookmark opens the Settings list.
- **The move of 1.x settings out of `localStorage`.** A browser that ran 1.x starts from the defaults. The five keys it left (`contrack_list_density`, `contrack_recent_limit`, `contrack_dedupe_settings`, `contrack_temp_unit` and `contrack:search:history`) are still deleted on load, so a search history left in a shared browser cannot be read by the next person.
- **The old enrichment dossier.** The Research card no longer recognises the text that enrichment wrote before the research record, and the merge engine no longer clears it. A contact that still holds it shows it under Research notes.
- **The component showcase at `/dev`.** It was a development page that drew the design system, 798 lines, and it was never in a production build.
- **The unused Drizzle relations.** `src/db/schema.ts` drops its 28 `relations()` objects and an `OWNED_TABLES` copy. No code calls the relational query API, and `server/db.ts` has its own list. Every table stays: each is in the migration snapshot, and `npm run db:generate` reports no schema change.
- **Three color tokens and a font token that nothing used.** `--color-secondary-container`, `--color-on-secondary-container`, `--color-on-primary-container` and `--font-label` leave the stylesheet, both palettes, the accent derivation and the contrast test.
- **Props, options and result keys that no caller set or read.** Eighteen `className` props, plus options on `Modal`, `Select`, `Switch`, `VirtualRows`, `ContextMenu`, `SecretReveal`, `Donut`, `SettingRow`, `SettingsSearch`, `ConnectorCard`, the three connector modals, `TimelineTab`, `useLoadingShown`, `useProximityLift` and `useMapFilter`. Twenty optional parameters that no call passed now take their default inline.
- **`ContactPopup`, `EngineInfoCard`, `Field`'s add button, and a few helpers.** `MapHoverCard` replaced `ContactPopup`, and the file is now `StackPopup.tsx`. `useConnector`, `buttonLike`, `escapeHtml`, `isSettled` and the two invitation-token wrappers go too.
- **The `export` keyword on 313 declarations that only their own file uses.** The code stays. Exports that a test imports stay exported.

### Fixed

- **A change during an embedding run reaches no model it should not.** Every embedding call read the current embedder, so when an admin pinned a hosted model during a search backfill, the passages of a contact already checked went to the new model, also for an account with AI off, before the round stopped. And a run checked the account once: when its owner turned **Use AI for this account** off during a long duplicate backfill or an import, every later batch still went to the provider. Each search round, dedupe round and single or bulk embedding now reads the embedder once and uses it for every call, and the embedder checks the account again before each call (`embedderFor` in `server/ai/embedder.ts`). A vector is written only into a store that was built for the embedder that made it, or that has no record yet, so a capability change cannot mix two models in one index. Both vector stores now record the embedder's id and width, so an embedder with a new id rebuilds them by itself, and the duplicate store, like the search store, keeps its record when the model changes during its probe.
- **The built-in embedding model loads at boot with a hosted model pinned.** Boot embedded its probe text through the embeddings capability. With a hosted model pinned, it sent the probe to the provider, failed the 384-dimension check, and never loaded the built-in model. Turning AI off for the instance, or choosing the built-in model again, then rebuilt both vector indexes with nothing to fill them, and the search index stayed empty until a restart (0 of 300 contacts on a test instance). The probe now runs on the built-in model whatever is pinned, so both indexes fill at once. The duplicate backfill now says that no embedding model is ready, not that a Gemini key is missing.
- **Research no longer says "no web page" when the model ran no search.** On 15 contacts imported from LinkedIn, Gemini 3.8 Flash answered `NO MATCHING PAGES` with no web search for 8 at Standard and 9 at Deep. Each was recorded as no public information, and the Research card advised adding a city or an email. Other settings of the same asks found pages for 3 of those people. The reply now counts only from an ask that reports a search. Otherwise the job fails with `AI_NO_SEARCH`, "The research model did not report a web search for this contact", and nothing is recorded, so a contact never researched stays under **Not yet**. When the further asks fail at the provider after such a reply, the provider's error is reported.
- **Research searches the name a page would use.** Every search quoted the whole stored name, so "Greg Whitlock, CPA" found only pages that copy the credentials. Of 825 names imported from LinkedIn, 47 had credentials, 14 a note in brackets and 7 a surname cut to an initial. Searches now quote the name without credentials, symbols or brackets (`searchName`), add the name without a middle initial, and spell the surname from the LinkedIn handle when the name ends in an initial ("Priya K." at `linkedin.com/in/priyakapoor` searches "Priya Kapoor"). The prompt names those forms as the same person. A placeholder employer such as "Stealth Startup" or "Self-employed" is never searched. SearXNG research uses the same rules.
- **A fact keeps its site when the line ends in citation markers or several brackets.** A model wrote "[news.example.com [1.1.1], press.example.org] []", and the line kept the brackets in its text and lost its site. `parseFindings` now removes markers like "[1.1.1]" and reads the first site of the brackets that end a line. A year in brackets stays part of the fact. Read again this way, the 437 fact lines of 13 baseline runs keep stray brackets in 1 line instead of 27 (an arXiv category, which belongs to the fact), and 368 name a site instead of 344.
- **The Research card lists a repeated fact once.** A deep run's two asks, and the two asks that follow a first ask that cited nothing, report many of the same facts, and the card listed every copy: one contact's current role came back in seven lines. `mergeFindings` keeps one copy of facts that differ only in case, punctuation or small words ("CEO of Acme", "CEO at Acme"), the copy with a page or a site. It removes 39 of the 437 lines.
- **A long list of one kind is cut, not dropped.** The extraction joins every publication or award into one attribute, and a value over 500 characters failed the schema, so the whole entry was left out, in 2 of 15 deep runs. An attribute now keeps up to 2,000 characters, cut at the last "; " that fits.
- **SearXNG research keeps the good fields of an extraction with one bad value.** It parsed the answer whole, so one bad value, such as a `javascript:` website, lost every field. It now reads field by field, like the two-pass strategy, and applies the same job rules.
- **A page opens when the app is installed under a folder whose name starts with a dot**, such as `~/.local/contrack`. The SPA fallback passed `res.sendFile` an absolute path, and `send` refuses a dot folder in one, so every page a person opened answered 500. It now sends `index.html` relative to `dist/` (`server/serveClient.ts`).
- **A second dev server no longer dials the first one's reload socket.** In middleware mode Vite opens its reload socket on port 24678, and the page of a second dev server dialled the first one's socket even with `DISABLE_HMR=true`. The socket now sits on the app's own HTTP server, so each page dials the port it came from, and a second dev server keeps its own hot reload.
- **Every stream sends `X-Accel-Buffering: no`.** The duplicate scan and the import streams did not, so behind nginx with its default buffering their progress arrived in lumps. `startStream` (`server/utils/stream.ts`) now starts all five streams with the same headers.
- **An Ask answer follows a new, edited or deleted note at once.** The answer cache keyed on the search revision, which no note moves, so a question about notes could answer from before a note for up to 5 minutes. A notes revision that triggers on `interactions` keep (`notes_revision`) now joins the key of both cache tiers and of the in-flight join.
- **Keyword search no longer takes minutes after a large index run.** SQLite plans a query from the row counts of its last ANALYZE, which the server runs at boot and once a day. After a server indexed thousands of contacts, the counts for `search_passages` were the old ones, 2 rows for a table of 22,000. The planner put that table first, so the `k = 300` nearest-neighbour search over note passages ran once for every passage: 145 seconds for a question that takes 60 ms. A restart hid it, because boot runs ANALYZE. `findPassageNeighbors` and `findPassages` now join with `CROSS JOIN`, which fixes the order whatever the counts say. Every drain of the index queue and every backfill also runs `refreshPlannerStats()` (`server/db.ts`), which is `PRAGMA optimize=0x10002`: SQLite checks each table and runs ANALYZE only on one whose row count moved tenfold. It takes 0.02 ms when nothing moved and 3 ms for the stale passages table, where a full ANALYZE takes 20 ms.
- **A Quick scan for duplicates runs with AI off.** `requireAiAllowed` refused every `POST /api/dedupe/scan`, although a Quick scan compares emails, phones and names and calls no model. A scan with `mode: "quick"` now passes both switches. With either switch off, the Duplicates page offers only **Quick scan** and says that Smart scan and Full scan use AI.
- **The navigation keys and Quick interaction work on Windows and Linux.** The handlers read `metaKey` only, so there they answered to the Windows or Super key alone. The browser keeps `Ctrl+Shift+I`, `P` and `M`, so Windows and Linux use `Ctrl+Alt` and the letter (`src/lib/platform.ts`). Both forms work on every platform, and the shortcuts dialog, the tooltips and the hints show the keys of the platform the page runs on: `Ctrl` for `⌘`, and the browser's `Alt+←` and `Alt+→` for Back and Forward.
- **A facet value with a space works.** The map's insight bars write `industry:"Venture Capital"`, and the filter cut it at the space, so the map showed 0 matches. The palette, the Network list, the map and Ask read a quoted value as one value now.
- **The map's `updated:`, `missing:email` and `missing:phone` facets work.** The map rows carried no `updatedAt`, emails or phones, so `updated:` matched nobody and the two `missing:` facets matched everybody. The palette's instant list had the same hole for `missing:email` and `missing:phone`.
- **A person that AI finds in a note gets a mention row.** The extraction wrote the note's `mentions` JSON and never `interaction_mentions`, so the note did not show on that person's timeline and the Pulse Inbox did not count a ghost's notes. It writes both now, and a boot backfill adds the rows that older notes lack.
- **The score panel from the contact header's ring opens whole.** It hung from the ring's right edge inside the pane and lost about 150 px on its left. It opens in the browser's top layer now, placed from the ring.
- **The photo circle on first-run setup shows the monogram.** The initials route needs a session, so the setup, register and join screens showed a broken image. They draw the same monogram in the page (`shared/monogram.ts`).
- **The corvid's holds hold.** `choreograph` added no key for a `set: {}` moment, so the head turns in glance, cock and look back swept across the whole hold. The animated lockups are drawn again.
- **Palette B, "Catch me up", opens the Briefing.** The contact page read nothing from `?brief=1`. It now opens the Dossier with focus on the Briefing card, and writes a briefing when there is no recent one and AI is on.
- **The Network list's J and K are in the shortcuts dialog.** They open the next and the previous contact.
- **`npm run models:fetch` reads `.env`,** so a `DATA_DIR` or `MODEL_DIR` set there moves the folder for the script and the server together.
- **Dead code:** the palette's 30-second query restore, which nothing called, and `selectCluster` in `useMapSelection`.
- **The forgot-password screen names a command that the production image can run.** It said `npx tsx scripts/reset-password.ts <username>`, and the image has no tsx. It says `node scripts/reset-password.ts <username>`, the command the docs give.
- **Devices names a sign-in by emailed link.** The list tested for `"link"`, and the server writes `email-link` for both a reset link and a sign-in link, so those rows read "Password". `SessionMethod` and `describeSessionMethod` in `shared/devices.ts` are now the one list of methods and the one set of labels, and the server types `createSession` with the same list, so a method without a label fails to compile.
- **The delete toast says the retention that is set.** It always said "Restorable for 30 days". `DELETE /api/contacts/:id` and `POST /api/contacts/bulk-delete` now answer `retentionDays` with the delete, because a member cannot read the admin setting. The toast says "Restorable for 7 days", or "1 day".
- **The account form no longer says that Contrack never sends mail.** With outgoing mail set up it does send the reset and sign-in links that somebody asks for. On the setup, join and register screens the email hint says "Used to sign in, and to email you links you ask for" when the instance can email links, and "Used to sign in. This Contrack cannot send email" when it cannot.
- **Coming up names no window.** Its empty line said "Nothing in the next two weeks", but the dashboard sends meetings for the next 7 days, and only birthdays reach 14. It says "Nothing coming up".
- **The palette's stale data insight opens the filtered list.** It opened Settings. It opens `/?q=updated:>6m`, the address of the stale row on Pulse. `insightPath` in the palette's `utils.ts` holds the address of every insight.
- **The help under Quick tasks and Deep tasks lists the work that runs.** Quick tasks named search expansion, which nothing runs, and Magic Paste, the old name of Add from text. Quick tasks now name briefings, mail summaries and the extraction step of contact research, and Deep tasks say that only SearXNG research extracts on the deep model. The README drops its Doc2Query bullet for the same reason, and says Add from text where it said Magic Paste.
- **The avatar picker's format hint includes AVIF**, which the server accepts.
- **Text names the AI page that exists.** Three log lines, the error for an endpoint with no model, `.env.example` and the README said "Settings → AI". The page is Settings → Administration → AI providers. `tests/unit/repo/settingsPageName.test.ts` fails on the old name.

### Added

- **A local cross-encoder reorders the answers to a question.** `rerankLocal` (`server/services/search/rerank.ts`) scores the top 30 of Ask Contrack's local list with `Xenova/ms-marco-TinyBERT-L-2-v2` on the CPU worker and sorts them by score. The profile it reads is the name, role, company, location, industry, headline, the first 200 characters of the about text, the tags and the interests, cut to 128 tokens with the question. It runs for `conceptual` questions only, on the instant chunk and on every local final answer. A name, an email, a phone number, a quoted phrase and a short `mixed` query keep their fused order, because a cross-encoder is not typo-tolerant. `SEARCH_RERANK_BUDGET_MS` (default 25) bounds the stage: scores that arrive later are dropped, the list keeps its fused order, and a job still waiting on the worker is cancelled. `SEARCH_RERANK_MODEL=off` turns it off, and with no model it is skipped. The model loads once at start, after the embedding model. On the 70 golden queries the MRR of the local answer goes from 0.983 to 1.000 at 300 contacts and to 0.993 at 5,000, and the stage's p95 is 10.5 ms at 5,000 contacts. `Xenova/ms-marco-MiniLM-L-6-v2` gives the same answers and needs 30.8 ms for 10 candidates.
- **The semantic cache (L2).** `server/services/search/semanticCache.ts` answers a question asked in other words with no model call. It keeps the verified answers of the last 5 minutes, at most 100 per account, with the question's vector. A hit needs the same account, `search_revision`, facets, provider and model, the same entity key (the capitalized words, numbers, quoted phrases and emails of the question), and a cosine of 0.97 or more. The question is embedded once, before the planner starts, and the local list and the model stage read the same vector. A hit also goes into L1 for its exact words. An edit or a merge bumps the revision, so every older entry stops matching, and `aiCache.invalidateAll()` empties L2 through the new `onInvalidateAll`. A provider's embedding model leaves L2 off, because the threshold was measured on the built-in model.
- **A second worker job kind, `rerank`.** `RerankJob` (`model`, `query`, `docs`, `maxLength`) and `RerankResult` (`scores`) join the protocol in `server/workers/protocol.ts`. The worker loads each cross-encoder once, and a job with no documents loads nothing, like an embed job with no texts. A rerank job that loads a model spends the process's one onnxruntime load, as an embed job does.
- **Two benchmark modes.** `--rerank-sweep` measures both cross-encoders on 10, 20, 30 and 50 candidates, with the stage's p50 and p95 and the recall@10 and MRR of the local answer. `--vector-ab` embeds each contact once, writes int8 through the product's path and float into a twin table, and prints bytes per vector, the table size from `dbstat`, the KNN p50 and p95, and the int8 KNN's recall@10 against the float one.
- **The corvid hunts while AI works.** On Ask Contrack, a question that takes a moment puts up a stage under the search box after 150 ms: "Searching your network…" and "AI is checking who fits your question". After 200 ms more, the bird in the search box flies out at its flying size and wanders at random over the stage and the page below it. The answer calls it home by the short way, and it lands back in the search box as the results fade in. The flight is a new kind, `search`, in `planFlight` (`src/lib/corvidFlight.ts`): short steps whose turn drifts, never more than 40 degrees a step, and a hard turn for the middle when the edge of the ground is close. It is slower than a lap and lands by itself after about 26 seconds, twice the model's 12 second budget. `recallCorvid()` (`src/lib/corvid.ts`) ends a search flight and no other kind: at once, or as soon as the bird is in the air when it is still leaving the box. `useCorvidSearchFlight` and `SearchingStage` (`src/views/search/SearchingStage.tsx`) wire the page to it. At the "subtle" and "off" motion levels, and under reduced motion, nothing flies, and the stage holds a 64 px thinking bird.

- **Ask Contrack takes facets.** `POST /api/search/semantic` accepts `filters`, up to 8 of the palette's facets, and answers 400 "Invalid search filters" for a list it cannot read. The server also reads the facets typed in the question with `parseFacetQuery`. A facet sent both ways counts once. The facets hold at every stage, and they are part of the L1 cache key and of the key that lets identical requests share one search. The palette's AI (`?`) mode sends its pills as `filters`. On the Ask page, type the facets in the question.
- **A question that is only facets needs no model.** The database answers it: the matching contacts in name order, at most 30, every one verified. The reason comes from the facets, such as "Tagged rare." or "Based in Lisbon, Portugal." At 5,000 contacts the p95 is 2.7 ms.
- **Implicit facets.** `findImplicitFacets` (`server/services/search/implicitFacets.ts`) reads facets from the words of a question. "at X" and "works at X" give a company. "in X", "based in X", "near X" and "around X" give a place, and "in X" gives an industry. X must be equal to a company, a place or an industry in the owner's contacts, with case and accents folded. A place is a whole location or one of its comma-separated parts. When the other words ask for nothing more, no model runs: "people in Lisbon", "who works at Northwind Logistics" and "who works in fintech" get the facet answer. Otherwise the planner reads the whole question, and the implicit facets narrow every stage. The server reads the known values once per owner and search revision, for at most 50 owners.
- **Implicit facets leave doubtful phrases to the planner.** A place with a comma and another word after it ("Paris, Texas" when only Paris is known) is the planner's. So is a place with "and" or "or" after it ("New York and London"). So is a place with a word such as "State", "City" or "County" after it, or with another known place after it. A value that is both a place and an industry is the planner's too. A comma with a question word or a filler word after it ends a clause, so "In Lisbon, who climbs?" still gives the Lisbon facet.
- **A `contacted:` facet.** `contacted:>90d` keeps the contacts last contacted more than 90 days ago, or never. `contacted:<30d` keeps the contacts last contacted within 30 days. `contacted:never` keeps the contacts with no logged contact. The units are d, w, m (30 days) and y (365 days), and no operator means `>`. A date that cannot be read counts as never. The palette's autocomplete offers "Within 30 days", "Over 90 days ago, or never" and "Never". The palette, the Network list, `GET /api/search` and Ask Contrack all read it.

### Changed

- **Ask Contrack and the palette wait for AI's answer.** The local list that streams first is no longer on screen while AI checks it. The Ask page shows the stage and the hunting bird, and the palette shows "Asking AI…" for the whole wait. The "Unverified candidates" headings and the "Enriching with AI…" line are gone. The status region says that the search started and then what it found, no longer that unverified candidates arrived.
- **An orange question mark marks what AI did not check.** It replaces the Unverified badge. On the Ask page, each card of a list AI did not check carries the mark in its top right corner. It is an `InfoTip`, a button beside the card with a 44 px target, named "Ada Lovelace: not verified by AI", and a hover, a click, a tap or a keyboard focus shows why. The list says "Not verified by AI" once, over the cards, with a question mark that gives the reason: AI is off for the account, or AI could not check these people this time. In the palette the heading reads "Not verified by AI", one line under it says why, and each row carries the mark as a named picture with a title. The status region ends "Not verified by AI.", and the history pane says "not verified by AI" in the row. The warning line "AI unavailable — showing unverified matches" is gone. `InfoTip` takes `tone="warning"` for the orange mark.
- **Search vectors are int8.** `search_embeddings` is `INT8[384]`: 384 bytes per vector instead of 1,536. One scale for the whole table turns a component into a byte, `round(component × scale)` clamped to ±90, and `app_settings` keeps it as `search.vectorScale`. The range stops at ±90 because sqlite-vec 0.1.9 squares each byte difference in 16 bits on its NEON path: a difference of 182 or more overflows, and at ±127 a vector pointing the opposite way could rank as the nearest. The query goes through the same scale (`vec_int8(?)`), so the neighbours keep their order up to rounding. At start, `rebuildVecTable` reads a float table out, quantizes every vector with one scale over all of them, recreates the table as int8 and writes the rows back, in one transaction. Nothing is re-embedded, and the partition key and the status columns carry across. The first write to an empty table sets the scale from its vectors, a later vector with a larger component is clamped, and a change of embedding model drops the scale with the table. `vecTableDdl(table, dimension, element)` takes `float` or `int8`, and `contact_embeddings` stays float. At 50,000 contacts the table goes from 80.1 MB to 24.9 MB and the KNN p95 from 6.0 ms to 4.3 ms, and the int8 top 10 hold 0.97 of the float top 10. The search gate's `hybrid` channel reads 1.000 / 0.982 at 300 contacts, against 0.983 with float, and 1.000 / 0.983 at 5,000, as with float.
- **The search gate has five channels.** `reranked` is `hybrid` with the cross-encoder on, and it replays the scores in `tests/fixtures/search-eval/rerank-scores.json`, so the gate needs no model. A pair the recording lacks fails the gate with "Run `npm run eval:record`". The recorder records the model's float vectors for the text the backfill embeds, and both the gate and the recorder write the corpus in one batch, so the int8 scale comes from all of it. At 300 contacts `reranked` reads 1.000 / 1.000.
- **Reciprocal rank fusion is weighted.** `reciprocalRankFusion(lists, k)` (`server/services/search/hybridRetrieval.ts`) takes `{ channel, weight, items }` lists. The channels are `lexical`, `dense` and `trait`, and ranks start at 1. The weights come from `classifyQuery`. A name, an email, a phone number or a quoted phrase gets lexical 0.7 and dense 0.3. A conceptual question gets 0.3 and 0.7, and a mixed one gets 0.5 and 0.5. The trait lists of a plan share 0.3 and rank their contacts in the fused order of the local list. Before, they carried the `vector` label and rank 1 for every row. `queryIntent(scope, query, facets)` classifies a query from its strict keyword matches.
- **`RRF_K` stays 15.** A sweep of k = 15, 30 and 60 on the 70 golden queries gave recall@10 1.00 at every k. The fused MRR was 0.950, 0.942 and 0.942 at 300 contacts, and 0.917, 0.915 and 0.906 at 5,000.
- **Broad keyword search ranks four tiers.** Every token matched comes first, by BM25. Approximate names that score 0.85 or more follow, by score. Partial matches come next, by BM25. A one-letter token, such as the O of O'Callahan, counts only when the query has no longer token. Approximate names from 0.75 to 0.85 come last. Every partial match used to rank above every approximate name. At 5,000 contacts a misspelled name then fell behind the people who shared one word of it. Strict mode, for the sidebar and the check that decides the kind, keeps exact matches, then approximate names.
- **A nickname finds the formal name.** `nicknameVariants(token)` (`server/utils/nlp/nicknames.ts`) gives the other names of a token's nickname group. The query's first token matches them on the name column only: "bob" becomes `("bob"* OR name:("robert" OR "rob" OR ...))`. "Peggy Ellington" finds Margaret Ellington. Only the first token gets the variants, so "people I will meet" does not reach for William. The approximate-name step uses the variants of every token.
- **Approximate names start from ordered candidates.** One FTS query asks the name column for each token's 3-letter prefix (tokens of 4 letters or more), its 2-letter prefix and its nickname variants. BM25, then the id, orders the rows, and at most 200 stay. The Double Metaphone codes of the whole query and of each token must equal the stored `phoneticHash`. The (ownerId, phoneticHash) index finds these rows, in id order, at most 200. The 2-letter prefix stays because "Kristof" and "Krzysztof" share only "kr". The old step took 50 prefix rows in no order and matched phonetic codes with `LIKE`.
- **FTS version 5.** `tags` is a new column for tags and interests, with weight 3. `extras` holds emails, and each phone number followed by its digit forms: all its digits, its last 10 and its last 7, each once. Plain SQL builds the forms by removing the separators people type. A registered function would fail on every other connection that writes a contact, such as a backup check or `sqlite3` in a shell. A number with any other character left, such as an extension "x12", gets no digit forms. The first boot on version 5 rebuilds both FTS tables once.
- **Facets run in SQL, before every limit.** `compileFacets(scope, filters)` (`server/services/search/facetSql.ts`) turns facets into one predicate over the contacts row. It registers `facet_contains`, `facet_time` and `haversine_km` on the server connection, so the SQL makes the same checks as the palette's `matchesFacet`. `lexicalSearch`, the approximate-name step, the vec0 KNN, the plan's hard filter and the trait lists all apply it, so no filtered contact is lost to a `LIMIT`. `searchService.searchFts` drops its JavaScript scan of every contact. At 5,000 contacts the sidebar search with one facet has a p95 of 2.6 ms, where it took 11.8 to 12.7 ms.
- **One facet parser for the client and the server.** `shared/facetQuery.ts` exports `parseFacetQuery`, `parseFilterValue` and `FACET_FIELD_PATTERN`. The palette's tokenizer, the Network list and Ask Contrack read facets with it, and the palette behaves as before. `FACET_FIELDS` and the zod `facetFiltersSchema` (at most 8 facets, `near:` with its `point`) live in `shared/searchFacets.ts`.
- **Name scoring is faster, with the same scores.** `damerauLevenshtein` keeps three rows in place of a table. `singleTokenScore` skips the table when two tokens differ in length by more than 2 and do not sound alike. `nameScorer(query)` (`server/utils/nlp/names.ts`) tokenizes the query once and keeps each token pair's score, and `nameSimilarity(a, b)` is `nameScorer(a)(b)`. A comparison of 632,520 pairs with the old code found 0 differences.
- **The search gate has 70 queries and four channels.** Five kinds are new, with 4 queries each. They are a nickname and a surname ("Peggy Ellington"), a phone number as digits, an email address, a hyphenated name and the first letters of a rare name ("Xiom"). The hyphenated name, "Anne-Marie Dubois-Laurent", is a new target. Eight targets gained emails or phone numbers. `fused` is new: keyword and vector search fused by weighted RRF, with no plan, the number that the weights and k move. `hybrid` is now what Ask answers without a model. At 300 contacts, recall@10 / MRR is 0.657 / 0.657 for `sidebar`, 1.000 / 0.936 for `lexical`, 1.000 / 0.950 for `fused` and 1.000 / 0.983 for `hybrid`. On the 50 queries of v2.0 it was 0.52 / 0.52, 0.98 / 0.89, and 1.00 / 0.86 for the fused list.
- **The search benchmark sweeps k and times facets.** `--rrf-k N` sets the fusion constant, and `measure(scope, queries, idByKey, { rrfK })` and `SemanticSearchOptions.rrfK` take it too. New rows time the sidebar search with one facet, a question that is only facets and a question with implicit facets. The quality lines print the four channels for the actual number of queries, and the name-typo queries of `fused` and `hybrid`. The "question" group holds the sentence kinds only. At 5,000 contacts, `lexical` reads 1.000 / 0.936 (it was 0.96 / 0.80), `fused` 1.000 / 0.917 and `hybrid` 1.000 / 0.983. The old `hybrid` line, the fused list, read 0.96 / 0.77. Name-typo recall@10 is 1.00, where it was 0.80.

### Fixed

- **An `InfoTip` opens on a tap.** A tap fires a focus and then a click. The tip opened on every focus, so the click closed it again: in Chrome on a touch screen it never stayed open. Now only a keyboard focus (`:focus-visible`) opens it and only a mouse hovers, so a tap opens it once. A click on a tip a hover opened keeps it open. Escape closes it and moves no focus: it used to give the focus back to the button, which opened the tip again. The panel stays in the page while it is closed, and the button's `aria-describedby` points at it.
- **A query word could match the owner token.** Every contact and note row carries the owner's token, "o" and the owner's id in hex, in an indexed column, and a query word is a prefix clause. For an owner whose id starts with f, the word "of" matched that token in every row, so "cup of tea" found every contact the owner has and every BM25 score moved. One account in sixteen has such an id, and "odd" did the same for ids that start with dd. `scopedMatch` (`server/services/search/lexical.ts`) now keeps the words off that column with `- {ownerTok} :`, for the contact index and the note index. The search gate's new cross-encoder replay found it: about one run in ten asked for pairs it had not recorded.
- **The palette hid people the search had found.** In the palette's search mode, cmdk's fuzzy filter ran over the rows the search returned, and it reads only a row's id and name. So it hid every person found by a company, a nickname, a misspelling or a phone number: "Peggy Ellington" showed nobody, although the server returned Margaret Ellington first. The palette now shows the rows as the search ranks them. Only the action (`>`) rows use cmdk's filter.
- **A nickname match came before the name itself.** A rare nickname scores higher in BM25 than a common name, so "Margaret" listed Maggie and Peggy above the Margarets. The query as typed now matches first, and the nickname matches follow it. Partial matches use the query as typed only.
- **A phone number typed as digits found nobody.** "+1 (415) 555-1234" was indexed as the tokens 1, 415, 555 and 1234, so "4155551234" matched no token. A query of at least 7 digits, with nothing but digits, spaces and `+()-.`, is a phone number. `isPhoneQuery` (`server/utils/nlp/phone.ts`) makes this test for `classifyQuery` and for the keyword search. The query looks for its digits, its last 10 digits and its last 7 digits. "4155550142", "01614960321" (a UK trunk zero for +44 161 496 0321), "5550147" and "14155550123" find their contacts.
- **`list:`, `missing:` and `near:` failed in the server search.** `GET /api/search` refused them with 400. It now takes every palette facet, with `point` and `km` for `near:`.
- **`updated:` read a SQLite timestamp as local time.** `matchesFacet` read "2026-09-10 05:33:50" with `new Date()`, which assumes local time. `updated:` and `contacted:` now read dates with `parseServerTime`, as UTC, as the rest of the app does.

### Changed

- **Ask Contrack answers a name, an email or a phone number with no model call.** `classifyQuery` (`server/services/search/intent.ts`) reads each question before any model runs. It names one of six kinds: email, phone, quoted, name, conceptual or mixed. For the first four kinds, the strict keyword result is the final answer, and every match is verified. "Approximate" still marks a close name. At 5,000 contacts the p95 is 4.9 ms for a name, 5.0 ms for an email and 1.0 ms for a phone number.
- **The planner starts while the local list is built.** Its request is on the network while `localRetrieval` runs, so the local list adds no time to the answer. A question the filters answer ends 26 to 48 ms after the planner (live, 2026-09-27).
- **Every other question shows a local list first, and keeps it when the model fails.** `localRetrieval` (`server/services/search/hybridRetrieval.ts`) fuses FTS5 in broad mode and a vector KNN by reciprocal rank, with no planner. It takes about 10 ms. Its top 30 stream as the instant chunk, with a p95 of 15.6 to 17.6 ms at 5,000 contacts. With AI off or no provider, that list is the final answer. An error, a timeout or an edit in the account during the search now ends with a fresh local list. It ended with the keyword list alone (`searchFts`, recall@10 0.52). `hybridRetrieval` keeps its signature and runs `localRetrieval` inside the plan's hard filter, so the search gate measures the same arithmetic.
- **A plan that the database proves skips the reranker.** A plan with confidence "high" and no soft traits, whose hard filters hold every constraint, answers from the filter. The answer is the filtered contacts in retrieval order, then the other filtered contacts by name. A recency-only plan answers from the filter too, by last contact, never contacted first. Every match is verified. Any other plan goes to the reranker.
- **The reranker returns evidence only, and the server writes the reason.** The model returns `contact_id`, `verified_field` and `verified_value` for each match, with no reason sentence. Those sentences were most of the reranker's 3 to 6 s. `maxOutputTokens` falls from 3,000 to 1,200. The candidates go to the model with short ids, `c1` to `c30`, which the server maps back. With 30 UUIDs the answer overran 1,200 tokens and was cut off. `buildReason` (`server/services/search/reasons.ts`) writes the reason from the fields that a filter or the reranker proved, such as "Product Manager at Northwind Logistics, based in Lisbon, Portugal." The text comes from the contact's own fields, so it is exact. The server still checks every match's evidence. Verified matches keep the retrieval order.
- **The brief streams.** `POST /api/search/synthesize` sends each piece of the text as a `delta` line, then the whole sanitized brief as `complete`. `SynthesisBar` shows the growing text in one box, then replaces it with the final text. Its "Summary status" live region announces only the final text. Each piece loses its control characters. The pieces stop when the text so far matches an injection pattern or passes 2,000 characters. The brief still starts only on a button press.
- **Every adapter streams text.** `AIProvider.generateStream` is optional. The gateway's `streamFor` runs it in the queue with the same lane and timeout rules as `generateFor`. Gemini uses `generateContentStream`. OpenAI and OpenAI-compatible servers use Chat Completions with `stream: true`. Anthropic uses `messages.create` with `stream: true`. Only a plain text request streams. A JSON or grounded request runs `generate` and sends one piece. A failure before the first piece falls back to `generate`, and a failure after it is thrown. An adapter with no stream sends one piece through `streamFor`.
- **"Unverified" replaces "Keyword" and "Fallback".** Each match now carries `verified`. A chunk's `fallback` now means that the model did not verify its list. A match that nobody checked wears the **Unverified** badge on the Ask page's cards and in the palette. The cards said Keyword there, and the palette said Fallback. **Approximate** still wins. The headings read "Unverified candidates" and "Unverified results". A screen reader hears "4 unverified candidates for “q”. Enriching with AI…". An older server sends no `verified`, and then the chunk's `fallback` decides.
- **The search benchmark measures Ask Contrack.** `node scripts/benchmark-search.ts --contacts 5000` builds the search-gate corpus plus generated contacts, with real MiniLM vectors when the model is present. It prints p50 and p95 for each local stage and for the answer as a person gets it. It also prints recall@10 and MRR per channel for the 50 golden queries. `--live` runs the real pipeline with the configured provider on ten queries, three cold runs each. It then runs one query again while two 15 s background jobs hold both shared AI slots. The script never prints a key.

### Fixed

- **Ask Contrack failed with AI off.** The Ask page and the palette's `?` mode answered `403 AI_OFF_FOR_ACCOUNT`, although keyword and vector search run on the machine. `requireAiAllowed` now lets `POST /api/search/semantic` through. The route reads the switch with `aiAllowedFor(req)` and passes `aiAllowed` to the service. The service skips the planner, the reranker and a provider embedding of the query. The built-in local model still embeds it. The answer is the local list, marked unverified. The AI rate limiters still count the path. `POST /api/search/synthesize` still answers 403 for an account with AI off.
- **An Ask question waited behind research.** On 2026-09-26 a question waited 12 s behind two research calls and answered with nothing. `GenerationQueue` (`server/ai/workQueue.ts`) now has a "search" lane with 2 slots of its own. It has one first-in, first-out queue of at most 16 waiting calls, then `429 AI_BUSY`. The planner, the reranker and the brief pass `lane: "search"` (`GatewayOptions.lane`). The shared lane keeps its 2 slots, its priorities and its fair share. One server can now send up to 4 calls at once to a provider. `getAIQueueSnapshot().search` reports the lane.
- **A place phrase took in the rest of the question.** "who in Lisbon goes rock climbing" gave the place "Lisbon goes rock climbing", which matched nobody. Some phrases are places only because a planner matcher sits inside them. `extractQueryLocations` now ends such a phrase where the matcher ends, so the place is "Lisbon". "Cambridge, Massachusetts" still parses whole.
- **The reranker rejected every recency match.** Candidates carry no dates, so the model could not check when a contact was last contacted. The prompt now says that the database already checked recency. A recency-only plan now skips the reranker.
- **A misspelled name that reached the reranker could fail its check.** The server requires the quoted value to be a literal substring of the named field. A name quoted as the query spelled it failed that check. The prompt now tells the model to cite a name as the candidate's field spells it.
- **The search benchmark's default mode failed.** Tenancy made `ownerId` required, and the benchmark inserted its contacts without one. It now inserts them under the local owner.

### Changed

- **There is no free or paid tier.** `AI_TIER` is gone, and so are the free and paid limits, the paid-only filter and the "paid spillover" pass. Google sets a key's limits from its Cloud project's billing and no longer publishes free-tier numbers, so the table either throttled paid keys (Gemini 2.5 Pro at 2 requests a day) or ran free keys into 429s. Now a 429 pauses that Gemini model for the `retryDelay` Google names (30 seconds when it names none, between 5 seconds and 15 minutes), and the retry goes to the next model. OpenAI and Anthropic never had a tier. A set `AI_TIER` logs a warning at boot.
- **Automatic picks current models.** Quick work runs on `gemini-3.5-flash-lite`, `gpt-6-luna` or `claude-haiku-4-5`. Deep work and research run on `gemini-3.8-flash`, `gpt-6-sol` or `claude-sonnet-5`. The fallbacks when discovery has not run were GPT-5.4 and Claude 4.6. OpenAI renamed its tiers in GPT-6 (Astra is the flagship, Sol the middle), and the old name rule made Auto pick `gpt-5.6-terra` for deep work.
- **Research runs on the middle tier.** The flagship cost two to five times as much for the same profile, and was slower: Opus 5.5 took 44 s and about $0.30 a contact, Sonnet 5 takes 18 s. A person who wants the flagship pins it.
- **The model list offers only models that answer.** OpenAI's list carried 45 chat models, and 16 failed on the first call: nine deprecated (the codex and `*-chat-latest` aliases) and seven that Chat Completions refuses (`-pro`, `gpt-live-1`). Those are left out, and so are chat models more than a year old, now that OpenAI and Anthropic report release dates. On Gemini, the 2.5 models (404 "no longer available to new users") and the Omni models ("only supports Interactions API") are left out too, and 2.5 is gone from the router's fallbacks, where it failed every time it was reached. A missing model now says so, in the provider's words, where it said "call failed after retries". A saved pin the list no longer offers stays in its dropdown, marked "no longer listed".
- **A pinned model is tested before it is saved.** Saving a quick, deep or research pin sends the model one tiny request, the way its task will call it. A research pin is sent with the search tool on. A model that fails is not saved, and the toast says why. Custom endpoints are not tested.
- **Quick work does not reason.** OpenAI models get effort `none` for quick work and `low` for deep work and research, and a model that refuses a value is stepped to the nearest one it takes, once. Claude models that declare effort get `low`, and Haiku, which refuses it, gets none. Gemini 3.x runs deep work and research at thinking level `low`. Query planning on OpenAI went from 3.5 s to 1.5 s against a 4 s budget.
- **Research carries its sources on every provider.** OpenAI returns the pages its search read (`web_search_call.action.sources`), and Anthropic its search results. The dossier lists them under Sources, and research that read nothing changes no field, the rule the Gemini path already had.
- **Research asks for a search.** The prompt opens with today's date and says what the model remembers may be out of date. Gemini 3.8 Flash searched in one run in three before, and five in six after. A Gemini search pass with no sources is asked again, told to search.
- **The Health page names what runs each task.** Its AI card shows quick, deep and research by provider and model, and the Gemini web searches today, where it showed a tier and a searches-of-limit line. The Enrichment page shows research runs in the last 24 hours, for every provider.
- **A free-tier Gemini key is named.** When Google answers with a free-tier quota error, Settings → AI, the Health page and the usage page say so: on the free tier Google may use prompts and responses, contacts' details included, to improve its products.
- **The usage page prices every provider.** One price table (`server/ai/pricing.ts`) replaces a map whose Anthropic rows were keyed `claude-haiku-4.5`, an id no request names, so every Anthropic and GPT-6 call was priced at nothing. A call is priced at three parts input to one part output, and the page still calls it an estimate.
- **The default avatar reads the pronouns, then a title, then the first name.** "she/her" draws from the female pool, "he/him" from the male pool, and any other pronoun from the neutral pool. With no pronouns, a title decides (Mr, Mrs, Ms, Dame, Sir, Mx), and after that the first name. The look travels in the avatar URL as `look=f`, `m` or `n`, because the route only sees the seed. A name does not travel: the route reads it at render time, so every existing default avatar gets the new rule with no row rewritten.
- **The name table is built from the World Gender Name Dictionary 2.0.** `scripts/build-given-names.ts` turns WIPO's counts of people by name, country and gender (CC0 1.0) into `server/utils/nlp/givenNames.tsv.gz`, 161,856 names in 444 KB. A name gets a line only when at least 90% of the people counted with it share a gender, and every country that holds 5% of them or more leans the same way by at least 75%. The lookup is a binary search over one string, loaded on the first avatar.
- **A neutral face reads as neutral.** No facial hair, the short and textured hair (`bun`, `fro`, `dreads01`, `dreads02`, `frizzle`, `shaggy`, `shaggyMullet`, `shortCurly` and two beanies), no scoop neck and no pastel pink hair. It was the unconstrained pool, with a beard one time in ten.
- **Contacts saved with pronouns get the pronoun look on boot.** A one-time pass in `server/db.ts` (§2a-1) adds `look` to a default avatar that has none. A face from the picker and a photo are left alone.
- **AI keys saved in Settings are encrypted.** Keys entered in Settings → AI and custom endpoint keys sat in `app_settings` as plain text, and so in every backup and every copy of the database. SMTP passwords, connector feeds and the Google client secret were already sealed with the instance secret (`CONTRACK_SECRET_KEY`, or `DATA_DIR/secret.key`), and AI keys now are too. The first start seals the keys already stored. A key that cannot be opened, because the instance secret changed, reads as no key: the provider shows as not connected, and the log says to enter it again. **This is one way.** An older build reads a sealed key as the key itself.
- **`.env.example` is short.** It holds the three AI keys, the model pins, the network, sign-in and data settings, and it says that the rest lives in the app. `docs/configuration.md` lists every variable. The `AUTH_TOKEN` text said the name still worked with a warning. The server refuses to start with it, and the file no longer offers it. `API_TOKEN` is deprecated, and the file no longer offers it either.
- **Docker gets every documented variable.** `docker-compose.yml` passed 18 variables, so `PUBLIC_URL`, `CONTRACK_SECRET_KEY`, `SMTP_URL`, `MAIL_FROM`, `MAIL_REPLY_TO`, `SEARXNG_URL` and the Google OAuth pair did nothing when set in `.env`. It passes all of them now. The eight it leaves out, and why, are in docs/configuration.md.
- **The container check reads only marker files.** `/.dockerenv` or `/run/.containerenv` means a container. The `DOCKER`, `IS_DOCKER` and `DOCKER_CONTAINER` variables were read and never set or documented.
- **Dependencies are current.** Every package is on its newest in-range version, and six majors moved: motion 13, lucide-react 1, react-dropzone 20, vitest 5, @anthropic-ai/sdk 0.128 and @types/node 22. Four wait for their own PR. better-sqlite3 13 ships its binary inside its package, but npm does not record the package's `gypfile: false` in the lockfile, so every install from the lockfile compiles it from source. That needs Python and a C++ toolchain, which the Docker image does not have, and a developer may not have either. TypeScript 7 is not supported by typescript-eslint yet. drizzle-orm 1.0 is a release candidate. DiceBear 10 removes the per-style packages Contrack loads, and its option values may differ, so the default avatars need a visual review.
- **The Google connector loads four APIs, not all of them.** `googleapis` held every Google API: 210 MB on disk, and 250 ms and 78 MB of heap at every boot, used or not. The four per-API packages (`@googleapis/gmail`, `calendar`, `people`, `oauth2`) load in 30 ms and 9 MB, from the same generator on the same auth library.
- **Local times use current zone boundaries.** `tz-lookup` stopped in 2022. Its fork, `@photostructure/tz-lookup`, is maintained. The old table put Ciudad Juárez in `America/Ojinaga`, an hour off, and returned retired names such as `Europe/Kiev`.
- **An .eml upload is read the way a mail client reads it.** `mailparser`, which the IMAP connector already used, replaces `eml-format`. The file is decoded from its bytes with each part's charset, so Latin-1 mail keeps its accents, an HTML-only message arrives as text, and the summary gets the subject, sender, recipients and date.
- **npm resolves peer dependencies again.** `.npmrc` set `legacy-peer-deps`, which skipped every peer check to get past one: `eslint-plugin-jsx-a11y` still names eslint 9 as its peer. An override now accepts eslint 10 for that one package, and the Dockerfile and CI install without the flag.
- **The Docker image runs one process and pins tsx.** tsx is a production dependency, so the lockfile fixes its version. The image ran `npm install -g tsx@4`, which took the newest 4.x on the day of the build. The server starts with `node --import tsx`, so `docker stop` signals the server itself, which drains its connections and closes the database. The image also skips onnxruntime-node's CUDA download (about 300 MB on linux/x64), which CI already skipped, and the Tailwind build plugins moved to devDependencies, so Vite is no longer in the image.
- **The mention list is placed by Floating UI.** tippy.js, last released in 2021, and its Popper engine are gone. TipTap's own suggestion plugin already used `@floating-ui/dom`. The list opens at the same place, 10 px under the typed name.
- **Lucide 1.0 dropped its brand icons.** The six social icons Contrack shows (LinkedIn, Facebook, GitHub, X/Twitter, Instagram, YouTube) are kept in `src/components/socialIcons.ts` with the same drawings, and render the same markup. Lucide redrew some of its own icons slightly, for example the corner of the file icon.
- **Node 26.10 or later, and nothing on Node 22.** `engines` and a new `devEngines` require Node 26.10 and npm 11.19, and npm refuses `install`, `ci` and `run` on an older Node with `EBADDEVENGINES`. `.nvmrc` and `.tool-versions` pin 26.10.0 for CI and for nvm, fnm, mise and asdf. The Docker image runs `node:26-trixie-slim` on Debian 13, because Debian 12 moved to reduced LTS support in June 2026. `@types/node` is 26. Node 22's support ends on 2027-04-30, and Node 26's runs to 2029-04-30.
- **Node runs the TypeScript itself.** The server, the scripts and the Docker image run `node server.ts` with Node 26's type stripping, so tsx and its esbuild leave the runtime. `/healthz` answers in 0.95 s, where tsx took 1.38 s. tsconfig adds `verbatimModuleSyntax` and `erasableSyntaxOnly`, so `npm run lint` fails on code Node could not run: 28 type imports gained `type`, two constructors lost their parameter properties, and 12 relative imports gained their file extension. Class fields follow the standard rules everywhere (`useDefineForClassFields: true`), so a test checks what production runs. `tests/unit/nativeTypeScript.test.ts` follows every import from `server.ts` and each script.
- **Install scripts have a policy.** `allowScripts` in package.json allows better-sqlite3, esbuild and fsevents, and denies onnxruntime-node (its CUDA download), protobufjs and @google/genai. npm 11.19 treats the list as advisory and only stops warning about these packages. A later npm release enforces it.
- **Oxlint lints the code, and TypeScript is 7.** Oxlint runs the same rules from `.oxlintrc.json`: ESLint's and typescript-eslint's recommended sets, the React hooks rules, and jsx-a11y with its ratchet. It lints the 1,000 files in 0.09 s, where ESLint took 3.8 s. Oxlint parses TypeScript itself, so TypeScript moves to 7.0.2, the native compiler, and `tsc --noEmit` takes 0.95 s, where 6.0 took 5.9 s. `npm run lint` takes 1.4 s, where it took 10.1 s. typescript-eslint could not make this move, because TypeScript 7.0 has no JavaScript API. The `eslint-disable` comments stay, because Oxlint reads them.
- **A disable comment that suppresses nothing fails the lint.** ESLint only warned about one. Two in `ResizeHandle.tsx` suppressed nothing under Oxlint, which counts a focusable separator as a widget, as WAI-ARIA does. They are gone.
- **The browser suite checks each dialog's name.** The axe scans add `aria-dialog-name`, which reads the name the browser computes for every dialog a journey opens. It replaces a jsx-a11y option, `includeRoles`, that Oxlint does not have. That option checked hand-written dialogs for a label.
- **Enrichment searches before it answers.** The model decides for itself whether to search, and Gemini has no setting that forces it. At the adapter's thinking level `low`, Gemini 3.8 Flash answered research prompts from memory, and the job failed with "Research did not include source links". The search pass now runs at thinking `medium` with a 16,384-token budget and a 120 s limit. On one contact's prompt, `low` searched 0 times of 3. `High` searched, but it answered with nothing for the same two contacts of five on every try, where `medium` found them. A pass that cites nothing, or returns nothing, is asked twice more at the same time, once with the searches first and once in a short form. One after the other, three asks ran past the 240 s limit on a second round.
- **The search pass reports facts, one per line, with the site each came from.** "Past role: Associate, Harbor Point Partners, 2018 to 2020 [finra.org]". The old prompt listed every output field and fourteen rules, and a model with little to find filled the list with nulls. The new one starts from the contact's details, counts a page only when it matches one of them, reports a stale page's "current" job as past, and leaves out relatives, health and home addresses. A person no page is about ends as "No public information", recorded, not failed.
- **Every enrichment is recorded, and the dossier ends with it.** `contacts.aiResearch` holds each run: when, which models, what it added field by field, the searches, the facts and the pages. The Research card at the bottom of the Dossier tab shows the history, the latest facts each linked to its page, and the pages by site and address, with **Enrich again**. It replaces "Research notes and sources", a closed card in the middle of the tab with its own 320 px scroll, a copy of the about and career cards, and sources as "Source 1" links.
- **Two research depths, Standard and Deep.** Standard is one search pass with four to six searches: about 40 s and $0.15 a contact. Deep runs the same search and, beside it, a longer one at thinking `high` for a complete profile, and keeps what both cite: about 1 min and $0.32 a contact (means over the contacts each found pages for, at Gemini's prices, 2026-09-26). `POST /api/ai-search` and `POST /api/contacts/:id/enrich` take `depth`, Standard by default, and the job and the research record keep it. The Enrichment page describes both, with their time and cost, and its confirmation gives the batch's total. A contact's actions menu has **Enrich contact** and **Enrich deeply**, each with its time. The dossier's **Enrich contact** and **Enrich again** open a menu of the two. The progress panel marks a Deep job, and the Research card's history names each run's depth. Deep does not rely on `high` alone, because `high` answered with nothing for two of the five contacts on every try.
- **Research starts from where the records came from.** The search prompt names the import: the user's LinkedIn connections, the import date and the date they connected. It says a page that links to the person's own profile is about them, the short retry form names the profile, and the searches include the formal first name behind a short one ("Thomas" for "Tom").
- **The empty dossier starts research itself.** It linked to the Enrichment settings page. It now says in one line what enrichment finds, and its **Enrich contact** opens the two depths. Without AI assistance it says how to add details by hand.
- **The Enrichment page filters by who, and by how their research stands.** One row of four data filters becomes two rows of pills: **Contacts** (All, Tracked, Has links, Has email, No data) and **Research** (Any, Not yet, 6+ months ago, Found nothing). A contact shows when it matches both rows, so tracked contacts whose research is six months old are two presses away. Each pill counts what it would show beside the other row's choice. A new choice clears the selection, so a contact the list hides is never started. The banner's **Select them** empties the search box and sets the rows to All and Not yet, so the list shows exactly the contacts it selects. Under **Start enrichment**, the batch's depth, time and cost show before the press. A row whose last research found no page has a **No page** badge, and the slim contact list carries the last run's outcome as `researchOutcome` for it.
- **When research finds no page, the Research card says what would help.** It names the kinds of detail research searched with, such as "Mara’s name, company, role and LinkedIn profile", and offers the details the contact lacks that research reads: **Add a city**, **Add a work email** and **Add a link**. Beside a LinkedIn profile the last one reads **Add another link**, since LinkedIn pages do not come back in the research search. Each button opens its field on the contact page with the input focused: the city and the work email in Details, labelled work, and the link in the header. On a phone the page moves to the Details tab first. The card then says to choose Enrich again, and after a Standard run, that Deep runs a longer search. The rules for which details count are the prompt's own (`shared/researchIdentity.ts`).
- **A contact opens from its Enrichment row, and the list is there on the way back.** Each row ends with a link that opens the contact. The contact page's Back says **Contact enrichment** and returns to the list, and both filter rows stay in the page's address, so the browser's Back returns to the same list too. From **Found nothing**, a contact that needs a detail is one press away.
- **Every research run records what it spent**: its calls, web searches, and input and output tokens. Every adapter now reports input and output tokens apart, since a price is per one or the other.
- **A second enrichment looks where the first did not.** It is told what the contact has, which sites the earlier rounds read, and what is still missing. It used to be told to return only new information and got the same prompt, and the dossier text was written only once.
- **A second enrichment adds only what is new, however a page words it.** The merge reads one school under two names as one school, a degree by its level ("AB" and "BA"), a job by its employer and start month, and an interest or tag by its words ("Distance running coach" is "Distance running"). A second round had added "The University of Example", "AB", 2017 beside the saved "BA" of 2013 to 2017, and an "Associate" beside the saved "Associate, Restructuring Group" of the same month.
- **Research leaves out more private topics.** Religion, politics, sexuality and home purchases join relatives, health and home addresses, in the search, short and extraction prompts alike (`PRIVATE_TOPICS`). A second round had recorded a signed political letter and a home purchase among its facts.
- **Every provider enriches in two passes.** OpenAI and Anthropic ran single-pass, search and schema in one request, which keeps no source beside each fact. Pass 2 is checked field by field: Claude Haiku 4.5 wrote `tags` as plain strings in two runs of three, and one such value used to fail the whole enrichment. Broker registrations ("Registered Representative", "Previously Registered Broker") become a Registrations fact instead of jobs, volunteer roles a Volunteering fact, a degree does not repeat its field ("BA Economics" in "Economics" is a "BA"), only a job at the contact's recorded company stays current, a profile link must be a profile and not a post, and dates are stored as `YYYY` or `YYYY-MM`.

### Fixed

- **`npm test` wrote test data into the developer's own database.** Three unit tests, `authLinks`, `tagRename` and `connectors.ingest`, unmock `server/db.ts`, and the unit project set no `DATA_DIR`, so the real module opened `./curator.db`. Run from a checkout with real data, every run added test accounts, contacts, tags, auth links and search revisions to it. Each unit test file now gets a temp `DATA_DIR`, and `server/db.ts` refuses to open the `./curator.db` fallback under Vitest.
- **Web research always failed on OpenAI.** The Responses API got the Chat Completions format, nested under `json_schema`, and answered 400 "Missing required parameter: 'text.format.name'". It gets its own flat, non-strict format now.
- **@mentions and the Catch-Me-Up briefing failed on OpenAI.** Both ask for an array, and OpenAI refuses an array at the schema's root. The adapter wraps it in an object and hands back the array. @mention extraction failed quietly, finding nobody.
- **Magic Paste failed on Anthropic.** The contact schema has 33 optional fields, over Claude's 24, so the adapter fell back to prompt-guided JSON, and Haiku put it in a code fence the parser refused. Every adapter now hands back JSON that parses as it stands, and a schema over Claude's limits (24 optional or 16 union-typed parameters) goes straight to prompt-guided JSON without a failed request first.
- **Gemini research stopped before it searched.** Gemini counts thinking against `maxOutputTokens`, and at the default level it thought for about 1,800 of the search pass's 2,500 tokens and ended at `MAX_TOKENS`. Gemini 3.1 Pro, which research ran on, did the same. The pass has 8,192 tokens and thinks at `low`.
- **Anthropic research ran into its timeout.** The dynamic-filtering search tool took 75 s where the basic one took 14 s for the same answer, and nothing capped the searches. Research uses `web_search_20250305` with at most five searches, and a turn the server pauses (`pause_turn`) is resumed. It used to keep the partial text.
- **A pinned Gemini model with no free tier never answered.** On the default `AI_TIER=FREE`, a pin to `gemini-3.1-flash-lite` checked a free limit of zero and failed every call with "reached its local quota limit".
- **Two endpoints read the wrong provider.** `/api/ai/grounding-capacity` and the Health card answered from the provider `AI_PROVIDER` named, so they were wrong whenever research ran elsewhere.
- **`npm run test:contract` opened the developer's `curator.db`.** The adapters read the model cache through the database, and the contract project had no data directory of its own.
- **A name used for both genders got a coin toss.** The old package answered male or female for every name it knew: Jordan was a man, Taylor a woman, Kim a woman, Harpreet a woman and Gurpreet a man. Of 35 unisex names tested, it gendered all 35. These names get the neutral face now.
- **A title, a suffix or a comma hid the name.** "Dr. Sarah Chen" and "Mr. John Smith" read as unknown, "Dame Judi Dench" read as male, and "Helen Smith, PhD" read the first name as "PhD". Titles are read, suffixes dropped, "Smith, Jane" is turned around, initials such as "J." are skipped, and accents fold, so "María" and "Søren" are found.
- **Wrong answers in the old table.** It had "Yael" as male in English, "the" and "dame" as French men's names, and "Noël" as female. Over 184 test names, the old lookup gave the wrong gender for 3 of 123 gendered names and a gender to 53 of 61 unisex names. The new one gives the wrong gender for none of the 123, and a gender to 15 of the 61, each a name that at least 90% of its carriers share, such as Alex and Cameron.
- **A family name first took a gender from another country.** "Li Na" read as female because Li is a Swedish girl's name. A name of two or more words that starts with a common Chinese, Korean or Vietnamese family name is neutral now. A three-syllable Hangul name drops its family name before the lookup, so 김민준 finds 민준.
- **A rename kept the old name's face.** The default avatar stayed seeded on the old name. A rename or a pronoun change now redraws it, and never replaces a face someone picked.
- **`shavedSides` gave one man in ten a woman's haircut.** It is long hair swept to one side, and it is out of the male pool.
- **A rename by PATCH left the old phonetic hash.** Dedupe's phonetic blocking reads `phoneticHash`, and only the PUT path recomputed it.
- **The Docker image failed at boot.** The runtime stage copied `server/` but not `shared/`, and the server imports `shared/` (dates, search facets, cadence, the MCP tool list, connectors). Every image built since those imports stopped with `ERR_MODULE_NOT_FOUND`. The image copies `shared/`, `src/lib/devices.ts` moves there, and `tests/unit/dockerRuntime.test.ts` follows the server's imports through the Dockerfile's COPY lines, so the next such import fails in CI.
- **The Docker build context held the backups.** `.dockerignore` matched `*.db` at the root only, so `backups/*.db` and `*.db.json` (gigabytes of contact data) went into the context, and the builder's `COPY . .` put them in a layer. The patterns reach every folder now, and `secret.key`, `.claude`, `test-results` and `playwright-report` stay out.
- **Variables the code reads were undocumented.** `MAIL_REPLY_TO`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` and `TRANSFORMERS_CACHE` join docs/configuration.md, with the three development switches. `tests/unit/envDocs.test.ts` fails when the code, the docs, `.env.example` and the compose file disagree.
- **The encryption docs named the wrong database.** They said to back up `secret.key` with `contrack.db`. The file is `curator.db`, and `secret.key` joins the table of what `DATA_DIR` holds.
- **multer left files behind on aborted uploads (CVE-2026-88932).** An upload cut off early could leave a complete file on disk with nothing to remove it, and the attachment and avatar routes use that storage. multer 2.4.0 fixes it. The update also fixes advisories in adm-zip (a file overwrite through symlinks, and a memory DoS), nanoid and vitest's mocker. `npm audit --omit=dev` finds nothing. The full audit reports only the dev-only esbuild inside drizzle-kit, which needs drizzle-kit 1.0.
- **A dropzone input took space in the layout.** react-dropzone 19 renders its hidden file input as a zero-size block, and a flex gap still counts it, so the next item moved by the gap: 16 px for the account photo's button, 12 px for the avatar picker's content and 24 px for the timeline. The inputs are positioned out of the flow again (`DROPZONE_INPUT`), and the account photo screenshots match the ones from before the update pixel for pixel.
- **A pasted screenshot would have become an attachment.** react-dropzone 19.2 turned paste-to-upload on by default, and the profile's drop target wraps the note composer. The three dropzones set `noPaste`, as before.
- **Password recovery could not run in Docker.** docs/configuration.md gave `docker exec -it contrack npx tsx scripts/reset-password.ts`, and the image had neither `scripts/` nor the tsx CLI. The image ships `scripts/reset-password.ts`, and the command is `node scripts/reset-password.ts <username>`.
- **A timed-out CPU worker test left processes running.** It started `npx tsx`, three processes deep, and its SIGKILL reached only npx. One orphan was still running fifteen days later. The test starts Node directly now.
- **Oxlint found six places that ESLint missed.** Four test helpers and one assertion read a value with `?.` and then read a field of it, so the `?.` protected nothing. ESLint does not look through the `as` cast around them. The helpers now say that the call exists (`!`), the way other tests do, and the assertion uses `toMatchObject`. The composer's editor area has a click handler and no role. ESLint skipped it, because the handler is conditional. Its disable comment now names that rule too, with the reason.
- **One enrichment made the next wait five minutes.** The queue refused a second batch for five minutes after one finished, so enriching two contacts in a row answered 429 "Please wait 187s before starting another batch" before any request reached the provider. There is no cooldown now. A start while the account's own batch runs joins that batch, and so does automatic enrichment of a new contact. Only another account's run refuses. The provider's own 429 still pauses a model.
- **An empty answer from Gemini read as "No public information found".** Gemini 3.8 Flash sometimes spends a whole call thinking and returns no text: one ask in three on a second round's prompt. The job then ended as if no page named the person. An empty answer with no sources is now a failed ask, and the next two asks run. If every ask is empty, the job fails with `502 AI_NO_ANSWER`, and a later try can succeed.
- **A provider out of credit read as "AI provider call failed after retries".** Gemini answers 402 when a prepaid project has used its credit, and the error named no cause and claimed retries that never ran. It now says "The AI provider refused the request for billing", with Google's own sentence, as `402 AI_BILLING`.
- **Starting enrichment covered its own progress panel.** A success toast, "Enrichment started for 1 contact", opened over the panel in the same corner and hid **Stop research**. The panel says it, and the toast is gone.
- **The empty dossier offered a step that did nothing.** It said "paste a bio into a note", but a note fills no field, and research does not read notes. It now says "Or add a city, an email or a link by hand". Without AI assistance it says "The dossier fills in from enrichment and imports. You can add a city, an email or a link by hand".
- **A city typed on the contact page never reached research.** The prompt read the `location` field, which imports fill, and not the Location list in Details. It now reads the addresses too, and takes the first with no digit in it, such as "Austin, TX", the primary address first. A city added after a street address counts, and a street address or a postcode is never sent.
- **Research added a second LinkedIn profile.** A contact imported from LinkedIn got another profile under the same name, and it was someone else. A person has one LinkedIn profile, so when the contact has one, a researched profile under another handle is left out. The same handle at another address, such as `uk.linkedin.com`, is the profile the contact has.
- **A detail the person removed came back at the next Enrich again.** A school deleted as someone else's was found again and added again. The research record now keeps every list entry research added (`addedEntries`), and a new entry that matches one the contact no longer has is left out. A field such as the location, once cleared, can still be filled again.
- **The enrichment controls showed Gemini's time and cost on every provider.** The figures were measured on Gemini. When research runs on OpenAI or Anthropic, the depth tiles, the confirmation and the enrich menus now say what each depth does and give no figures.
- **The cost note did not say which year's prices it used.** It now says "Costs are Google's 2026 Gemini prices", since Gemini 3.8 Flash's token prices double in January 2027.
- **On a phone, a researched row's date cut the role line short.** "Jan 20, 2026" took a third of the row. On a phone the date is "Jan 20" within this year and "Dec 2025" before it, and the full date shows from `sm`.
- **The e2e suite rewrote committed screenshots on every run.** `phone-pages.spec.ts` and `account-photo.spec.ts` saved into `docs/screenshots/`, and fonts and timing move a few pixels on each run. They now save under `test-results/`, and into `docs/screenshots/` only with `DOCS_SCREENSHOTS=1`.
- **Four tests hid a missing call behind a cast.** `mock.calls.at(-1)?.[1] as {...}` read a call that might not exist, so a test whose mock was never called failed with a `TypeError`. They now say which call is missing.
- **Gemini's sources were Google redirects.** A source was a vertexaisearch.cloud.google.com link named only by its domain. Each is resolved once to the page it names, with a HEAD request to Google that never loads the page, and Gemini's grounding supports link each fact to its page.
- **A stale page could set a contact's current job.** An aggregator still named a contact's previous employer as current, and the run wrote that employer into the contact's headline.

### Removed

- **`AI_TIER`, and the free and paid limits behind it.** `hasFreeTier`, `freeLimits`, `paidLimits`, `allowPaidSpillover`, `allowPreview`, the grounding pool's daily limit and `getAITier` are gone. The quota tracker still counts, for the Health page.
- **`gender-detection-from-name`.** Six binary tables and 2.1 MB of JavaScript, loaded whole on the first avatar. The new table replaces it.
- **`MAPBOX_API_KEY` warns.** It was removed earlier in 2.0. Boot now names it, like `AI_TIER`, when it is still set.
- **`TRANSFORMERS_CACHE` in the image.** The model cache follows `DATA_DIR` on its own, to the same `/app/data/.cache`.
- **`APP_URL` in the agent docs.** Nothing read it. It came from the AI Studio template, and so did the comment on `DISABLE_HMR`, which now says what the switch is for. The eval scripts' `LOG_LEVEL` is gone too, because the logger has no levels.
- **`googleapis`, `eml-format`, `tz-lookup`, `@types/tz-lookup`, `dotenv`, `tippy.js`, `@popperjs/core` and `@types/dompurify`.** Node reads `.env` itself (`process.loadEnvFile`, same rules), and dompurify ships its own types. The install holds 959 packages, down from 986.
- **`.npmrc`.** It held only `legacy-peer-deps`.
- **tsx**, as a dependency and from every npm script and script header. `npm run dev` is `node server.ts`.
- **`experimentalDecorators`** in tsconfig. No code uses decorators.
- **ESLint**, with `@eslint/js`, `typescript-eslint`, `eslint-plugin-jsx-a11y`, `eslint-plugin-react-hooks` and `eslint.config.mjs`. The lockfile holds 950 packages, where it held 1,104.

### Added

- **The corvid lives in its ring.** The mark is two things now: the ring, the C, which never moves, and the bird in it, which is the only thing any animation touches. The sidebar's bird blinks every three to seven seconds, one blink in five doubled, and between them it looks about, cocks its head, looks back over its shoulder, preens, shakes out its feathers, stretches a wing, caws without a sound and hops. Every act is made fresh from a random source, so no two are alike, and every one ends in the logo. Big acts wait while you type. It watches the pointer when it comes near, in the quick turns and still holds a bird's head moves in, gets ready when its button is hovered or focused, and falls asleep after two and a half quiet minutes, waking with a start. It costs nothing while it is still: one timer between acts, frames only while something moves, nothing in a hidden tab or out of view.
- **It leaves the ring to fly, a different way every time.** A press sends a full corvid out of the C. It crouches, turns its body under a head that holds still, draws in the back of its head, which the ring had been drawing for it, and leaps. Each lap is a new random route, with its own pace, bursts of wingbeats and glides, pitch with the climb, a turn round where the route doubles back and, now and then, a barrel roll. It comes home from the ring's open side, flares, lands, folds its wing and looks back over its shoulder into the logo. The ring stays in the sidebar the whole time, empty. `planFlight` in `src/lib/corvidFlight.ts` is pure and seeded, so every promise is a unit test.
- **The rig.** `src/assets/corvidRig.ts` poses the logo's own strokes from a set of numbers, so the flying, preening and sleeping bird is the same drawing as the mark and not a second one. At rest it draws the logo point for point. The model sheet, `docs/brand/corvid-poses.svg` and `.png`, is every pose drawn by the rig, written by `npm run brand:icons` and held byte for byte by a test.
- **It answers the app.** A follow-up done gets a nod, a conversation written down a silent caw, somebody new a hop, a person tracked a cock of the head, a merge a preen, a restore from the trash a nod, and an import that adds people the celebration pass. Each is asked for on success only, and a repeat within four seconds plays once. A celebration waits until no dialog covers the page.
- **It notices the app at work.** `apiFetch` counts every request that comes back OK. About once a hundred requests, or once every six to twelve AI answers, the bird does something of its own, and now and then, at Full, takes a short flight near home. Never twice in twenty seconds, an outing never twice in three minutes, and never an outing while a dialog is open or a field has focus.
- **The bird beside "Corvid motion".** Settings, Appearance: a live bird in its ring next to Full, Subtle and Off, living faster so the row shows what it does. It is a button named "Try the corvid": a press flies it from its own ring at Full and flutters it at Subtle. The empty detail pane's large bird lives calmly now, and the "All reviewed" bird hops and then lives calmly.
- **A favicon drawn for each size, and a brand kit.** The mark has four optical sizes now (`CORVID_OPTICAL` in `src/assets/corvidPaths.ts`): the same paths with a stroke, an eye and a margin for the size a person sees. At 16 px on a 1x screen the tab takes `tiny`, the C, the head, the wing and the outer tail. At 2x and 3x it takes `small`, the whole bird. Launcher, home screen and store icons take `medium`, and the logo is `large`, its own weight. The size a person sees picks the master, not the file's pixels. `public/` serves `favicon-16.png`, `favicon-32.png` and `favicon-48.png`, the two smallest fitted to the pixel grid, `favicon.ico` with the three frames, the touch icon, the launcher icons and maskable icons at 192 and 512. `docs/brand/` is the kit: the mark in four versions (light ground, dark ground, one colour, reversed), the app icon's master and a 1024 px render, the lockup of the mark and the name for light and dark grounds, the repository's social card, and `docs/brand/README.md`, the guide: the anatomy, the sizes, the colours with their contrast, clear space, minimum size, type, every file and what it is for. `npm run brand:icons` writes all of it, and a test holds every SVG byte for byte.

### Changed

- **Nothing moves the ring.** The thinking bird tilts only its head, about the rig's neck, and each one keeps its own time, so two thinking at once are not in step. The head shake at a wrong password turns the bird's head away and back, and the "All reviewed" hop lifts only the bird. At Subtle a press on the perch flutters the bird's wings instead of hopping the whole mark. The mark's parts are named for what they are: `body` is `ring` and `beak` is `head`.
- **The tab's corvid reads as a corvid.** The favicon was the ring, the head and the wing at one heavy stroke, scaled to every size: at 32 px they ran together into a wave, and a home screen showed the same slab at 512. Each favicon is drawn for its pixels now, and there is no SVG favicon, because a browser takes it over every sized one. The tile runs from primary-dim to 55 percent of the branding gradient, `#2795c9`, so the white bird keeps 3.37:1 in its lightest corner, where it had 2.1:1 on `#47befd` and the tail faded into it.
- **The link preview wears the brand.** It shows the app icon with the whole bird, on the app's own surface, `#f8f6f2`, where it had a cool grey that was never the app's. The name is set in Manrope ExtraBold and the line under it in Inter, the app's faces, as outlines. The README opens with the lockup, with a dark version for a dark page.
- **The left panes show their scroll bar on hover.** The Network list and the Settings rail show their thumb only while the pointer is over them or the keyboard is in them. The bar sat against the sidebar all the time and read as part of it. The lane stays, so nothing moves when the thumb comes back.
- **Track's glyph and word sit in the middle of the button.** The label keeps the width of its longest word, and a short word such as Track sat against the left edge with a gap before the chevron.
- **The shortcuts dialog shows the page's own keys.** `?` and the sidebar's keyboard button open two columns: the shortcuts that work everywhere on the left (Navigation and Global), and the page's own on the right, from `pageShortcutGroups(pathname)`. A contact shows its keys and the list's beside it, the map its five, Pulse its queue keys, the Possible duplicates queue its own, and a page with none says "No shortcuts of its own". It listed every group in the app in one column, so the map's keys sat below forty that did nothing there. With single-key shortcuts off, the keys the switch turns off are dimmed and named "off", and the footer links to the switch. Otherwise it links to **All shortcuts** on Settings, Keyboard. The Possible duplicates queue's J, K, L, H and Space are in the table now, and its letters obey the single-key switch. Notes' one row is folded into Ask Contrack, with Escape to clear the search. The dialog and the Keyboard page share one set of keycaps (`ShortcutKeys`).
- **Track is slimmer.** The button is about 110 px wide at its widest word (it was 121): 4 px between its parts, tighter sides and a 12 px chevron. Its menu is 11 rem wide, where every other menu starts at 13 (`ActionMenu` gains `panelClassName`).
- **Settings has the Network list's left pane.** The rail opens at 350 px and a person drags its edge between 300 and 480, with the keys, the double click and the press of the list's handle. One stored width serves both panes (`LEFT_PANE` in `src/components/layout/paneWidth.ts`), so moving between Network and Settings leaves the page where it was. The rail's scroll bar sits on its left edge, as the list's does. The loading skeleton opens at the stored width. It was a fixed 240 px.
- **Reset to defaults is one button, at the page's end.** While any setting on a page is off its default, the page ends with **Reset to defaults**, in the look of Pulse's Log note. It resets every changed setting on the page, says how many in a toast with Undo, and puts the keyboard on the first row it reset. Each row had a Reset button of its own. The dot after a changed setting's title stays, and "changed" now means the value: a setting set back by hand is stored at its default and takes its dot away, and the button goes with the last one. `PreferencesContext` gains `changed` and `setPreferences`, and `resetPreference` keeps one identity across its states.
- **Tracked contacts is a settings page.** It opens at `/settings/tracked`, inside the shell: the rail stays beside it, the header is the shell's, and Select sits in its actions. Pressing it in the rail used to leave Settings for `/tracked`, and the rail vanished. The old path leads to the new one with its hash, and the Network list's Manage link and the Keeping up card link to it. The `door` flag on a settings page is gone.
- **The Duplicates page puts the tool first.** The tabs, **Scan** and **Manual merge**, come first, then the scan's one card: the three scans as a radio group, each with one line, and **Scan now**. **Automatic merging**, the sensitivity and the two automatic checks, is a section under the tool. The settings used to sit in a card above the tool, and the tool opened on a large brain icon that repeated the page's title. **Merge activity** is the square history button in the header at every width, as Ask Contrack's History is. The page is a block in the shell's one scroller now, and its Reset to defaults comes with it.
- **A tag on the Tags page opens the people who have it.** Its name and count are a link to `/?tag=<tag>`: the Network list shows the tag as a pressed chip, "# investor 7", and keeps the contacts with that whole tag, in any case, spaces included. Pressing the chip, All or any other chip shows everyone again.
- **The admin General page, tightened.** Four sections: Instance, Sign-in, Data and Integrations, each a card of `SettingRow`s, so every setting is a search result (the rows gain Sign in by emailed link, Snapshots to keep, SearXNG and the Google OAuth client). The cards repeated their heading as a first sentence and ended with a paragraph of their own. The instance name's count shows near its limit only.
- **One radio group for Settings.** Settings drew ten radio groups by hand, each with its own tile and its own keys. `ChoiceGroup` draws eight of them: the General page's four sets of presets, the dedupe scan, a password reset's delivery, and the role of a new account or an invitation, which share one `RolePicker`. An invitation's role now says what each role may do, as a new account's did. A token's expiry and an invitation's are short choices with no hint, so they are a `Segmented`, as a connector's schedule is.
- **A statement ends without a period, on every page.** Every settings page's description, every row's, and the one-line statements on cards, buttons, hints, empty states, dialogs, banners, errors and toasts drop their closing period, and a statement of several sentences drops only its last. Words a person only hears keep theirs, because a speech engine ends a sentence on it: an accessible name, the search's live region and the drag announcements. Two strings copy another system's words exactly and keep them too: the server's sign-in error and the browser's abort message. `tests/unit/copy.periods.test.ts` holds the rule for the statement props, the text between tags and every sentence written as a string under `src/`, and for the settings registry and the destination names. The last five errors that said "Please" do not.
- **Simple empty places say it in the title.** `EmptyState`'s sentence is optional. "No lists yet", "No tags yet", "Trash is empty" and the audit log take none. Recent imports is not drawn before the first import. Import, Archived, Accounts and Privacy say less.

### Fixed

- **The link preview's name was in Helvetica.** The script set it through Pango, and on macOS Pango finds fonts through the system, not through the file it is given. Manrope is not a system font. Every word in a brand image is an outline of the app's own WOFF2 faces now (`scripts/brand/type.ts`, with `fontkit` and `wawoff2`), and measures within a twentieth of a pixel of Chromium's.
- **Notes search flickered.** Five causes, each measured frame by frame. The old cards remounted and faded in again the moment the words changed. A slow answer's results gave way to a shimmer after 150 ms and came back. The shimmer then held an answer that had already arrived for up to 400 ms. The empty state blinked out on every filter change. And the box's glyph spun for one frame on every fast search. The last answer now stays in place until the next arrives, and the next replaces it in one commit, keeping any card that is in both. A search slower than 150 ms dims the old answer and spins the glyph until the new one lands. Only a first search shows the shimmer, and it holds 400 ms once shown.
- **A new note search asked twice.** The page offset was reset in an effect after the render, so a new question on page two first asked for page two. The offset is keyed by the search now, and a new question asks once, from the first page.
- **"No notes match" asked for a stem.** The index already stems and matches every word as a prefix. The hint says "Try fewer or other words", or a wider period.
- **People search dropped an Engineering role for "engineers".** The hard filter matched a role as a whole word, so "engineer" found nobody whose role is Engineering and "designers at Aperture" missed the Design lead there. A role finds its other forms now (`roleVariants`): engineer and engineering, designer and design, marketer and marketing, consultant and consulting, and the plurals. The first words of a phrase stay, and a field never takes its bare stem. The filter and the check after the rerank read the same forms.
- **A link to a Tracked group landed at the top.** The virtualiser attached to the page's scroller even when the list was short, and put the scroll back where it had last seen it, after the page had scrolled to `#fading`. It is enabled only past 200 rows now.
- **The note search compiled its statements on every request and read whole note bodies.** Its statements are cached by their SQL, and a hit whose title matched reads only the 241 characters of its body it shows.
- **Two duplicate warnings said a merge cannot be undone.** A large cluster's warning called merging irreversible, and every merge is logged and can be undone from Merge activity. Both say "Check that they are all the same person" now.
- **History rows remounted as a question was recorded.** A row was keyed by its id, which is a stand-in until the server answers. It is keyed by the question now.

- **Track is one menu, with one word for how often.** The split button, a toggle word and a caret behind a hairline, is one menu button now: 32 px tall, flat, with no line down its middle. Untracked it reads **Track**. Tracked it reads the cadence in the selected tint, one word: **Weekly**, **Monthly**, **Quarterly** or **Yearly** (7, 30, 90 and 365 days). The menu, **Keep up**, lists the four. Untracked each row tracks in one press and the account's default carries the hint "Default", which a screen reader hears too. Tracked the current row is checked and **Stop tracking** sits under a hairline. Quarterly stays because 90 days is the account default and most tracked contacts have it. A cadence of 60 or 180 days, a choice before 2.0, keeps working: the preference still accepts both, a menu shows it as one more checked row ("Every 2 months"), and the button says it short, "2 months". Every word the button can show sizes its label, so it keeps one width. Toasts read "Tracking Ada Lovelace, quarterly". The `t` key stays a one-key toggle at the default cadence. `CadenceMenu` is folded into `TrackButton`, and `shared/cadence.ts` gains `shortCadence` and `cadenceOptions`. `ActionMenu` items gain `separatorBefore` and `speakHint`.
- **Change avatar is a pencil on the picture.** The item left the ⋮ menu for a small round badge on the ring's lower right, "Change avatar": 28 px on the 96 px avatar and 24 px on the phone's 56 px one, with a 44 px tap box set out towards the empty corner, so a tap on the face still opens the score breakdown. It is lightly clear at rest and solid under the pointer or the keyboard, and it shows on a phone, which has no hover. It is its own button beside the score button, never inside it, and focus comes back to it when the picker closes. The Archived chip moved just under the avatar, clear of it.
- **Enrich contact, from the ⋮ menu.** It researches this one person in the background, the way the Enrichment page does for many: the progress panel opens at the bottom right and the page stays yours. It is hidden with AI off and for a ghost, and reads **Enriching…** while this contact's research runs. Another account's research in progress is said in a toast (`startSearch(ids, { limitAs: "toast" })`). It had no page to say it on, and a refused start said nothing.
- **+ link on the meta line.** After the links, with no dot before it, as "+ tag" follows the tags. It opens a field, "Paste a link". Enter adds it with `https://` when the text has none. Text that is not a web address, or a link the contact already has in any spelling, is refused beside the field, and the text stays. The server works out the platform from the host, so the link arrives with its icon. On a phone it is the plus alone.
- **The local time says its zone.** "2:13 PM EDT", "4:45 AM AEST", "GMT+9" where no locale has an abbreviation. A screen reader hears the full name, "Eastern Daylight Time". The digits are tabular, so a phone's meta line no longer rewraps as the minutes change.
- **Pulse's line uses centred dots.** "3 overdue · 1 birthday this week · 12 days in a row", with no commas and no closing period, and one item alone has no dot. A screen reader hears a comma at each dot (`MetaDot`, shared with the contact's meta line).
- **Moving a Pulse card lands where you point.** Customize mode moved nothing until the drop, measured from the dragged card's box, so an 800 px card aimed with the pointer at its top landed by its middle, and the card lagged the pointer behind a `transition-all`. Now the pointer picks the column and then the place, before the first card whose middle is below it, and each step moves the card in a draft of the layout: the target column opens a 64 px dashed slot and the cards it passes slide aside (`lib/dropTarget.ts`, `lib/flip.ts`). A compact preview follows the pointer with the title and the landing place ("Intelligence · 3 of 5"), and flies into the slot on drop. One write, on drop. Escape restores the layout. A finger holds the grip for 200 ms, and a flick on it still scrolls the page. The grip shows on phones now, and the Move menu gains Move up and Move down at every width in place of the phone's arrows. The arrow keys move a focused grip, and every step is announced with the card, its column and its place. The heavy cards never render during a drag (a render-count test holds it), and the slowest frame during a drag was under 20 ms, where the old drag had a 67 ms one.
- **The right-hand panel opens from one button that stays put.** The 64 px rail at the right edge is gone. Ask Contrack's history and the map's insights open from a button in the page's top-right corner: a square History button level with Ask's title, and a square button with the insights glyph level with the map's toolbar. Both are the pressable `.btn-secondary` with the glyph alone, and while the panel is open the button stays pressed in, in the selected tint (`.btn-latch`), so the one control that opened the panel reads as the one that closes it. The panel's Hide button is gone. The panel slides in from the window's edge under the button, at the slow duration and out at the base one, and its content follows a beat behind. The button never moves. The heading row ends with the button's own face drawn invisible, so the title and the actions stop where the button begins at any word length. Under it the content takes the panel's full width and the scroll bar sits on the window's edge (`SIDE_PANEL_SCROLLER`). The map's panel holds its Summary and People switch in that row, whose words and content say what the panel is, and keeps its heading for a screen reader (`titleHidden`, `lead`). The map runs to the window's edge now, and it eases its padding on the panel's own timing and curve (`SIDE_PANEL_OPEN_MS`), so the pins and the panel arrive together. Escape inside the panel and the page's key (`H`, `I`) still close it and hand the keyboard to the button.
- **Notes search has People's shape.** One search box serves both modes (`AskSearchBox`): the mode's glyph, the words, Clear, and a square search button with the magnifying glass alone, named "Search". The button's word is gone on People too. Notes searched as the words were typed and had no button. Now Enter or the button searches, as on People, and the filters apply the moment they change. The kind is the first chip under the box, **All kinds** or the chosen kind with its glyph ("Calls") in the selected tint, and the label "Kind" at the far end of the period row is gone: what, then when, the order Gmail and Drive use. On a phone the six periods fold into one **Any time** chip, so the two filters share a row. An answer that takes more than a moment shows People's "Searching…" line and shimmer cards, a fast one never flashes them, and once shown they stay long enough to read (`useLoadingShown`). The results header reads "Search results" with the count in People's pill. The suggested questions are gone from Notes. With a kind chosen and nothing found, **Search all kinds** widens the search in one press.
- **The Network list counts a search, and its rows rise toward the pointer.** A search's count sits where its results start, in the list's own small label, the slot "Recent" and "All contacts" hold while nobody searches: "12 matches". A screen reader hears "12 contacts found" once the typing pauses for a second. The row under a mouse rises up to 2 px with a soft shadow, and the neighbour on the pointer's side rises as the pointer nears it: the row below in the lower half, the row above in the upper half, half each on the line between them. The curve is a raised cosine over one row's pitch, so the two lifts always add up to one and nothing jumps. One animation frame per move writes `--p` on at most two rows and React never renders (`useProximityLift`, `.proximity-row`). It follows a mouse only, the rows do not move under reduced motion, a key press lays them down, and in the dark palette a lifted row also takes a faint light wash, because a shadow does not read on the darkest surface. It is the one list that lifts ("Elevation" in STYLE.md).
- **The sidebar's foot is part of the rail.** Keyboard shortcuts, Settings and the account sat in a box of their own, a shade darker with rounded top corners. They sit on the rail's own surface now, set apart by their place at the foot and their tighter spacing.
- **A history entry's Pin and Delete keep off the question.** They floated on a card-face pill over the row's middle and covered the end of the question. They now sit at the end of the entry's meta line ("7 people · 18 hours ago"), which keeps their room, as two small icon buttons with 44 px tap boxes.
- **`.btn-icon` is square at every size.** It was a padding for the small size, so an icon-only button at the regular size came out 34 px wide and 40 px tall. It is as wide as the button is tall now: 44 px on a phone, 40 from `sm`, 32 with `.btn-sm`.
- **The map's heat, rebuilt.** The heat read the clustered source, so a cluster of twelve people added what one person adds, and the densest city drew no hotter than a lone contact. It now reads its own unclustered copy of the contacts. Every person weighs 1, and a long note history weighs up to 2. The densest place (the heaviest 1 degree cell, counted as 4 to 128 people) sets full density, and each stop of the ramp doubles the density, so a town of three and a city of ninety read apart. The radius grows with the zoom (16, 26 and 44 px at zoom 0, 4 and 9), the heat sits under the basemap's labels so a city's name reads over its own heat, and it fades out from zoom 7 while the pins come back at 8. Past zoom 9 the legend becomes "Zoom out for heat". The colours follow MapLibre's heatmap example and the cartography on sequential ramps (CARTO's BluYl, viridis): a transparent start, then the accent's deep tone mixed with a warm yellow in OKLCH, darkest for the most over a light map and brightest over a dark one. The ramp follows a picked accent. `src/views/map/heat.ts` holds it, with tests in `tests/unit/map.heat.test.ts`.
- **The map's bottom line says who is in view, and what to do.** "30 in view", or "12 of 30 in view" when some people are off screen. "3 overdue" is a filter to press (`aria-pressed`): it shows only the people whose follow-up is late, and Clear filters clears it too. "Fit all" shows only when nobody is in view, and with the heat on the line carries its legend, from fewer to more. It held five chips: at risk and the average score went with the Health layer, and the time zones are in the insights panel by name. The count is of the people a person can see: the part of the map under the open insights panel or an open contact is not "in view". When a network is wider than the map shows at its lowest zoom, as on a phone, Fit all shows the stretch of longitude that holds the most people instead of the middle of the box, which was Europe with four of thirty. The line never covers the tab bar, the credit, the zoom buttons or the panel, at four widths, in both palettes, at world and city zoom.
- **One right-hand panel.** `SidePanel` (`src/components/layout/SidePanel.tsx`) is the left nav's mirror at the right edge: a 64 px rail that holds the panel's icon, and a 320 px panel that slides out from under the rail over the page. The page never moves when the panel opens or closes. The rail's icon is a disclosure with a tooltip, the panel's heading row names it, shows a count and ends with Hide, and however the panel closes (Hide, Escape inside it, the page's own shortcut) a keyboard inside it lands on the rail's icon. A closed panel is `inert`. The map's insights and Ask Contrack's history use it. The map's floating Insights button is gone, the canvas ends at the rail, and the insights drop their overview cards, which repeated the bottom line. `RailTooltip` is the label beside an icon on a slim rail, for the left nav and the right rail both.
- **Ask Contrack's history is a rail, and the search box stays put.** From `lg` the History icon sits in the right-hand rail, where the clock button in the header used to be, and the history opens over the page. It used to push the column aside and move the search box 160 px. From `lg` the column sits where the open panel never covers it (`ASK_COLUMN`): centred while that leaves the panel's 320 px free, and only as far left as it must on a narrower window, so at 1024 px the search box ends 35 px short of the open panel. The box sits at the same place with the panel open or closed, at every width. The scroller keeps its bar's lane, so the column no longer shifts when the results arrive. In the filter, the first Escape clears the words and the next hides the panel. Below `lg` the header's History button opens the sheet, as before. The route's loading skeleton draws the rail, so the column lands once.
- **The Network list is as wide as you make it.** From `lg` the list's right edge is a handle: drag it between 300 and 480 px, or focus it and use the arrow keys (16 px, 64 with Shift), Home and End. A double click restores 350, and a press that does not move swaps 350 for the widest the window allows, and back: the way to resize with one pointer and no drag (WCAG 2.5.7). The swap waits a moment for a second press, so a double click still restores the default. It is a focusable separator with its value and bounds, the width is kept per device, and the open contact always keeps 560 px, so on a 1024 px window the list stops at 400. A drag writes one CSS custom property per frame and renders nothing, and the contact page renders again only when its pane crosses 768 px (`useElementWidthAtLeast`), not on every frame. The letters of the jump rail sit 2 px further from the pane's edge, and their tap boxes stay where they were.
- **Pulse asks nothing of you.** The "Ask about your network" field under the masthead and the "Ask about this insight" chip on the daily insight are gone: Ask Contrack is one key or click away, and the two entries repeated it. The masthead is 64 px tall from `sm` (it was 120), so the cards start 56 px higher, and the loading skeleton matches the page at every width measured. The cards line up with the title's left edge (they sat 4 px inside it), and sit 24 px apart everywhere (the rows at 1024 px had 32 and 24). From 1280 px the middle column is never narrower than 19rem: three twelfths was 257 px at 1280, and Coming up cut names short and the Composition switch spilled out of its card.
- **Settings: one back rule, one header, and a slide on the phone.** From `lg` no settings page has a back link. The rail and the sidebar are on screen, and every settings title starts where Pulse's and Tracked's do, 32 px down (it was 52). Below `lg` a page shows "‹ Settings", back to the list, and the list has none (`settingsBackLink` in `registry.ts`). There, opening a page slides it in from the right while the list drifts left, and Back reverses it, in 240 ms on the app's curve. React Router's `viewTransition` option needs a data router, so `slide.tsx` starts the View Transition itself and waits up to 350 ms for the page to draw. A press on a link starts loading the page's code, the tab bar holds still, and the list comes back at the scroll position you left. Reduced motion and a browser without the API just navigate. Each page's description and buttons sit in the header (`SettingsHeaderActions`), the hand-written intro paragraphs are gone, and every page has one scroller, which keeps its bar's lane, so a title starts at the same place whether or not its page scrolls. The slide stays inside the page's own box and no longer passes over the left nav at 768 px. The review fixed the rest page by page. Correspondents no longer lights Connectors in the rail too, admins no longer see AI usage twice, and the selected row's count pill passes contrast. Rows have no lines between them, and a flashed row no longer draws a ring. Outgoing mail's checkbox is a switch, Trash's purge asks through `ConfirmDialog`, Accounts says "Create account", MCP's code wraps, and removing the Google client asks first. Plain words replace "reauth", "ghost", "magic link" and "purge", Import's description names the real sources, and the weather switch is named for what it controls. Lists and AI providers sit in the same centred box as every other page, with a heading over each card and no icons in the headings. Every empty and error state is `EmptyState`. axe finds no WCAG 2.2 AA violation on the 23 pages, at 1440 px light and 390 px dark.
- **One scrollbar.** Every scroller draws the same thin bar: the hairline token for the thumb and no track, from one rule in the base layer. It was a class, `nice-scrollbar`, on nineteen scrollers, and every other scroller drew the browser's own wide grey bar. The Network list keeps its bar on the left edge, away from the letter rail.
- **What lifts on hover, and why.** A lift says "this whole thing opens something". A self-contained surface that acts as one control lifts: a card by 2 px (`card-interactive`), and a smaller tile by 1 px with a soft shadow (the new `lift` class). A row in a list of rows, a button and anything static never lift. Ask Contrack's suggested questions, the Pulse rows on a card's wash, a note's file attachment and the settings tiles that run one thing now lift. Two scans in `tests/unit/styles.floor.test.ts` fail on a hand-rolled `hover:-translate-y-*` or `hover:shadow-*`, and on a `transition-*` class beside `lift`. The protocol is "Elevation" in `.agent/STYLE.md`.
- **Buttons press, and the whole app shares one look.** A call to action now has depth: its face sits on a darker edge, rises 1 px on hover and sinks onto the edge on a press, and the edge's bottom never moves, so the button reads as one object going up and down and nothing around it shifts. The edge is mixed from the face, so it follows a picked accent, a contact's colour and the dark palette. `.btn-danger` joins `.btn-primary` and `.btn-secondary` for an irreversible destructive act, and `.btn-sm` is the small size with the 44 px tap box built in. A disabled button is flat, with no edge, so a disabled primary no longer looks like a secondary. Three destructive buttons in the admin pages named a colour token that does not exist and drew no red at all. **One hover per kind of surface**: a flat control (a row, a ghost button, a pill, a nav item) takes a 6 percent ink layer that works on any surface in both palettes, a card that is itself a control rises 2 px, and a static card has no hover. This replaces about eighty hover classes, including a result card that scaled its text and animated a CSS property that does not exist. **One selected look**: a selected row, pill or nav item wears the primary tint and nothing else, never a ring, which read as keyboard focus, and never a bar down the leading edge, the stock accent of generated interfaces. **One focus ring**: the base layer's 2 px outline, outside a control and inset on a text field, replaces ten `focus:ring-*` variants, and a composite field such as the Ask search box draws the ring on its box. **One page header**: Network, Pulse, Ask Contrack, Tracked contacts, Possible duplicates and every Settings page share `PageHeader`: the page's name is the title, 24 px on a phone and 30 px from `md` on every page, the narrow Network pane too, with the same top spacing and no band, border or icon tile. Pulse's title line reads "Pulse Tuesday, September 22", the day in a softer ink at the title's size, and on a phone the day takes its own line under the title and the buttons. **Colour that means something**: overdue is red, today and catch-up are the primary, birthdays and possible duplicates are amber and new people are green, from one tone map that the Up next dots, row glyphs and chips and the Inbox icon tiles all read. A search match is a warm highlighter mark instead of a second blue. The AI reason on an Ask result wears the AI colour, and a field a model filled wears it too instead of a pulsing primary glow. The contact colours lose Violet and Indigo and the accent presets lose Violet, because they sat on the AI colour's hue and made a contact's own buttons look like a model's chips. **Warm paper**: the light greys lean warm at the same lightness, so every text colour clears AA by the same margin. **One tracking and sentence case**: every uppercase label tracks at 0.08em and every string a person reads is sentence case. **One curve and three durations** (120, 160 and 240 ms) for every transition, in `src/index.css` and `src/lib/motion.ts`. The corvid tilts its head on Ask Contrack while a search runs. `tests/unit/styles.floor.test.ts` scans the source for every rule above, and `.agent/STYLE.md` describes them.
- **Fixes found along the way.** A contact's page set five of the six accent tokens to the contact's colour, so text on the tint kept the app's accent. It now sets all six. Two borders named `outline`, which is not a colour token, and drew in the text colour. The Connect Google dialog's "Configure in Settings" link went to a route that does not exist and now opens the Integrations section of the General page. The Connectors and Correspondents pages had no side padding. The dark glass panel reset the hover layer on the map's floating buttons. Ghost contacts, the dedupe demo data and the mock seed wrote colour ids the client no longer draws. The Pulse editing bar named animation classes nothing defined, and it now fades in. Radio-style option groups (the admin presets, a role, an invitation or token expiry, a follow-up date) show the chosen option with a filled dot as well as the tint, a picker of icons or avatars marks its choice with a ring in the ink colour, and the icon pickers and the avatar style chooser now tell a screen reader which option is chosen. The unused Instance page and the Duplicates view's standalone header, which nothing rendered, are deleted.
- **Ask Contrack leads with the search box.** The header is the title, the People and Notes switch and the History button, with no line of description. Indexing is one slim line under the box, "12 of 30 contacts indexed" with quiet Index missing, Inspect failed and Retry failed buttons, in place of the empty-state hero, the explanation and the coverage card. The suggested questions are flat chips, and the first three come from the person's own network, its most common industry, city and company, so a press always finds someone. The fixed questions found no one on a real network, and "Who haven't I contacted in over 3 months?" never could, because People search reads profiles, not dates. The history pane has a Hide history button at the right end of its header, and the History button in the page header, one name in both states, opens it again. On a phone the history sheet closes from a visible X. A search with no results is one line, "No one matches", and a notes search with none drops its count, its any-word notice and its order. The results label is the muted label style, not a second blue that read as a link.
- **A second pass over every page, with AI on.** From 768 to 1023 px the Network list ran 64 px past the window and cut off Import, New and the sort menu. It now fills the space beside the rail. In select mode the title stays "Network", the count leads the bulk bar and is spoken whole, every action rests at "0 selected" (Delete was live there), the list keeps room under its last row for the bar, and focus moves between Select and Done. A deep link scrolls the list to the open contact, and a contact the list does not show is marked in Recent. The contact page's "Pending follow-up alert" now says the fact, "Follow-up 3 days overdue", "Follow-up due today" or "Follow-up due Friday", from one helper that the row's name and its tooltip share. The map counts a follow-up as overdue by calendar day, so one due tomorrow no longer counts at 6 PM in Los Angeles, and its credit, legend, toolbar and strip no longer cover each other or the open contact. Pulse cards had about 30 px between the title and the body and now have 16, and they keep their height in customize mode. A one-day-late chip reads "1 day overdue". The first Up next row no longer looks selected before a person does anything: the tint and the name's primary ink follow keyboard focus and the queue keys, a press outside the list clears them, and while no row shows the tint the first of J, K, D, S and L only shows it, so D never completes a row nobody can see. A queue key pressed in a dialog, such as D on a button in the Log note dialog, belongs to the dialog. The resting checks clear 3 to 1. The masthead says "All caught up." only when the whole queue is empty. Daily insight's skeleton takes the insight's own shape, and its category sits under the title in sentence case. On the Duplicates pages, pair rows show whole names on a phone, the keeper's values read "Kept", not "Discarded", the settings page is one scroller with Compare stuck above the tab bar, and the scan card shows its exact-match and AI rows for the modes the picker offers. The command palette's Shift peek was clipped to 56 px by the palette's own panel and now shows in full, and the avatars lose a freshness ring that reused the health colours. The Notes suggestions are searches that find notes ("meeting last month", "calls this year"), and "Any time" no longer shows pressed while a date phrase in the words sets the range. A dialog without a title no longer draws a hidden Close button that covered its header. A history row's Pin and Delete no longer take taps while hidden. No raw palette colour is left in the app, and `styles.floor.test.ts` now fails on one, and on every form of a coloured bar down a leading edge.
- **Every Pulse card that is not the queue answers its question or steps aside.** An empty card is one line on the page surface: Inbox reads "Nothing to clean up.", Coming up reads "Nothing in the next two weeks." with a Connect a calendar link, and Daily insight without a key names the next step by role, "Add an AI key to get one." with a link to the AI settings for an admin and "Your admin has not added an AI key yet." for a member. **New people folds into Inbox.** The card and its Network growth modal are gone, and Inbox opens with the tracking action, "6 new this month, 2 untracked", a row that opens the Network list at `tracked:no`. The untracked count is read off the slim rows on the client. Inbox rows sit on the wash with no border, the count in each sentence in bold, and every row is a link. **Ask on Pulse.** A form under the masthead sentence, "Ask about your network", sends its question to the Ask page. It renders when AI is allowed and there is a network to ask about, from `sm` up only, because the phone has Ask Contrack in the tab bar. The Ask button waits for three characters, the shortest question the search runs. **The insight speaks for itself**: 15 px text, the category as a quiet badge after the title, and one chip, "Ask about this insight", that asks about its first sentence. **Coming up stops repeating the queue.** Birthdays in the next seven days are Up next's, so the card starts at day eight, and its birthdays and meetings sit in one list ordered by date with a chip that says when, "In 10 days", "Thursday". **Keeping up keeps the bar and the number.** The bar is 10 px, the number within cadence is the large figure, "9 of 10 within cadence", and "1 to catch up" is a button that scrolls the queue to its Catch up group. The four-week promise and "tracked in the last 30 days" are gone, and Rising and Cooling appear only once four snapshot weeks exist. **The heatmap fills its card**: the squares scale to the width, with month labels above and M, W, F at the left, and a pointer or a tap on a square shows one tooltip with the day's words, "Wed, Sep 17: 2 notes, 1 call", in the person's own locale. The sparkline is drawn at the width it is shown at, so its stroke is even, with a dot on this week, and its footer reads "53 in the last four weeks · +29% on the four before" and "This week: 1 note, 3 meetings". The streak is the masthead's. **Composition moves last**, to the end of the Intelligence column, as a 96 px donut in one hue, the primary at six steps, with a text legend of links under it. The AI colour leaves the chart. The Activity card reads its data from the page and no longer asks the server a second time.
- **The Network list applies a facet from its query.** `/?q=tracked:no`, `/?q=missing:company`, `/?q=updated:>6m` and `/?q=industry:Technology` used to put the words in the search box and score them as a name, which matched nobody. The list now applies the facet the way the command palette does and ranks the free text that is left, so every link from Pulse lands on the people it names.
- **A stored Pulse layout with an empty order shows the default order.** The server's default preference is `{ hidden: [], order: {} }`, and the cards it did not name came back in the order of the id registry, which put Composition ahead of the insight. They now come back in the default order of their column.
- **Up next is a pane, and its rows read as rows.** From `lg` the queue scrolls inside its card, capped near the viewport, so the page stops growing with the queue and the other two columns end where they end. The group headings, "Overdue", "Today", "This week", "Birthdays", "Catch up", stick to the pane in the card's colour with a small dot in the group's tone and the count at the right. **A click or a tap anywhere on a row opens the contact**, the same as Enter, and the "Open profile" button is gone. A row is two lines with a free right edge: the name and the chip on the first line, which wraps on a phone so the name is never cut, the title on the second, and "Last spoke 12 days ago" under them. **The chips speak in sentence case**: "12 days overdue", "Today", "Tomorrow", "Wednesday", with no border and no caps. The check shows faintly at rest. The selected row wears the Network list's tint, not a focus ring. **Snooze is the shared menu**: from `sm` it floats over the row's right edge on hover or focus, on a phone it sits in the flow as a 44 px target, and it renders only on a follow-up. The Keyboard tip in the card header lists the keys. The empty queue reads "Nothing due today" with one button, Log note, and the confetti takes the palette's own colours. The masthead's counts now land on the group headings inside the queue.
- **Completed is one line.** "Nothing completed yet." or "3 completed recently" with a quiet Show that opens the list under the line: the title struck through, the name as a link and when it was done. Hide closes it.
- **Pulse cards keep one padding.** The card surface carried 24 px of padding and the card frame added 16 to 20 more, so a card on a 390 px phone spent 80 px of its 350 on padding. The frame now sets the one inset, 16 px on a phone and 20 px from `sm`, and every card's body is that much wider. `InfoTip` gains `align="end"` for a trigger at the right edge of a card, so its panel opens over the card instead of past its edge.
- **Pulse has a masthead that leads with the day.** The title line reads "Pulse Tuesday, September 22": the page's name in the title ink and the day in a softer ink at the same size, 30 px (24 px on a phone, where the day takes its own line), so the first thing on the morning page is the morning. One sentence replaces the row of chips: "2 overdue, 2 due today, 3 birthdays this week. 12 days in a row." From `sm` up each count is a button that jumps to its card, and on a phone the counts are plain text that wraps, so nothing scrolls sideways. **Log note is the one primary action.** New contact and Customize layout move into a **More** menu, and the `c` key still toggles customize mode. The masthead stays under 180 px on a phone before the first card.
- **Enter belongs to the control that has focus.** A window-level Enter used to open the highlighted Up next contact from anywhere on the page: on the Customize button, on the Manage link, on a snooze menu item. That handler is gone. Each Up next row is now a focusable list item with a roving tab stop: Tab reaches the highlighted row, **Enter opens its contact, Space completes it (or logs a note for a birthday or a catch-up), ArrowDown and ArrowUp move the highlight**, and the highlighted row scrolls into view when J, K or an arrow moves it. A button inside a row keeps its own keys. The arrows join the shortcuts dialog under Pulse.
- **One type scale and one grid for Pulse.** `PULSE_TYPE` in `src/views/pulse/lib/pulseStyles.ts` holds the page's sizes (card titles 15 px, names 14 px, meta 13 px), and `GRID_CLASSES` and `COLUMN_CLASSES` hold the three columns, which the page, its skeleton and the route fallback all read, so the silhouette no longer jumps between 1280 and 1535 px. The columns are 5, 3 and 4 of twelve at `xl`: Up next is the job, so it takes the widest. At `lg` the Intelligence column runs its cards two across under the other two, and the sortable strategy is the rect one, which sorts a list and a grid alike.
- **A card is a title and a body.** `CardFrame` loses the header hairline and the icon. The count is muted text after the title, and a screen reader hears "Up next, 10". A new `line` variant renders a card with nothing to show as one row on the page surface: the title, the count, one sentence and the customize controls. Later prompts apply it to Completed, Inbox zero, Coming up and Daily insight.
- **Customize mode, quieter.** The Hidden cards tray renders only when a card is hidden. The bottom bar says what to do at that width, "Drag a card to move it. Use the eye to hide one." from `sm` and "Use the arrows to move a card and the eye to hide one." on a phone, and wraps to two lines above the tab bar. The welcome state reads "Bring your people in. Import contacts and log a note. Pulse fills itself from there."
- **Track is one control, a split button, and it keeps one shape.** The cadence used to arrive as a separate chip beside the Track button the moment a contact became tracked, which pushed the word "Track" sideways under the reader's pointer. It is now the caret at the right end of the button itself, behind a hairline in the same rounded shell, and the button takes the primary wash when it is on as before. **The caret is there in both states**, so nothing appears on press and no empty slot waits for it: before tracking it is named "Track, and choose how often" and its five rows track the contact at the cadence you pick rather than at the default, in one press, and after tracking it is named for the cadence in force and its rows change it. **The word does not move either.** The header cluster is right-aligned, so a control that grows drags its own label along: the label is sized to the longer of "Track" and "Tracked" with the current word drawn over it, which makes both states the same width to the pixel. The narrow header keeps the shape with the glyph alone. `shortCadence` in `shared/cadence.ts` goes with the chip that used it.

### Added

- **Keeping up, the one card on Pulse for the people you track.** It takes the Momentum card's place at the top of the Network column and shows the state now and the trend: a bar split by the ring state of every tracked contact, named "42 tracked: 30 strong, 8 fading, 4 at risk, 0 with no interactions yet", with a legend of links to the groups on the Tracked contacts page; one line, "31 of 42 within cadence, 11 to catch up"; Rising and Cooling, three each, with the delta as a chip, or the line "Rising and cooling show after four weeks of tracking" before four snapshot weeks exist; and "5 tracked in the last 30 days". When nobody is tracked, the card says so with one button, Choose people, to the Tracked contacts page. Its **Manage** link is the door from Pulse to that page. The dashboard payload carries it as `tracking`, with `catchUp` beside it.

- **Track, in one place and in bulk.** The controls that set the flag, now that the ring means tracked. On a contact page, **Track** is the one button beside the actions menu: a toggle that reads Tracked when on, with the ring appearing around the avatar as it is pressed and a toast, "Tracking Ada Lovelace, every 3 months", with Undo. Pressed again it stops tracking, and Undo brings the contact back with the cadence it had. Beside it, while tracked, a chip reads the cadence in words and opens a **Keep up** menu of the five choices, with a value set through the API shown as a sixth checked item so the menu never lies. The `t` key does the same, listed under Contact in the shortcuts dialog. The bulk bar on the Network page and on the map gains **Track**, or **Untrack** when every selected contact is tracked, which flips only the contacts that differ and offers Undo. The filter row gains a **Tracked** chip with the count, a **Manage** link under it, and now shows with no lists at all. A new page, **Tracked contacts** at `/tracked`, groups everyone by their ring state, At risk to Not tracked, with a search, a Name or Recently tracked order, a toggle on every row, how far past its cadence each contact is, and a select mode with Track, Untrack and one cadence for the selection. Settings, Your data lists the page and steps over to it. **Settings → Network and contacts** gains **Track new contacts**, and **Default follow-up cadence** becomes **Default cadence**, a select with the five choices in words. The command palette's action row gains **Track** on `T`, and the `tracked:` facet gets its Yes and No presets and a pill colour.

- **Tracking: the score follows the people you choose (the data and the engine).** A contact is now scored only when a person tracks it. `contacts.isTracked` (off for everyone, new and old) gates both sweeps, the single-contact readers, the weekly snapshot, every Pulse query, the palette's at-risk signal, the AI insight's top and bottom names and the MCP action items. `contacts.trackedAt` records the moment the flag last turned on, written by two database triggers so a route, an MCP tool, a merge and an import all record it the same way, and cleared when it turns off. The cadence is set at the moment of tracking: from the body when it names one, else from the owner's `defaultCadenceDays`, which now offers a year (365) beside 30, 60, 90 and 180. `PATCH /api/contacts/:id` and `PUT /api/contacts/bulk-update` take `isTracked` and `cadenceDays`, and score the contacts that became tracked before they answer, so the ring is right on the next read. `GET /api/contacts/:id/score` answers 404 `NOT_TRACKED` for an untracked contact. A new `trackNewContacts` preference (off) tracks contacts a person adds by hand; imports and connectors never do. The slim list carries `isTracked` and `trackedAt`, the CSV export gains Tracked, Cadence Days and Tracked At, the search accepts a `tracked:yes` and `tracked:no` facet, and MCP `list_contacts` filters by `tracked`, `update_contact` sets `isTracked` and `cadenceDays`, and `get_contact` returns `scoreExplanation: null` for an untracked contact without writing. `shared/cadence.ts` holds the five cadence choices and their words, and `scoreView` in `shared/scoreBand.ts` is the reader every surface moves to in the next step. Nothing on screen changes yet: the ring, the controls and Pulse follow in their own pull requests.

### Changed

- **Slipping is Catch up.** The Up next group used to be fed by the score, under 40, and never read the cadence, which is not what "slipping" meant. It is now the tracked contacts past their cadence, the furthest past due first, ten at most, with the heading "Catch up, 10 of 14" when more wait. The clock is the last interaction, or the moment of tracking when nothing is logged yet. Each row's chip says how far: "3 weeks past due". A catch-up ranks after a birthday. The palette's zero state says the same thing with the same rule: its at-risk signal is now the two contacts furthest past their cadence, "Ada Lovelace, 3 weeks past due". One rule in SQL, `server/services/catchUp.ts`, feeds the list, the count and the zero state, so the two can never disagree about who needs a call.
- **The ring means tracked.** Every surface that shows a relationship score now reads one function, `scoreView` in `shared/scoreBand.ts`, and it answers in three states. A contact nobody tracks shows no ring at all and the picture takes the whole box, so a list of people a person never asked to keep up with reads as a list of faces and not as a wall of empty circles. A tracked contact with nothing logged shows the empty track and "No interactions yet". A tracked contact with a score shows the arc in its band colour. The contact list row's accessible name drops the score words for an untracked contact, and the palette's dot, the peek card's bar, the mention picker, the Ask Contrack results, the archived list and the map's hover card and people list all follow the same reader. The peek card and the map hover card say "Not tracked" where the bar and the chip used to be.
- **The map stops calling strangers at risk.** The health layer painted a red ring for a contact nobody had ever met, because a null score fell into the At risk band, and the hover card printed "Score 50" from the column default. A pin with no score now takes the neutral outline, the legend names it as a fourth swatch, and the stats strip counts it in neither the At risk number nor the average. The cluster arc counts only tracked, scored contacts.
- **The rings on Pulse draw something.** Every ring on Pulse drew an empty track, because the rows carried a score and never the date it was measured against. Up next and the Momentum card now carry the flag, the score and the date, so the arc is the one on the contact's own page. An action item row reads them from the contact cache, which is what the row never had.
- **The score explains itself from the contact page.** A scored ring in the contact header is now the button that opens the breakdown, named "Relationship score 72 out of 100, explain". The only way to reach the five signals used to be the map's hover card, which is the one place a person is not already reading about that contact.

- **The sort menu on the Network page.** Four choices, in the two words each one needs: "A to Z", "Z to A", "Newest", "Oldest". The list orders by a name or by the day a contact was added, each read both ways, and that is all of it. The choice that ordered by the relationship score is gone from the menu and from the "Default sort" preference, which now offers Name and Recent. It was the only choice that needed a sentence to explain it, the score is already on every row as the ring around the avatar, and Pulse ranks by score for a reader who wants that. A stored "score" default reads back as the name order. The menu's trigger shows the order and is named "Sort: A to Z", because "A to Z" alone does not say what the control is.
- **The map on a contact, and every map's chrome.** MapLibre's compact attribution control is born expanded: the moment a style's attributions arrive it lays the full "OpenFreeMap, OpenStreetMap contributors" strip across the map, and it stays until something collapses it. Every map collapsed it on load, so the strip flashed over the picture each time a map opened, which on the contact page is every person a reader steps to. MapLibre's own chrome is now hidden by CSS until the map has loaded, keyed on `data-map-ready` on the wrapper, and the credit is behind the "i" button from the first frame anybody sees. The contact's mini map also waits 250 ms for the pin to hold still before it builds anything, so stepping down the list with the arrow keys no longer builds and throws away a WebGL canvas, a parsed style and a set of tiles for every person passed. The frame holds one still panel until the map reports that it has loaded, and the map fades up through it, so the empty canvas and the tiles painting in are never on screen. The panel no longer pulses.
- **The start panel.** The pane beside the list when nobody is open holds the mark and the words "No contact selected", and nothing else. The line under it telling a reader to pick somebody from the list was saying what an empty pane beside a list of people already says.
- **The corvid on its perch.** The mark at the top of the sidebar is 40 px, against the 24 px of the navigation glyphs below it, because it is the brand and not another stop. Its button keeps the 56 px box it had: the padding pays for the size.
- **The switch.** One `Switch` for every on/off setting, including the five hand-rolled copies in the admin pages. The track is 44 by 24 px and is the button itself, with a 44 px tap box from `hit-area` instead of a square of its own, so it lines up with the other controls on a row's right edge. Off, it is the highest container tone inside a hairline with a 16 px knob in the variant text colour, which the old card-coloured knob was not in the dark palette. On, it is the accent with a 20 px knob and a check inside it, so the state is told by the knob's side, its colour and the glyph. A press swells the knob a little.
- **A setting off its default.** A preference that is not at its default no longer adds a "Changed from the default · Reset" line under its description. The row shows a 6 px accent dot after the title, named "Changed from the default" for a screen reader and a pointer, and a quiet "Reset" text button with a rotate glyph at the start of the control cluster, so the control keeps its place on the row's right edge. `BTN_QUIET` and `CHANGED_MARK` in `src/lib/styles.ts` are the pair, and `.agent/STYLE.md` says they are the only way to show a value off its default.
- **A tighter shape for the whole app.** One radius scale replaces the old tokens that made `rounded-xl` 32 px and `rounded-lg` 24 px: a control is now 6 px, a card 8 px, a dialog 12 px and a chip 4 px, and every `rounded-*` call site follows without a change. Chips, badges, filter pills and the `Segmented` options are `rounded-md` instead of pills. Circles stay for avatars, dots, rings and switch tracks. `.btn-primary` and `.btn-secondary` are 6 px, and the map's zoom group and popup are 8 px. The rules are in `.agent/STYLE.md` under "Radius System".
- **One dropdown, everywhere.** Every list that opens under a control now paints the same solid `.menu-panel` surface (the card colour, a hairline ring, a soft shadow, a 120 ms entrance from the anchoring edge) with the same rows (`MENU_ITEM` and its friends in `src/lib/styles.ts`). The sort menu on the Network page used to be glass over the contact list, and rows showed through its items. A new `Select` component (`src/components/ui/Select.tsx`) replaces the native `<select>`: a `role="combobox"` button that opens a `role="listbox"` panel with the arrow keys, Home and End, type-ahead, Enter, Escape and a click outside, in three forms (a field, the small uppercase label chip on a contact's email or phone, and a ghost trigger for a toolbar), with optional icons, descriptions and groups. The label chips on the contact page, the model picker in AI settings, the "Kind of note" filter in note search and the field picker in the bulk edit dialog use it. `ActionMenu` gained `hint` on an item and a `heading`, slides in from the window's edge when the trigger is closer to that edge than the menu is wide, and scrolls past about ten items. The context menu, the combobox, the snooze menus on Pulse, the map's "Select contacts" and saved views menus, the "Add to a list" menu, the users' row menu, the account panel, the mention list in the composer, the facet suggestions in the command palette and the score breakdown popover all sit on the same panel. The `nice-scrollbar` class, referenced by a dozen scrollers and never defined, now draws a thin bar in the palette's hairline colour.
- **The Network header.** Select, Import and New are icon buttons at every width (an empty square, an upload arrow and a plus), each with an accessible name, a tooltip and a 44 px tap box. "+ New ▾" is now "+". Selection mode keeps the page's title and shows "Select all" and "Done" in the header, and the count, "N selected", leads the bulk bar.
- **The contact list.** The list's scrollbar sits on the left edge, away from the letter rail on the right, so the two no longer share a strip. With the rail on screen the rows stop 2 rem short of the right edge, and the current row is a light tint instead of a 2 px ring with a shadow.
- **The start panel.** The pane beside the list when no contact is open shows the Corvid mark at 144 px, "No contact selected" and one line. The "Up next", "Recently viewed" and "Add people" cards are gone: Pulse is the dashboard.
- **The contact page.** The wide header no longer has a "Log interaction" button, because the composer is the first thing in the Timeline column. Under Location, the address rows come first, then the mini map and its "Open in map" and "Adjust pin" caption, then "+ Add". The About card in the Dossier lost its coloured left bar and its uppercase "Show more": it is a plain card with a neutral heading, a readable measure and a sentence-case text button.

### Removed

- **The map's Health layer.** The layer switch is Pins and Heat. The health ring on a pin, its legend and the red at risk arc around a cluster are gone: a cluster is a count, named "12 contacts, zoom in". A stored `mapLayer` of `"health"`, a saved view with it and an old `?layer=health` link open on Pins: the server reads `"health"` as `"pins"`, in the preference and in `POST /api/map/views`.
- **Code nothing used.** `useAdminUser`, `useSetSearxng`, `fetchSessionPolicy` and `updateSessionPolicy` in `src/api`, the `SettingsView.tsx` re-export, three window events for modals that nothing dispatched (`OPEN_IMPORT_EVENT`, `OPEN_NEW_CONTACT_EVENT`, `OPEN_SMART_PASTE_EVENT`) and the Network list's listener for them, a second bulk edit handler in the Network list, `IconButton`'s `primary` tone, `AISettingsView`'s `embedded` prop, and the swipe overlays' four hand-written gradients, which are the success and error tokens now. Pulse lost the `CardFrame` props `id`, `badge` and `className`, five `UpNextItem` fields and two birthday fields that nothing read, and `MetricCard`'s `onClick`. The map points carry no score, at risk or overdue value.
- **Mapbox geocoding.** Nominatim is the one geocoder now. The map already drew with MapLibre and OpenFreeMap tiles, so Mapbox was left only as an optional geocoder. `MAPBOX_API_KEY` is no longer read, the Mapbox key field leaves the Integrations section of Settings > Administration > General, and `GET /api/admin/integrations` no longer returns a `mapbox` field. `PUT /api/admin/integrations` answers `400` to a body that sends only `mapboxKey`, and ignores that field beside another one. A key stored earlier is deleted from `app_settings` on the next start, so it no longer rides along in backups. The map's React binding is `@vis.gl/react-maplibre`, the MapLibre half that `react-map-gl` re-exported, so `react-map-gl` and its `@vis.gl/react-mapbox` leave the dependencies.
- **`GET /api/dashboard/momentum`, and the Momentum card.** Rising and cooling moved onto the dashboard payload under `tracking`, three each instead of five. The Silent column was Catch up under another name, restricted to people whose score was still above 40, and it is gone. Three numbers nobody read leave `metrics`: `atRiskCount`, `avgDaysSinceInteraction` and `totalInteractions30d`. The `atRisk` list leaves the payload, replaced by `catchUp`. Four files nothing mounted are deleted: `DailyInsightCard.tsx`, `DashboardSkeleton.tsx`, `ActionItemSwimlane.tsx` and `InteractionVelocityModal.tsx`. A stored Pulse layout that names `momentum` drops it and shows Keeping up in its default place.
- **The cadence in the bulk Field dialog.** "Cadence (days)" was a bare number nobody could see anywhere else. The cadence is set when a contact is tracked and changed from the chip on its page, or in bulk from the Tracked contacts page.
- **Two files nothing imported.** `src/components/HealthRingAvatar.tsx` was the old name of `ScoreRingAvatar`, kept as an alias for one release, and the release has passed. `src/views/pulse/NetworkHealthPanel.tsx` was a panel no page ever mounted.

### Added

- **The corvid elsewhere.** The bird now shows up where it means something. `CorvidThinking` replaces three different spinners with one 20 pixel glyph that tilts its head while AI works: the synthesis bar in Ask Contrack, the refresh badge while a contact enriches, and the briefing card while it writes. It names itself "Thinking" where the surface has no words of its own, and stays out of the accessibility tree where a sentence beside it already says so. Pulse sends the bird on a two second swoop across the top of the page under the confetti when the last follow-up clears. The Duplicates queue's "All reviewed" state shows the mark at 96 pixels with one hop as it arrives. The sign in card's mark blinks, and shakes its head for 200 milliseconds when the password was wrong, once per message and for no other error. A phone has no sidebar, so a 20 pixel perch sits at the end of the Settings footer line and flies the same flight. Every one of these reads one rule, `useCorvidLevel()`, so Off, Subtle, the Motion row and the operating system's reduced motion setting each reach all of them.
- **The corvid flies.** The mark on top of the sidebar is now a button named "Contrack". A click, Enter or Space sends the bird off its perch on one 4.5 second lap of the window and back, and it blinks every four to nine seconds while it sits there, with one beat in five a two degree head tilt instead. A new account preference, `mascotMotion`, offers Full, Subtle and Off in a "Corvid motion" row on Settings > Appearance, directly under Motion. Subtle keeps the blinks and the hop and drops the flights. Reduced motion always wins: the row says so when the operating system asks for less motion or the Motion row above it is set to Reduced, and the bird holds still whatever the choice. The flight is one overlay mounted beside the toasts, `aria-hidden` and `pointer-events-none` on a layer below every dialog, panel and menu, so the bird can never cover or swallow a click. Escape lands it at once, a second click brings it straight home, and changing page cancels it. A browser without `offset-path` plays the hop instead. The idle timer never runs while the tab is in the background and never starts for a mark under 24 pixels. The new sidebar stop raises the keyboard Tab budgets by one on the Network and contact pages.
- **Mobile responsiveness for Duplicates, Ask Contrack, and Import.** Streamlined phone layouts and workflows across core tool views. In Duplicates (`/settings/duplicates`), introduced a full-width Segmented control ("Auto scan" and "Manual merge" in sentence case) with unclipped labels at 390 px viewports. Below 640 px, moved Merge activity into the page header action menu to keep the title row uncluttered. Positioned scan mode radio buttons and manual merge checkboxes on the left beside icons, titles, and avatars, and centered cards and result lists within a 48 rem (max-w-3xl) container. In Ask Contrack (`/search`), enhanced the landing empty state when semantic indexing coverage is under 100 percent to display the full SearchCoverageBar alongside a sentence explaining what indexing does, while keeping the compact indicator in the header. In Import (`/settings/import`), restructured the panel so the file drop zone appears first, placed export walkthrough instructions in a collapsible disclosure underneath, and persisted the last chosen import source in browser storage (`contrack.import.lastSource`) with graceful error fallbacks. Verified responsive landing layout in Settings with no back control on mobile. Added dedicated unit tests and Playwright journeys on a 390 px phone project.
- **Map layers and saved views.** Added layer switching and saved views to Map View (`/map`). Users can switch between Pins, Heat, and Health layers via the segmented control or `?layer=` URL parameter, persisting to the `mapLayer` account preference. Heat layer renders a weighted heatmap based on contact interaction count, hiding pins above zoom level 9. Health layer tints pin rings according to relationship health score bands (Strong, Fading, At risk) and displays an accessible legend chip in the bottom-right corner. Introduced multi-tenant `map_views` table with bounds validation, 100-view ceiling (`TOO_MANY_VIEWS`), CRUD endpoints at `/api/map/views`, and full tenancy isolation. Saved views menu enables saving current viewport bounds, active filter query, and layer, with in-place rename and delete modals. Selecting a saved view restores camera bounds, filters, and layer with `?view=<id>` in the URL, prioritizing saved views over remembered camera state on load.
- **Network header, sort menu, and desktop start panel.** Redesigned the Network list header and replaced the empty desktop pane with an actionable start panel. The Network header features explicit "Select", "Import", and "+ New ▾" buttons with visible text from medium screens and 44 px labelled icon buttons on phones. "+ New" uses ActionMenu with options for New contact, Add from text (smart paste), and New list. Selection mode displays the selected count with "Select all" and "Done" alongside the floating BulkActionToolbar. Long pressing any contact row on touch devices enters selection mode. Sorting uses an ActionMenu whose button label reflects the active sort choice, offering five choices (Name A to Z, Name Z to A, Newest first, Oldest first, Score) with checkmark indicator, initialized from the `listSort` preference and persistent across the session. The list filter row renders only when lists exist, eliminating empty pill states. Replaced the empty right pane with `StartPanel`, featuring the Corvid mark and three labelled landmark regions ("Up next" showing top 3 Pulse follow-ups with `ActionRow`, "Recently viewed" with `ScoreRingAvatar`, and "Add people" quick action cards), each with an accessible empty state. Preserved the keyboard Tab budget on network and contact pages.
- **Mailbox (IMAP), Google Workspace, and correspondents review.** Added email and Google Workspace synchronization to the connectors system. Implemented streaming Mailbox (IMAP) adapter (`imapflow` and `mailparser`) supporting TLS/SSL port 993, app passwords, folder monitoring (INBOX, Sent), UID-based incremental syncing, address alias matching, and daily email roll-ups per contact. Implemented Google Workspace adapter (`googleapis`) syncing Google People contacts, Gmail headers/threads, and Google Calendar events via OAuth 2.0 with instance credential configuration, state verification, and refresh token rotation. Added opt-in AI thread summaries (`connectorSummary` task) with prompt injection shielding (`wrapUntrusted`) and a strict 50-item cap per run. Added unconfirmed correspondents review view (`/settings/connectors/people`) with one-click contact creation and sender ignoring (`POST /api/connectors/correspondents/ignore`). Added instance Google OAuth configuration to administration settings (`/settings/admin/general#integrations`) with secret masking and copyable callback URI.
- **Map selection, bulk actions, and hover card.** Added multi-selection and bulk workflow capabilities to Map View (`/map`). Supports box selection via Shift+drag and freehand lasso selection via `L` key or toolbar menu, backed by ray-casting in `mapMath.ts`. Selection operates on actual contacts rather than rendered tiles so contacts inside clusters are properly included. Displays a secondary selection bar with "Add follow-up", "Zoom to selection", and clear controls above the shared `BulkActionToolbar` (archive, delete with undo toast, add to list, field editing, color tagging, and CSV export via `useBulkActions` and `BulkModals`). Introduced `FollowUpModal` with date presets (Tomorrow, 3 days, Next week, custom date picker) creating action items with a 100-contact safety cap. Upgraded cluster badges to show selection proportions (for example, "3 of 12 selected") via an asynchronous leaves cache. Replaced the legacy map popup with `MapHoverCard` featuring a 150 ms tooltip mode on hover or focus and a pinned dialog mode on click or Space with four quick actions (Open, Log note via `QuickInteractionModal`, Add to list, Follow-up), 44 px avatar with score ring, relationship breakdown popover, last contact distance, local time via coordinate lookup, and tags. Added keyboard shortcuts `L` (lasso), `Escape` (clear selection or close card), and `Space` (pin hover card).
- **Connectors framework and Calendar adapter.** Implemented background data connector framework and an iCalendar (ICS) adapter powered by `node-ical`. Features multi-tenant database tables (`connectors`, `connector_runs`, `connector_links`, `upcoming_events`, `oauth_states`), automatic secret sealing via `secretBox`, 60-second polling scheduler with per-owner concurrency controls, and SSRF prevention with private IP checks. Includes meeting/event matching against existing contacts, automatic ghost contact generation at configurable interaction thresholds, and future event sync to `upcoming_events` for Pulse. Added Settings UI at `/settings/connectors` featuring connector cards, manual sync triggers, pause/resume, run history drawer, delete confirmation with imported-data cleanup options, and "via Calendar" timeline source badges.
- **Map stats and insights pane.** Added live viewport analytics, aggregate metrics strip, and an interactive insights drawer to Map View (`/map`). Calculates debounced (150ms) bounding-box stats across contacts currently in view, reporting in-view counts, at-risk and overdue contacts, average health score, time zones, and top rankings for industries, companies, and tags. Introduced `StatsStrip` floating at the bottom left with interactive summary chips that filter on click (e.g. `score:<40`), live status announcements (`role="status"`), and empty state with Fit all. Introduced `MapInsightsPane` as a 320px desktop sidebar and mobile bottom sheet with "Stats" and "People" tabs, supporting keyboard shortcut `i` to toggle, `mapPaneOpen` account preference persistence, virtualized contact browsing via `@tanstack/react-virtual`, and instant fly-to navigation on contact row click. Enhanced cluster markers with an SVG ring badge displaying a proportional red arc for at-risk contacts and updated accessible name (`"${count} contacts, ${atRisk} at risk, zoom in"`). Automatically shifts desktop MapLibre controls when the insights pane is open to avoid control overlap.

- **MCP server.** Implemented in-process Model Context Protocol (MCP) server running Streamable HTTP transport at `POST /api/mcp` (with `405 Method Not Allowed` on `GET` and `DELETE`), powered by `@modelcontextprotocol/sdk`. Exposes 15 tools across contact management, search, timeline logging, action items, pulse metrics, and list management, with multi-tenant isolation, 120/min rate limiting, and operational error code mapping. Registers resources `contrack://pulse` and `contrack://contacts/{id}`, along with prompts `catch_me_up` and `weekly_review`. Added the MCP settings page at `/settings/mcp` with endpoint URL copying, ephemeral token input for host configuration snippets (Claude Code, Claude Desktop, Cursor, curl), and a dynamic tools table.

- **Map filters and place search.** Added real-time facet filtering and place search navigation to Map View (`/map`). Shares the slim contacts dataset with the contact list via TanStack Query client cache, eliminating duplicate fetches. Supports `list:<name|id>` and `near:<place>/<km>` facets alongside standard search facets (`company:`, `role:`, `location:`, `industry:`, `tag:`, `score:`, `updated:`, `missing:`) with instant autocomplete for `list:` and `tag:`. `near:` resolves geospatial coordinates on Enter through a guarded server endpoint `GET /api/geo/search` backed by the existing geocode cache and Nominatim with account rate limiting (30 requests/min). Free text uses the shared `scoreContactMatch` ranking. Introduced `MapToolbar` with a desktop glass panel, interactive facet pills with resolving and error states, "Go to" place navigation (`flyTo` zoom 10 or `jumpTo` under reduced motion), "Fit all" button (`F` shortcut), `/` shortcut to focus search, responsive mobile sheet below `lg`, and empty state handling with one-click filter clearing.
- **Pulse layout customization and controls.** Added customize mode to the three-column Pulse office layout with drag-and-drop column reordering, keyboard navigation, and mobile reorder controls. Users can enter customize mode via the header button or the "C" keyboard shortcut. Each card can be reordered within or across columns via draggable handles or ActionMenu choices ("Move to Focus", "Move to Network", "Move to Intelligence"), or hidden into a dedicated hidden cards tray. Mobile viewports provide 44px accessible Up and Down buttons. Includes reset layout functionality, live aria announcements for layout operations, local preference persistence, and a complete documentation refresh.
- **Profile pictures for accounts (server).** Added `users.avatarUrl` column and endpoints `POST /api/auth/me/avatar` and `DELETE /api/auth/me/avatar` for managing account profile photos. Normalises uploaded photos via sharp (512 px cover JPEG at quality 82 with EXIF rotation and stripped metadata) stored under `uploads/u/<userId>/profile/`. Updated `guardUploads` so any authenticated user on the instance can view profile photos while keeping contact avatars and private files owner-only. Unlinks previous photos on replacement or removal and purges profile folders on account deletion. Note that database backups snapshot the database only, so a restore keeps `avatarUrl` while losing upload files, falling back to initials.
- **Profile pictures for accounts in Settings and UI.** Added PhotoCard to Settings > Account allowing signed-in users to preview, upload, and remove custom account profile photos. Introduced the reusable AccountPhotoField component featuring a 96px circular preview, dropzone file selection with 10 MB limit and inline error messages, and object URL lifecycle cleanup. Updated AccountAvatar to render the custom avatar across the desktop sidebar footer, mobile identity header, and administration user lists, with automatic fallback to monogram initials on image loading error. Note that backups snapshot the database only and do not contain uploads, so restoring an instance from backup falls back to monogram initials until a new photo is uploaded.
- **Profile pictures during account creation.** Users can now pick an optional profile picture when setting up an instance, registering a new account, or accepting an invitation. The AccountFields component renders AccountPhotoField above "Your name" with an explanation caption. The account creation flow uses createAccountThenPhoto to create the account first and upload the photo immediately afterwards, ensuring that any photo processing failure never blocks account creation or sign-in.
- **Harden account profile pictures for performance, stability, and accessibility.** Hardened the avatar upload and deletion lifecycle with database-first atomic updates and asynchronous non-blocking file unlinking, preventing race conditions, stale files, or blocking the event loop on missing disk paths. Replaced synchronous disk stats in avatar processing with sharp output metrics. Fixed PhotoCard in Settings to prevent accidental remote avatar deletion when cancelling a staged local file selection. Enhanced AccountPhotoField accessibility with aria-describedby for inline validation errors and focus restoration to the Choose photo button on removal. In AccountAvatar, dynamically reset error fallback when avatarUrl updates. Added integration and unit tests for concurrent uploads, out-of-band file deletion, and focus management.

- **Pulse charts.** Replaced the temporary MetricCard stopgap in Pulse's Network column with three SVG visualizations. ActivityCard renders a twelve-week activity heatmap with quantile scaling, cell titles, today outline, accessible weekly totals, 40 px sparkline with monthly comparisons, streak counter, and interaction type breakdown pills. MomentumCard surfaces rising, cooling, and silent contacts with score delta chips, row links to contact profiles, and a four-week baseline notice. CompositionCard provides an interactive SVG donut chart with dimension switching for Industry, Role, and Location, legend filter pills linking to facet search queries, and modal deep dives. Includes contrast unit tests ensuring WCAG AA non-text contrast across both light and dark palettes.
- **Instance settings over environment.** Administrators can now configure trash
  retention, backup schedule frequency and keep count, and SearXNG search URL
  directly in the revamped General settings view (`/settings/admin/general`).
  Settings follow a setting over env over default resolution order. When an
  environment variable (`TRASH_RETENTION_DAYS`, `BACKUP_INTERVAL_HOURS`,
  `BACKUP_KEEP`, or `SEARXNG_URL`) is defined, the setting is locked in the UI as
  read-only with source attribution, and update attempts return 409
  `SET_BY_ENVIRONMENT`. The backup scheduler dynamically reschedules its timer on
  interval changes, and the Trash view dynamically displays server-configured
  retention windows.

- **Sign-in front door enhancements.** Streamlined account creation and
  authentication with revealable password fields, Caps Lock detection hints,
  automatic username suggestions, and a visual password strength meter. Setup,
  registration, and invitation acceptance now require only a single password
  input with an accessible 44px reveal toggle ("Show password" / "Hide password")
  and inline "Caps Lock is on" alert. Choosing a password presents a non-blocking
  four-segment strength meter (Short, OK, Good, Strong) evaluating character
  classes, length, and a 40-word common password blacklist. Sign-in introduces
  "Keep me signed in on this device" (default true), where unchecking caps the
  session at `min(policy, 1 day)` with a session-only cookie omitting `Max-Age`.
  Successful sign-ins persist the username in `localStorage`
  (`contrack.lastIdentifier`) to automatically prefill returning visits, focus
  the password field, and display a "Not you?" button to clear the stored account.

- **Password reset and magic-link sign-in.** Self-service password reset and
  passwordless magic-link sign-in backed by single-use hashed auth link tokens.
  Users can request a 1-hour password reset link from the sign-in screen when
  outgoing mail is configured, or view clear operator guidance when mail is off.
  Administrators can email a 24-hour reset link or generate a temporary password
  from the Accounts administration dialog. When enabled by an administrator under
  Instance settings, users can request a 15-minute magic link to sign in
  passwordlessly. Includes the operator recovery CLI script
  `npm run reset-password <username>` (`scripts/reset-password.ts`), hourly
  creation limits per account, 30-day retention cleanup, session method tracking
  (`method: "email-link"`), and audit logging for resets and magic-link logins.

- **Outgoing mail and email invitations.** Administrators can configure
  outgoing SMTP mail either declaratively via `SMTP_URL` and `MAIL_FROM`
  environment variables or interactively through the Outgoing mail administration
  view at `/settings/admin/mail`. Database-stored SMTP passwords are encrypted
  with AES-256-GCM using `secretBox` backed by `CONTRACK_SECRET_KEY` or an
  auto-generated `DATA_DIR/secret.key`. The invitation creation flow now includes
  an option to send invitations directly by email when mail is configured,
  reporting delivery status back to the administrator. Includes a rate-limited
  test email endpoint (`POST /api/admin/mail/test`), read and update endpoints
  (`/api/admin/mail`), and full audit logging for configuration updates and test
  dispatches.
- **The data behind Pulse.** Added `score_snapshots` table with weekly relationship score snapshots, retention pruning at 26 weeks, and weekly sweep tracking. Added deterministic activity aggregates (`GET /api/dashboard/activity`) with 84-day rolling activity, weekly totals, streak tracking, and daily task counts. Added relationship score momentum (`GET /api/dashboard/momentum`) with rising, cooling, and silent contact detection. Added data hygiene metrics (`missingCompany`, `missingLocation`, `missingEmail`, `stale`), upcoming meetings, and correspondent counts to `GET /api/dashboard`. Added `missing:` search facet (`company`, `location`, `email`, `phone`) and birthday normalization utilities. Added `pulseLayout` user preference with column orders and card visibility controls.
- **Passkeys (FIDO2 / WebAuthn).** Accounts can now register biometric
  passkeys (Touch ID, Face ID, Windows Hello, security keys) to sign in
  without typing a password. Includes a first-run nudge interstitial after
  setup or account creation, inline WebAuthn registration and verification,
  browser autofill (conditional UI) on the sign-in form with an abort controller
  handoff for Chrome, and a dedicated "Sign in with a passkey" button. Account
  settings gains a "Sign-in methods" section to inspect and manage passkeys, with
  inline renaming, a removal confirmation dialog, and a device icon naming the
  browser or operating system. Active sessions now track their authentication
  method (`method: "password"` or `method: "passkey"`), displayed under
  Devices in Account settings. Reverse proxies can configure `PUBLIC_URL` to
  ensure consistent rpID and origin derivation during WebAuthn ceremonies.
- **Ask Contrack history pane.** The Ask Contrack search view now includes a
  history pane displaying past search questions organized into Pinned, Today,
  Yesterday, This week, and monthly buckets. Features a 320px desktop aside,
  a mobile bottom sheet modal triggered from the header's History button, the `h`
  keyboard shortcut for quick toggling, one-click search re-running, row pinning,
  deletion with undo toasts, live query filtering, and a confirmation dialog
  for clearing history. Account preference `askHistoryOpen` persists the pane
  visibility across sessions.
- **Search history table and API.** The server now stores every question asked
  per account across People, Notes and palette modes in a dedicated
  `search_history` table. Distinct queries per mode are deduplicated by
  normalised text, with automatic run counting, last run timestamps, pinned
  flags, and result snapshots. Five new scoped and isolated routes under
  `/api/search/history` support listing with cursor pagination, recording,
  pinning, individual deletion, and clearing history by mode or entirely.
  Legacy search history from user preferences is automatically backfilled on the
  first request for an account with no history rows.
- **Search history management in Settings.** Settings > Privacy and AI now
  includes a "Search history" row (`#search-history`) displaying the total
  number of recorded questions and a "Clear history" action with confirmation
  dialog. The row is searchable via the settings registry with keywords
  `history`, `recent`, and `searches`.

- **Settings revamp: registry, two-pane shell, and row search.** Settings is now
  driven by a declarative registry (`src/views/settings/registry.ts`). On wide
  screens (1024px and wider), settings renders as a two-pane shell with a 240px
  rail on the left and the active page on the right. On phones, it retains the
  single-pane list with instant back navigation. Live row search searches titles,
  descriptions, and keywords across all pages with keyboard navigation and hash
  links. Individual setting rows flash and focus on navigation, display a dot
  indicator when modified, and provide a reset button. Old settings URLs redirect
  to their new paths. `DELETE /api/auth/preferences/:key` allows resetting
  preferences to defaults.
- **Personal preferences and dedicated settings pages.** Added 9 personal
  preferences (`startPage`, `listSort`, `defaultCadenceDays`, `weekStart`,
  `showWeather`, `textScale`, `motion`, `singleKeyShortcuts`, and `aiAssist`)
  with persistent account-level storage. Added four dedicated settings pages:
  Appearance (theme, accent, text scale, motion, list density), Network and
  contacts (default start page, default sort order, recent contacts limit,
  default cadence, week start, weather forecast toggle, temperature unit),
  Keyboard shortcuts (toggle switch for single-key shortcuts and complete
  reference table), and Privacy and AI (account-level AI toggle, data privacy
  transparency cards, and links to AI usage). Turning off AI for an account
  disables generative AI endpoints with 403 AI_OFF_FOR_ACCOUNT and suppresses
  client AI action buttons while preserving fast local search and retrieval.
- **Tools and data settings: Import, Tags, Duplicates, and Contact enrichment.**
  Settings gains dedicated tools and data management pages and live count badges.
  A Needs attention banner on the Settings landing page displays up to three
  action items for pending duplicates, un-enriched contacts, and failed imports.
  The Settings rail reflects live counts on Duplicates, Tags, Enrichment, and
  Import pages. Added a dedicated Import page (`/settings/import`) with an inline
  workbench, recent imports history table, and failed row retries. Added a
  dedicated Tags page (`/settings/tags`) with contact counts, alphabetical
  browsing, inline tag renaming, merge tag modal, and bulk deletion. Added
  automatic duplicate check preferences (`dedupeOnCreate`, `dedupeOnImport`) and
  an active duplicate count strip on the Duplicates page. Added a never-enriched
  contact banner, one-click preselection for batch enrichment, automatic contact
  enrichment preference (`autoEnrich`), and live grounding meter on the Contact
  enrichment page. Added backend endpoints for listing imports (`GET /api/imports`),
  summarizing tags (`GET /api/tags/summary`), renaming tags (`PATCH /api/tags/:tag`),
  and deleting tags (`DELETE /api/tags/:tag`).
- **The corvid, everywhere.** One drawing of the raven, traced by hand from
  `docs/brand/corvid-source.jpg` into `src/assets/corvidPaths.ts`, is now the
  mark. It replaces the gradient "C" in the tab strip, the PWA and Apple
  icons, the rotated word in the sidebar, the icon square on the sign-in
  card, the empty Network, Trash and Archived screens, the "No Contact
  Selected" pane, the crash screen's footer and the README header.
  `npm run brand:icons` renders every icon in `public/` from that one file,
  adds a maskable icon for Android launchers and a 1200 by 630 link preview,
  and a unit test fails when the committed favicon and the drawing disagree.
  In the app the mark strokes with `currentColor`, so it follows the accent
  a person chose, and its eye keeps the new `--color-corvid-eye` token. The
  icon links carry `?v=corvid` so a browser that pinned the old favicon
  fetches the new one, and the manifest's theme colour is the current
  primary, `#006a91`. The mark is decoration in this phase: it is hidden from
  assistive tech and takes no Tab stop. See `.agent/STYLE.md` section 6.
- **A map that opens where you left it, and knows what covers it.** The map
  page keeps its MapLibre map alive between visits and writes its view to
  `localStorage` when a move ends, so a return to the map, and a reload,
  open on the same spot at once. The map's code is warmed in an idle moment
  on whichever page opens first, unless the browser asks to save data, and
  the build now keeps MapLibre out of every other page: React and Vite's
  preload helper had been folded into the map's chunk, and every page
  preloaded a megabyte of MapLibre to get them. The open contact and the
  phone's tab bar are measured as covers and passed to MapLibre as padding,
  so a contact opens beside its pin instead of over it, and a pin on a phone
  settles above the bar. The hover card stacks above every pin and opens on
  the side with room, and it does not open for a touch. The attribution
  opens collapsed. The map no longer rotates by touch or by key.
- **A pin you can move by hand, and a basemap you can host yourself.**
  "Adjust pin" under the map on a contact opens a dialog with that person's
  pin on an interactive map. Drag it, click the map, or nudge it with the
  arrow keys, and Save. The new `PATCH /api/contacts/:id/location` route
  writes the coordinates and marks the row `geoSource = 'manual'`, and the
  geocoder leaves it alone from then on: its write skips a manual row, the
  startup sweep leaves the row out, and an edit to the contact asks the
  geocoder again only when it changes the address the pin stands for. "Use
  address again" hands the pin back. A pin a person placed shows "Placed by
  hand" with an InfoTip, and `GET /api/contacts/map` now says who placed each
  pin. "Set location" opens the same dialog for a contact the geocoder could
  not place. The `pmtiles://` protocol, registered since the MapLibre swap,
  now has its worked example: `docs/features/map-view.md` shows a style under
  `public/map/` that reads one `.pmtiles` archive from this origin, and the
  `MAP_STYLE_*` override that points the map at it, with no request leaving
  the instance.
- **A map on the contact page, and the map page opens on the person you
  asked for.** A placed contact shows a 160 px still map of where they are,
  under their addresses, with their pin on it. "Open in map" and a "Show on
  map" link beside each address both lead to `/map/contact/<id>`, and the map
  page now flies to that contact over 800 ms and stops at zoom 11, or stays
  closer if it already was. A reader who asked their system for less motion
  gets the same view without the animation. A contact with an address the
  geocoder has not placed reads "Not on the map yet" and loads no map at all.
  The mini map is a region named "Location map", so the two maps on
  `/map/contact/<id>` stay two landmarks a reader can tell apart, and its
  picture stands down there because the map behind the panel already holds
  the pin.
  See `docs/features/map-view.md`.
- **Two floors: 44 px targets and 11 px text.** Every control a finger can
  reach now has a tap box of at least 44 by 44 pixels on a phone, and no text
  is smaller than 11 pixels. The new `hit-area` utility grows a small control's
  tap box without changing how it looks. The phone tab bar labels, the label
  and badge tokens, the shortcut chips and 138 other lines moved from 9 or 10
  pixels to 11. `tests/unit/styles.floor.test.ts` fails on `text-[9px]` and
  `text-[10px]`, and `tests/e2e/metrics.spec.ts` measures both floors on a
  390 pixel phone on Network, a contact, Pulse, Ask Contrack and Settings.
- **One empty state.** `src/components/ui/EmptyState.tsx` draws every empty
  screen the same way: a 48 px icon tile, a title, one sentence and at most
  one action. Network, Pulse, Possible duplicates, Trash, Lists, Ask Contrack,
  Contact enrichment and AI usage use it, with new copy that says what to do
  next. Its `illustration` slot is where the corvid mark goes.
- **A colour for AI-derived data.** `--color-ai` marks what a model wrote: the
  interests and tags an enrichment run added and the note glyph on the
  timeline. It is defined in both palettes, clears WCAG AA on every surface,
  and does not follow a contact's colour. The composer's selected type no
  longer uses it.

- **The contact list is one Tab stop.** Up and Down move through the list,
  Home and End jump to the ends, a letter jumps to the next name that starts
  with it, and Enter opens the contact. The letter rail is one stop too, with
  the arrow keys inside it, and it draws only the letters that have contacts.
  From the top of a contact page the contact's name is now at most 16 Tab
  presses away. It was 42. `keyboard.spec.ts` holds that budget.
- **Focus follows navigation.** Opening a contact puts focus on its name, and
  Back on a phone puts focus on the row it was opened from. The skip link
  follows the route: the contact's name on a contact page, the list on the
  Network page.
- **Landmarks and headings on every route.** Each route renders inside a
  named `main`. On a wide screen the list is a "Contacts" landmark beside the
  contact. On a phone the list is the main. Network, a contact and the map
  each have an `h1`, and the contact's name is that `h1`. The axe suite now
  checks `landmark-one-main`, `page-has-heading-one`, `region` and
  `heading-order` on six screens, and on a phone for the list and a contact.
- **One name per destination.** `src/lib/names.ts` holds the names, and the
  sidebar, the tab bar, the command palette, the shortcuts dialog and the
  document titles read them. "Relationship Pulse" is now "Pulse". "AI Search"
  and "Ask AI" are now "Ask Contrack". "Network Dedupe Engine" is now
  "Duplicates". The batch research page is "Contact enrichment", and its button
  says "Start enrichment".
- **A shortcut registry.** `src/lib/shortcuts.ts` lists every shortcut with
  its group, keys, description and a `bareLetter` flag. The shortcuts dialog
  renders from it, and a unit test fails when two shortcuts in one group
  claim the same keys. The dialog now lists the contact list's keys.

- **Browser accessibility checks in CI.** A `browser-a11y` job builds the
  production bundle, boots it the way a release runs, and drives it in
  headless Chromium with Playwright: axe scans of every screen against WCAG
  2.2 AA in both palettes, and journeys for the keyboard, dialogs, search
  announcements, forms on a phone, and the account transitions on a gated
  instance. Each worker boots its own server on a throwaway data directory.
  `npm run test:e2e` runs it locally. See `docs/accessibility.md`, which
  also carries the manual keyboard and screen-reader pass that supplements
  the automated one.
- **The search page announces itself.** One polite status region says that
  a search started and what it found, for People and for Notes, and a failed
  search is an alert. Results restored on the way back to the page are not
  read again.
- **A skip link.** The first Tab stop on every page is "Skip to main
  content", which moves focus past the sidebar or the tab bar.

### Fixed

- **A fast second arrow key in the Network list was lost.** The list's keydown listener was attached again in an effect after every change, and an effect runs after the browser paints. A second ArrowDown pressed in between ran the old listener, which still had no open contact, so it reopened the first row. The listener is attached once now and reads the latest values from a ref written in the commit.
- **A link's platform came from anywhere in its text.** `detectPlatformFromUrl` matched `includes("x.com")`, so dropbox.com and netflix.com were saved as Twitter, and a LinkedIn address in a query string made any link LinkedIn. It reads the host now, the domain or a subdomain of it, and knows YouTube.
- **Clearing a note search left its notes on screen.** The search kept the last answer while the next one loaded (`keepPreviousData`), and a cleared search asks nothing, so the old answer stayed for good. An empty search now holds no answer, and Clear and Escape empty the notes with the words and the filters.
- **A note search recorded the answer to the question before it.** The history entry was written when the query reported success, and a new question reports the previous answer while its own loads. It is now written once, from the question's own answer.
- **The arrow keys in radio groups.** Twelve groups built from buttons with the radio role did nothing with the arrow keys: nine in Settings (the session length, trash and backup presets, an invitation's role and expiry, a token's expiry, an account's role and the password reset) and the primary contact in the duplicate review's three views. In the General presets only the chosen option was a Tab stop, so a keyboard could not pick another one at all, and a stored value that matched no preset left the group with no Tab stop. `radioKeys` and `radioTabIndex` in `src/lib/a11y.ts` give each group one Tab stop and the arrows, as `Segmented` and `AccentPicker` already had.
- **The switch's knob slides again.** It transitioned `transform`, and Tailwind's translate utilities set the separate `translate` property, so the knob jumped from side to side.
- **Two rows lit in a menu.** A menu opened by a click focused its first row, and the pointer tinted another, so the New menu and every kebab showed two current rows. The row under the pointer now takes focus, as in the system's own menus (`focusOnPointer` in `src/lib/a11y.ts`), in the action menus, the selects and the map's saved views.
- **Closing Add from text opened the New contact form.** The dialog's close and its success shared one callback, so the X, Escape and the overlay all opened the form. Closing now only closes and gives focus back to the control that opened the dialog, a successful extraction opens the form filled in, and a result that arrives after the dialog closed is dropped.
- **The AI summary on Ask Contrack could not see industries.** `POST /api/search/synthesize` sent each person's name, role, company and location and not the industry, while the prompt told the model to check the query's industry against the facts. A fintech question got a summary saying nobody works in fintech. The industry is a labelled field now.
- **The sort menu under the selected row.** On the Network page the sort menu opened under the selected contact row and looked transparent: the header is `sticky z-10`, the selected row is `z-10` too and comes later in the page, so the row painted over a panel drawn inside the header whatever z-index the panel carried. `ActionMenu` and `Select` now open their panel in the browser's top layer through the Popover API (`usePanelPlacement`), where nothing on the page can paint over it and no scroller can clip it. The panel stays in the DOM under its trigger, so a click inside it is still inside the trigger's wrapper and a dialog's focus trap still sees its rows. A scroll that moves the trigger closes the panel, and so does a resize.
- **Escape in a list inside a dialog.** Escape on a row of the field picker in the bulk edit dialog, or of any menu inside a dialog, closed the dialog as well as the list. The dialog listens for Escape on the document in the capture phase, so a handler on the rows ran too late. The panel now takes Escape in the window's capture phase, closes itself, returns focus to its trigger, and the dialog stays.
- **A third journey that left something behind.** The map's box-selection journey added two follow-ups to seeded contacts and never took them off the worker's shared instance, so Pulse read one of them as the second row of "Up next" and the phone metrics scan measured them. All three passed or failed by the order Playwright happened to choose. The journey now deletes what it adds.
- **Two targets the browser suite only met by chance.** The contact's name on a Pulse follow-up row was a 16 px link with no tap box, and the Rename and Delete buttons on a saved view in the map's views menu were 22 px buttons inside a `role="menu"` that did not know them. The link has a 44 px tap box, and the two buttons are 24 px menu items the arrows reach. Both only showed when another spec had left a follow-up or a saved view on the same worker's instance, so the suite passed or failed with the order Playwright chose.

### Changed

- **Unified command palette search history.** The command palette now reads
  and writes from the unified `search_history` database table alongside Ask
  Contrack instead of the `preferences.searchHistory` blob. Palette queries are
  recorded under the `palette` mode while `?` AI queries map to `people` mode.
  Terminal-style history navigation (Arrow Up and Arrow Down) recalls recent
  queries across all modes. The client stops writing to `preferences.searchHistory`,
  though the server continues to accept the legacy key for one release.
- **A timeline in one column.** The contact timeline used to zigzag, with
  cards on alternate sides, so at 1440 px each card was 250 px wide and its
  title wrapped to three lines. Entries now sit in one column, newest first,
  in groups: "This week", then one group per month ("August", or "December
  2025" for an earlier year). Each entry shows a 64 px date column with the
  day and short month, the type glyph, the title as a button that opens the
  interaction, and the body cut at three lines. The full date is the entry's
  tooltip. The red trash icon on every card is gone. A menu with Edit and
  Delete shows on hover, on focus, and always on a touch screen, and the
  interaction dialog has Delete too.
- **Delete an interaction, then undo it.** Delete asks first, and then a
  toast offers Undo for 10 seconds. The server delete is permanent, so the
  app sends it only when the toast closes. Undo sends nothing, leaving the
  page does not cancel a waiting delete, and closing the tab sends it.
- **The contact page follows the width of its own pane.** From 768 px the
  header sits over two columns: Details on the left, in view while it fits
  the window, and Timeline or Dossier on the right. Under 768 px (a phone, or
  a 1024 px window with the list beside the contact) the header is about 140
  px: a 56 px avatar, the name, the role and company, and one meta line. A
  Timeline, Details and Dossier control sticks under the Back bar, the
  composer is one line above the first entry until it takes focus, and Save
  sticks above the phone's tab bar while a note is written. The headline, the
  summary, the tags and the lists move to the Details tab. Back now says where
  it goes: "Network", "Map" or "Archived contacts".
- **The ring around an avatar is the relationship score.** It used to be the
  contact's colour, and a red ring read as trouble. The arc length is now the
  score, and its colour is the band: Strong (70 and up), Fading (40 to 69) or
  At risk (under 40). A contact with no logged interaction shows an empty ring
  and "No interactions yet". The tooltip says the score in words, and each
  contact row's accessible name ends with it, for example "score 72,
  strong". The ring is 2 px in lists and 3.5 px in the header, and a photo
  shows with no grey disc behind it. The bands live in `shared/scoreBand.ts`,
  which the server's at-risk counts and the command palette read too, so the
  palette's "Moderate" is now "Fading". `HealthRingAvatar` is now
  `ScoreRingAvatar`, and the old name stays as an alias for one release. The
  contact's colour is only the accent on its own page.
- **One date format.** Absolute dates use `formatDay` (or `formatWhen` where
  the time matters) across the contact page, the contact list, archived
  contacts, Pulse, AI usage and Ask Contrack, in the reader's locale.
- **A contact header with one primary action.** The name is followed by the
  role at the company on one line, and then a meta line of plain facts: the
  location, the person's local time and the weather. Social links and the
  website follow as links with a `↗` glyph that open in a new tab, each with
  its own small menu. Tags are chips with a "+ tag" button. The header shows
  one primary button, "Log interaction", which opens the Timeline tab and puts
  focus in the composer. Every other action is in "Contact actions": Change
  colour, Change avatar, Copy basic details, Copy full details, Archive and
  Delete, with Delete last on its own surface tone. The palette icon, the
  archive icon, the avatar's hover button and the unlabelled sparkle are gone
  from the header. The menu follows the menu pattern: focus moves into it,
  the arrow keys, Home, End and a first letter move, and Escape returns to the
  button. The colour picker opens from the menu as a radiogroup named
  "Contact colour". The weather is fetched only when it is shown, so the
  settings revamp's switch can turn the request off with it.
- **The briefing lives in the Dossier tab.** A "Briefing" card at the top of
  the tab offers "Generate briefing", shows the three points inline with when
  they were written, and offers "Regenerate briefing". A briefing that fails
  says so in the card. It used to be a 28 px sparkle beside the company that
  opened a modal and, on an error, showed a spinner that never ended.
- **One pattern for every detail.** Each value in the Details card is a
  `Field`: a 12 px sentence-case label, the value, its label select and a row
  menu, and a "+ Add" button under the list. A value edits in place with a
  click or Enter, and Escape cancels. A pencil after the value shows at 40
  percent on a touch screen and on keyboard focus. The row menu holds Make
  primary, Show on map (address rows) and Remove, and the first address
  says "Map pin" in plain text. A row moves with Alt+Arrow Up and Alt+Arrow
  Down, a screen reader hears its new position, and the drag handle shows
  while the row's menu is open. The label select is a 32 px chip at every
  width. Tags, preferences and interests share one `ChipInput`, and removing
  a preference or an interest now offers Undo too. Birthday and Industry are
  real buttons with the same pencil. The italic "Add another", the
  underlined bare inputs and the per-row "Show on map" link are gone. The
  shortcuts dialog lists Enter, Escape and the Alt+Arrow moves under a new
  "Contact" group, and ⌘ Enter under Global.
- **One composer.** `InteractionComposer` replaces `RichInteractionComposer`
  and the textarea inside `QuickInteractionModal`. The quick interaction
  dialog now has @mentions and the next-action line too. The type is a
  radiogroup, Note, Call, Meeting and Email, with text from `sm` and icons
  below. Save is always enabled: a Save with nothing written says "Write
  something first" and moves focus to the editor, and in the dialog a Save
  with no contact says "Choose a contact first". A "⌘ Enter to save" hint
  sits at the end of the next-action line, and ⌘ Enter works from that line
  as well as the editor. The mention list opens inside the dialog, where it
  can be clicked, and its avatars fit their rows. `QuickInteractionModal` keeps `isOpen` and `onClose` and gains
  `initialContactId`, which opens it for one person without the contact
  search. The dialog loads the composer only when it opens.
- **The map is MapLibre GL JS on OpenFreeMap vector tiles.** Leaflet, its
  cluster plugin and the raster basemap are gone. The basemap is OpenFreeMap's
  `positron` in the light palette and `dark` in the dark one. Neither needs an
  API key or registration, and neither sets a request limit. MapLibre clusters
  the pins itself, so a click on a cluster zooms to where it splits. A cluster
  of people the geocoder placed on one point cannot split, and it opens a list
  of those people instead, so a stacked pin stays reachable. Every pin is a
  button named `"<name>, <company>"`, and every cluster a button named
  `"<n> contacts, zoom in"`. The markers are React components now, not HTML
  strings, and the map is a region named "Contact map". `MAP_STYLE_LIGHT` and
  `MAP_STYLE_DARK` point either palette at another style, as an absolute https
  URL or a root-relative path such as `/map/style.json`.
  `GET /api/auth/status` reports the pair as `map`. The production CSP adds
  `worker-src 'self' blob:`, `child-src blob:` and each style's origin in
  `connect-src`. A root-relative style adds no origin, so a self-hosted
  basemap is a config change and not a code change, and the registered
  `pmtiles://` protocol lets such a style read one `.pmtiles` archive.
  `GET /api/contacts/map` now also leaves out trashed contacts and ghosts. See
  `docs/features/map-view.md`.
- **One button shape.** `.btn-primary` and `.btn-secondary` are rounded
  rectangles, 44 px tall on a phone and 40 px from `sm`, with one disabled
  look. Every primary and secondary call-to-action uses them. Pills are for
  chips, filter pills and `Segmented` only, and the floor test fails on a
  filled primary pill anywhere else.
- `Segmented` options are 44 px tall below `sm`. Accent swatches are 36 px
  with a 44 px tap box.

### Fixed

- A date with no time, such as a birthday stored as `1974-05-10`, shows on
  its own day. It was read as midnight in UTC, which is the day before
  anywhere west of Greenwich.
- Typing `@` in the composer finds people even when the contact names had not
  loaded when the editor was created. The editor kept the list it was created
  with, which could be empty.
- An inline edit closed with Enter or Escape gives focus back to the value.
  Focus used to fall to the page.
- ⌘⇧I opens the quick interaction dialog when the browser reports the key as
  a capital "I".
- The temperature on a contact arrives at its full colour. It used to fade in
  from nothing, which is text below its contrast for as long as the fade
  lasts, and an accessibility scan that started in that window read it as a
  failure. It now grows into place at full opacity.
- Controls that had only a `title` now have an accessible name: the Select
  button on Network, each "Remove" button on a contact's details (it names the
  value), the Note, Call, Meeting and Email type buttons in the composer, and
  the back link on the Duplicates page. The sidebar wordmark is hidden from
  screen readers.
- The note editor has a name, "Note", and its placeholder as a description.
- The Instance health page's definition lists hold only terms and
  definitions, which clears the axe `definition-list` failure.
- The shortcut chips in the command palette meet contrast at 11 pixels.
- Heading levels no longer skip: the Import dialog's sub-heading is an `h3`,
  the Ask Contrack coverage card is an `h2`, a contact's Details card is an
  `h2`, and the timeline entries are `h3`.
- The keyboard shortcuts overlay is a dialog now: it has the role and the
  name, traps Tab, and returns focus to the button that opened it. It was a
  bare overlay with an Escape handler.
- The contact card that opens over search results has the same: role, name,
  focus moved in, Tab kept inside, focus returned to the result on close.
- The quick interaction dialog is named "Log an interaction" rather than
  "Dialog".
- Form fields render at 16 pixels on a phone, so iOS Safari no longer zooms
  the page when one takes focus.
- On the Network page, Enter on a focused link or button activates it
  again. The list's Enter-to-compose shortcut swallowed every Enter outside a
  field, so a keyboard user who tabbed to a sidebar link and pressed Enter
  went nowhere.
- The open contact's row is marked current again, with its ring and
  `aria-current`, and the j/k keys step from it. The list is mounted on the
  catch-all route, so the route parameter it read was always empty and
  every ArrowDown went to the first contact.
- Switching to Notes with the arrow keys keeps focus on the People / Notes
  switch, as a radiogroup promises, rather than jumping into the field.
- The inline help and score-breakdown buttons are at least 24 pixels, the
  WCAG 2.5.8 floor for a target. The icons are the size they were.
- The timeline's drop target and the avatar picker's file input have names.
- Leaflet's attribution links are underlined, so they are told apart from
  the text beside them by more than colour.
- With "reduce motion" on, staggered tiles no longer wait their turn at
  opacity zero before appearing at once.

- **Note search.** Ask "Who discussed hiring last month?" and get the notes
  that say so, each with the person it is about, the date, and the passage
  that matched. A new FTS5 table, `interactions_fts`, indexes note titles and
  bodies as plain text, with stemming and diacritic folding, and three
  triggers keep it in step with every write in the note's own transaction. A
  date phrase in the question (`last month`, `since March`, `in 2025`, `the
last 30 days`, …) is read locally, in the caller's time zone, and applied
  as a filter; nothing here calls a model. `GET /api/search/interactions`
  answers with the hits, highlight offsets, the total, and what it understood.
  The search page has a Notes mode beside People, with period presets, a kind
  filter, and paging, and a result opens the note on its contact's timeline.
  Notes on archived, trashed, merged and ghost contacts are hidden. See
  `docs/features/interaction-search.md`.
- Every bulk import has an id and a record. The browser makes the id when a
  file is chosen and sends it as `X-Import-Id`, and `imports` keeps a row per
  import and `import_rows` a row per contact. A second request with the same
  id writes nothing and answers from the record, so a dropped connection
  followed by a retry never creates the contacts twice. `GET /api/imports/:id`
  reads the record, and a browser that lost its stream polls it rather than
  showing "Import Complete" over an import it knows nothing about. A record
  whose server process died settles on the next read: one that never saved a
  contact is reported failed, and one that saved its contacts but never
  finished the duplicate check is finished then.
- A row that fails no longer fails the import. The rest of the batch is
  saved, the row is kept with its error and its payload, and
  `GET /api/imports/:id/rows` lists it. `POST /api/imports/:id/retry` runs
  the failed rows again from what the server kept, without the file being
  sent a second time. Finished imports are swept after thirty days.
- An import can be reconnected to and retried. The browser makes an id for
  each file it imports, sends it as `X-Import-Id`, and remembers it per
  account. A stream that ends without the server's `done` frame no longer
  shows "Import Complete": the modal polls `GET /api/imports/:id` until the
  server says `complete` or `failed`, and shows the summary the server
  confirmed. A dead connection, a 409 for an import already running, and a
  reload part way through all lead to the same record, and "Try again" sends
  the same contacts under the same id, which the server treats as one import.
  Rows the server could not write are listed on the summary with the reason
  and retried through `POST /api/imports/:id/retry` without the file.
- **Phase 3.** An administrator can manage the accounts on the instance.
  `GET`, `POST`, `PATCH` and `DELETE /api/admin/users` list, create, change
  and remove accounts, `POST /api/admin/users/:id/disable` and `/enable` turn
  one off and on again, `POST /api/admin/users/:id/reset-password` issues a
  new temporary password, and `GET /api/admin/users/:id/export` downloads one
  account's data for the person who is leaving. Every one of them needs an
  admin account.
- **Phase 3.** Invitations. `POST /api/admin/invitations` returns a link once,
  `GET` lists them with their status, and `DELETE` revokes one. The person
  uses the link at `POST /api/auth/accept-invitation`, which creates their
  account with the role the invitation carried and signs them in. There is no
  mail: the database holds only the hash of the secret in the link, and the
  admin sends the link however they already talk to the person.
- **Phase 3.** An audit log. Every administrative action writes one row:
  creating, inviting, disabling, enabling, deleting and exporting an account,
  changing a role or a password, changing an instance setting, taking a
  backup, and every sign-in and sign-out. `GET /api/admin/audit` pages through
  it newest first. Details never carry a password, a token, an invitation
  secret or a provider key, and the service redacts a credential-shaped field
  rather than trusting each call site.
- **Phase 3.** A forced password change. An account created or reset by an
  administrator holds a password that administrator chose, so every data route
  answers `403 PASSWORD_CHANGE_REQUIRED` until the person replaces it. Their
  own account settings stay reachable, which is where the change happens.
- **Phase 3.** Personal API tokens. `POST /api/auth/tokens` mints one,
  `GET` lists them with enough of each to tell two apart, and `DELETE`
  revokes one. A token acts as its own account everywhere that reads owned
  data, so an MCP client signed in with one reads the contacts of whoever
  issued it. It cannot reach any route that manages the account, which means
  a script can neither mint a second token nor change the password that would
  revoke its own.
- **Phase 3.** Open registration, off by default. `POST /api/auth/register`
  answers `403 REGISTRATION_CLOSED` until an admin turns it on through
  `PUT /api/admin/settings`, and the account it creates is always a member.
- **Phase 3.** `GET` and `PUT /api/admin/settings` hold the instance
  settings: open registration and the session lifetime.
  `PUT /api/auth/session-policy` writes the same session value and is
  deprecated.
- **Phase 3.** A second rate limit on the AI routes, per account rather than
  per address, at thirty requests a minute. On a multi-user instance behind
  one office address the older per-address limit let one person spend
  everybody's provider budget. `GET /api/dashboard/insight` and
  `POST /api/dedupe/scan` join the list both limits cover, and a `429` from
  either now carries a `Retry-After` header.
- **Phase 3.** One daily maintenance sweep, gated by
  `DISABLE_BACKGROUND_JOBS`. It removes audit rows past ninety days, expired
  sessions, tokens revoked more than thirty days ago, invitations that died
  more than thirty days ago, and AI invocations outside the stats window.
  Before this the invocation cleanup ran once at boot and the session sweep
  was boot-only, so an instance left running for a year swept twice.
- **Phase 3.** `?scope=all` on `GET /api/ai/stats/summary` and
  `/feed` gives an admin the instance totals and a per-account breakdown,
  because the provider key is one key and the bill is one bill. A member
  asking for it gets `403 ADMIN_REQUIRED`. The instance feed names the
  account behind each call and omits the description, which is the one field
  that can carry a fragment of what somebody asked about.

- **Phase 4.** An administration area, for admins only and downloaded only by
  them. Accounts (create, invite, edit, reset a password, disable, export,
  delete), Invitations, Instance (who can join, how long a sign-in lasts, the
  AI configuration and SearXNG), Backups, and the Audit log with a filter and
  paging. Each is a separate chunk, so a member never fetches five pages of
  account management to be told they may not open them.
- **Phase 4.** Backups have a UI. The service has taken snapshots and rotated
  them for years and nothing in the app has ever shown one, so the only way to
  know it was working was to look in the data directory.
- **Phase 4.** AI usage gained a **Mine / All users** control for admins, with
  a per-account breakdown of calls, tokens and cost. The provider key is one
  key and the bill is one bill. A member sees only their own, and asking for
  the instance view without an admin account is a `403`.
- **Phase 4.** Deleting an account shows what it owns before it goes. The
  first click is refused with `409 USER_HAS_DATA`, the counts in that refusal
  are what the dialog shows, and the delete needs both an explicit checkbox
  and an "export their data first" button beside it.

- **Phase 4.** The sign-in flow covers every way an account starts. A new
  instance is set up; an instance that has been running without sign-in is
  _secured_, and the screen says so and explains that the contacts already
  there stay with the account it creates. An invitation link opens a join
  screen, open registration adds a "Create one" link to sign-in, and an
  account holding a password an administrator chose is sent to a screen that
  replaces it before anything else works.
- **Phase 4.** The app knows who is signed in. `useAuth()` carries the account,
  its role, whether the password must change, and what the instance allows,
  and it is available on every screen rather than only after the gate opens.
  The signed-in account appears at the foot of the sidebar on desktop, with a
  menu holding the account settings and sign-out, and at the top of Settings
  on a phone. All of it hides on an instance that asks nobody to sign in.
- **Phase 4.** An API tokens section in Account settings. Create a token and
  see its value once, read the list with the last time each was used, and
  revoke one. A banner appears while the deprecated environment `API_TOKEN`
  is still set, naming the variable to remove.
- **Phase 4.** A dedupe scan behind another account's says so. The scan is
  booked on the server and starts by itself, and the page says that rather
  than showing a progress bar at zero. `GET /api/dedupe/active` gained a
  `queued` field, which is the only way a reloaded page can tell a booked scan
  from one that has hung.
- **Extra F3.** An instance name. One setting, 60 characters or fewer, shown
  on the sign-in and join screens, in the account menu, and in the browser
  tab. Somebody clicking an invitation arrives at a screen belonging to an
  instance they have never seen, and a hostname is not an answer to "whose
  Contrack is this". Set it under Administration, Instance. Leaving it empty
  shows the product name, exactly as before.
- **Extra F4.** `/healthz` reports the schema versions this database is on,
  beside the versions this build expects, so an operator can confirm a
  migration ran without opening the database or signing in. Version numbers
  and nothing else: the endpoint answers without a credential, so it carries
  no counts, no configuration and no accounts.
- **Extra S9.** An instance health panel, at Settings, Administration,
  Instance health. `GET /api/admin/health` answers what an operator needs when
  several people share one instance: the schema versions this database is
  actually on, the database and write-ahead log sizes, the newest backup and
  whether it verified, which account the dedupe scan is running for and who is
  waiting behind it, how much of each account's contacts the search index
  covers, the AI cache hit rates, and the provider's tier and paused models.
  Every one of those was answerable only by reading the server log or opening
  the database. `/healthz` is unchanged and stays two states and no detail: it
  answers without a credential, and an unauthenticated endpoint must not
  describe the instance.
- **Extra F1.** Nothing under `/api/auth`, `/api/admin`, `/api/ai/stats` or
  `/api/export` may be stored by a browser or a proxy any more, and uploaded
  files are `private` rather than `public`. Those four prefixes carry
  responses that differ per caller, and an upload belongs to exactly one
  account, so a shared cache holding one could hand it to whoever asked for
  that URL next. Known issue S-03.
- **Extra F6.** "Load older activity" on the AI usage feed adds a page instead
  of replacing the one on screen. Reading the feed used to mean losing the
  rows you had just read, with no way back. Known issue B-02, where the
  blocker was the design decision rather than the code.
- **Extra S6.** The daily sweep checkpoints the write-ahead log. The database
  runs in WAL mode and nothing in the codebase had ever called a checkpoint:
  SQLite runs one by itself past a thousand pages, but only when no reader is
  looking at an older version of the database, so a dedupe scan or a full
  export holds every checkpoint off for as long as it runs and the log grows
  for the whole time. The sweep now runs a passive checkpoint always, and a
  truncating one when the log is over 64 MB and no scan is running, because a
  truncating checkpoint behind a scan would hold the write lock until the scan
  finished. Requests refused with a database-busy error are counted, which is
  the symptom people report and the one nobody could previously measure.
- **Extra S5.** Every backup is opened again as soon as it is written. The
  service produced a snapshot, rotated the old ones, and trusted all of it,
  so the first person to find out whether any of it worked would have been
  somebody restoring after losing the original. Each snapshot is now opened
  read only, put through `PRAGMA quick_check`, and counted against the live
  database, and the answer is recorded beside the file and shown as a badge
  per snapshot in Administration. A snapshot that reads perfectly and holds
  nothing fails the check, which is the failure an integrity check alone
  cannot see. `GET` and `POST /api/backups` carry the result. At boot the
  server warns when the newest verified snapshot is older than two intervals.
- **Themes.** A dark palette, a three-way setting, and an accent colour. The
  app had one light palette of `--color-*` tokens and no `color-scheme` rule at
  all, so a dark machine got a white page with dark scrollbars. Light, Dark and
  System are in Settings, System is the default and costs no JavaScript — the
  stylesheet answers `prefers-color-scheme` on its own — and the choice is
  stored on the account, so it follows a person to their phone. The accent
  picker derives the primary and container tokens from any colour: hue and
  chroma are kept and lightness is searched until the result clears WCAG AA on
  every surface it lands on, in both palettes, which is checked over 6,000
  colours in `tests/unit/theme.contrast.test.ts`. The map swaps to a dark
  basemap, the monogram avatar carries its own `prefers-color-scheme` rule so a
  served image follows the palette, and the eight per-contact vibe colours are
  derived the same way the accent is instead of being eight hand-written light
  values.
- **Server-side preferences.** List density, the recent-contacts limit, the
  auto-merge sensitivity, the temperature unit, the theme and the accent, and
  the search history, all live in `user_settings` behind
  `GET` and `PATCH /api/auth/preferences`. They were `localStorage` keys, which
  is per browser rather than per account: a preference set on a laptop never
  reached a phone, and two people signing in and out of one browser shared
  every value including the search history. Whatever a browser still holds is
  moved to the account once and then removed, and a key the account has already
  chosen on another device is left alone. Neither route needs a session, so an
  instance with sign-in switched off can still choose a theme.
- **vCard export.** `GET /api/export/vcard` writes the caller's contacts as a
  vCard 3.0 file, and Settings offers it beside the CSV and JSON exports, which
  had no link anywhere in the app. The same `shared/vcard.ts` writes the file
  and parses one dropped on the import modal, so a round trip is lossless
  rather than nearly: `tests/unit/vcard.test.ts` walks contacts out and back in
  and compares every field, including a semicolon in a surname, a comma in a
  company, a newline in a note, an emoji across a fold, and a name long enough
  to fold four times.
- **Story 8.** A dedupe precision and recall gate.
  `tests/eval/dedupe.eval.test.ts` runs four routes over a corpus of 745
  contacts with 332 labelled pairs and compares precision, recall, F1, mean
  confidence, recall per duplicate kind and hard negatives matched per kind
  with a committed baseline. The unit tests covered the matchers one at a
  time, so a change to blocking, to a threshold or to the order the passes ran
  in could move which pairs came out and nothing would notice. The fixture
  carries twelve kinds of duplicate and seven kinds of near miss, including a
  father and a son at one firm and a couple sharing a landline, and
  `validateCorpus` refuses a corpus whose labels are not the whole truth.
  Re-record with `npm run eval:record:dedupe`.
- **Story 7.** A name in a timeline note is resolved against the contacts the
  account already has, in tiers: the normalized name, then the nickname table,
  then the phonetic hash, then a fuzzy comparison, with the company and a
  person the contact has shared a note with as tiebreakers. It used to be an
  exact string match, which missed "Jon" for "Jonathan Smith" and made a
  second ghost every time. Above a confidence threshold the mention attaches
  to the contact; below it, and above a lower one, the ghost is made and a
  suggestion pairs it with the candidate in the same review queue as a
  duplicate; below both it is a plain ghost as before. Two contacts that score
  the same demote the answer to review however high the top score is, because
  linking one of them would be a coin flip nothing on screen would show.
- **Extra S2.** A search quality gate. `tests/eval/search.eval.test.ts` runs
  fifty golden queries against a fixed corpus of three hundred contacts and
  compares recall at ten and mean reciprocal rank with a committed baseline,
  for the quick search box, for keyword ranking on its own, and for the hybrid
  fusion. Ranking could be changed by one number in one string before this,
  and nothing in the suite would have noticed. The gate fails on an
  improvement as well as on a regression, so a ranking change arrives with the
  measurement that justifies it. The contact and query embeddings are recorded
  by `npm run eval:record`, so the gate needs no model and no network.

### Fixed

- **Make merge undo restore the actual records.** Merges now record complete
  pre-merge snapshots of both primary and duplicate contacts, list memberships,
  and 12 child tables in `dedupe_merge_log.duplicateSnapshot`. Manual merges now
  soft-merge with full snapshot tracking and are completely undoable rather than
  permanently deleting the duplicate. Undoing a merge reverses unchanged child
  record transfers back to the duplicate, preserves post-merge edits on the
  survivor while restoring the original records to the duplicate, and recomputes
  follow-up task caches (`nextFollowUpAt`) on both contacts. Conflicts (such as
  post-merge task completions or field modifications) are tracked and surfaced.
  Conflicting field values are also previewed before merge confirmation across
  the dedupe review view, swipe card, and contact detail duplicate banner.
- Ask Contrack runs the same question again. The page refused a question
  that matched the previous one, and Clear did not reset that memory, so a
  question once asked could not be asked again until a different one had been
  asked in between. The guard now reads the question the search is answering,
  and only refuses a duplicate while that answer is still streaming. A Retry
  button sits in the error state and a Refresh button beside the results, and
  both re-ask the question the results belong to rather than whatever the
  input says by now.
- The synthesis brief summarises the question that was asked. The results
  carry their question as `query`, stamped by `useSemanticSearch`, and the
  brief reads it there. Before this the bar was handed the editable input, so
  typing question B over question A's results and pressing Synthesize
  summarised A's contacts under B's words. The command palette had the same
  wiring and is fixed the same way, and the `?q=` link from the palette now
  records its question, so leaving the page and coming back restores it.
- One merge policy, on every path that merges. The import path scored a
  shared phone number 0.99 where a scan scored it 0.95, scored an exact name
  across two sources 0.95 where a scan scored it 0.92, and ran at a fixed
  0.93 whatever sensitivity the account had chosen. `dedupe/policy.ts` now
  holds the one table of confidences and the one preset table, and the scan,
  the import, and the check after a contact is added all read the account's
  preset from it. The browser sends the scan mode and nothing else.
  `POST /api/dedupe/scan` still accepts `autoMergeThreshold` as an override
  for one scan.
- A shared identifier is weaker evidence when many contacts carry it, and no
  evidence of one person when the names disagree. Each contact beyond the pair
  costs a match three points, so a phone number on three contacts asks under
  the balanced preset. A shared number or address between two different first
  names, or between "Sr." and "Jr.", is capped at 0.85, below every preset,
  and reaches the review queue with the reason written on it. On the eval
  corpus the pairs a scan would merge that are two different people fell from
  30 to 14, and the import path's from 47 to 14, with the scan losing one
  correct merge to review and the import path none that a scan would have
  made.
- The interaction composer keeps a note until the save that keeps it. It
  cleared its editor the moment a save started, on the button and on
  Mod-Enter alike, so a request that failed took the note with it. On
  success only the submitted content is removed, and a sentence finished
  while the request was out stays in the editor. A second Save while one is
  pending starts no second request. What is in the composer is written to a
  draft in `localStorage` a moment after each keystroke and flushed when the
  page is hidden, unloaded, or the composer leaves the tree, so a session
  that expires mid-save, or a navigation away, does not lose the note. Drafts
  are keyed by account and by contact, so two people in one browser never
  open each other's. Mod-Enter also sent a "note" with no follow-up whatever
  the screen showed, because the shortcut kept the first render's closures.
  It sends what is there now.
- A merge keeps the duplicate's follow-up tasks. `action_items` was the one
  child table the merge never re-parented, so the hard merge's final `DELETE`
  took every task the duplicate carried through `ON DELETE CASCADE`, and a
  soft merge left them on a contact the list no longer shows. Both paths now
  move every task, completed ones included, inside the merge transaction, and
  recompute `nextFollowUpAt` on the survivor and on the duplicate. The
  `action_items_sync_update` trigger also settles the contact a task moved
  away from, which it did not before.
- **Story 10.** The hourly relationship-score sweep recomputes only what
  changed. It scored every contact of every account every hour — 989 ms on
  50,000 contacts to change almost nothing — and now reads a partial index of
  contacts a trigger has marked, which is 0.08 ms on a quiet instance and 1.79
  ms after ten new interactions. A daily full pass still runs, because recency
  decays with the clock and no trigger can see that; it is 435 ms on the same
  50,000 contacts, down from 989 ms, because the per-contact statement is now
  prepared once rather than per contact. Both sweeps take turns between
  accounts a batch at a time, so a large account cannot put a small one behind
  it.
- **Story 10.** Writing a relationship score is no longer an edit. The sweep
  wrote `relationshipScore` on every contact every hour, which fired the
  `contacts_auto_updated_at` trigger and stamped `updatedAt` across the whole
  instance. `updatedAt` therefore meant "the last sweep" rather than "when this
  contact was last edited", and `findStaleEmbeddings` re-embedded every contact
  in the account on the next dedupe scan, through whichever provider is
  configured. Both `updatedAt` triggers now name their columns, and the list is
  derived from the table so a column added later is covered.
- **Themes.** Two placeholder prompts on the contact detail page are readable.
  "Add Birthday..." and "Add Industry..." were drawn at half opacity, which is
  half the contrast: 2.19:1 and 2.86:1 on a white card. They are italic and
  muted now instead. Found by the contrast audit on the first run that reached
  the contact detail route, which needs an instance with contacts in it.
- **vCard import.** The vCard parser unfolds long lines, decodes
  quoted-printable, and understands both spellings of a parameter. It was a set
  of regular expressions over raw lines, so a name longer than 75 characters
  arrived cut in half, `TEL;WORK;VOICE:` from a phone arrived with no label,
  and an address book exported from an older Android or Outlook rendered
  "José" as "JosÃ©". A `CELL`, an `IPHONE` and a `MOBILE` are now one label
  rather than three.
- **Story 1.** The embedding model runs on a `worker_threads` thread instead
  of the request thread. A backfill of 2,000 contacts took 2.4 seconds and
  blocked the event loop for 2.19 of them, in bursts of up to 83 ms, so while
  one account's index was built every other account's requests waited. The
  same backfill now blocks it for 0.03 seconds with a worst single stall of 7
  ms. The worker has no database connection and no way to get one, so the
  single-writer rule holds by construction. A worker that will not spawn falls
  back to running in process, and `DISABLE_CPU_WORKER=true` selects that
  deliberately.
- **Story 1.** The deterministic dedupe pass no longer joins contacts to
  contacts through a function. It matched on
  `LOWER(TRIM(name)) = LOWER(TRIM(name))`, which no index can answer, so
  SQLite compared every contact with every other: 42.9 seconds on 10,000
  contacts to find no duplicates at all, and the cost grew with the size of
  the account rather than with the number of duplicates in it. The email pass
  had the same shape. Both group rows that are already loaded, which is 24 ms
  at 10,000 contacts and 131 ms at 50,000.
- **Story 1.** The scoring pass no longer asks the vector store for a
  similarity when there is no vector store. Every one of those queries failed
  inside its own try/catch and returned zero, so 30,000 candidate pairs meant
  30,000 failing queries: 1.16 seconds of a 1.2-second pass.
- **Story 1.** `normalizeCompany` compiles its thirty-three suffix patterns
  once instead of on every call. It was the most expensive thing in the dedupe
  normalizer and in mention resolution: 339 ms to 69 ms per 50,000 calls.
- **Story 4.** The vector search filters inside the index rather than around
  it. Both `vec0` tables carry the contact's ghost, archived and active state
  as sqlite-vec metadata columns, so the nearest neighbours are chosen from
  contacts somebody can see rather than filtered afterwards. It replaced a
  subquery that made SQLite list every active contact in the account on every
  search: 43.68 ms to 1.48 ms per query on 50,000 contacts, 8.16 ms to 0.36 ms
  on 10,000, for the same fifty contacts in the same order. A trigger keeps
  the columns equal to the contact row. The dedupe neighbour search applies
  the same predicate, so it no longer spends a neighbour slot on an archived
  or trashed contact the scorer would drop.
- **Story 4.** Archiving a contact no longer deletes its search vector. The
  vector encodes the contact's text, which a status change does not touch, so
  archiving and restoring somebody used to cost an embedding for nothing.
- **Story 7.** The name tokenizer folds accents onto the base letter.
  "María García" tokenized to four fragments with a surname of "a", because
  every accented character was treated as punctuation and replaced with a
  space. Every consumer improves: the dedupe eval's diacritic recall went from
  0.9375 to 1.0 with precision up and nothing else moved.
- **Story 7.** A ghost never survives a merge with a real contact.
  `computePrimaryScore` counted fields and nothing else, so a bare real
  contact and a ghost both scored 5 and the survivor came down to which id
  sorted first.
- **Extra S3.** A bulk import checks its contacts for duplicates in one pass
  instead of one pass each. Every check normalized the whole account and built
  a whole scan context of its own, so importing `n` contacts into a corpus of
  `m` did about `n × m` work and nearly all of it was the same work repeated.
  Measured: a thousand contacts into a corpus of ten thousand went from 113
  seconds to 1.8 seconds, and the gap widens as the corpus grows. The
  streaming import used its own separate matching, written out in the route
  and weaker than the other path's, so what counted as a duplicate depended on
  whether the client asked for a stream. Both paths now run the same scan, and
  a streaming import finds nicknames and close profiles it could not see
  before. One behaviour changed with it: an imported contact whose name
  already exists is now a suggestion to review rather than an automatic merge.
  The streaming import scored that at 0.95 and merged it, the other import
  scored it at 0.92 and asked, and two people can share a name.
- **Phase 3.** An expired personal token is refused from the moment it
  expires. The expiry check compared a database timestamp against a
  JavaScript one, and a space sorts before a `T`, so a token whose expiry fell
  earlier on the same UTC day still worked, in the worst case for nearly a
  full day past the time it was meant to stop.
- **Phase 3.** A capital letter no longer escapes the AI rate limits. This
  app routes URLs case-insensitively, so `/API/Dashboard/Insight` reaches the
  same handler and makes the same billable call as the lower-case spelling,
  and neither limiter was counting it.
- **Phase 3.** The daily sweep removes a session or an invitation that expired
  earlier the same day, rather than leaving it for the next day's run, and a
  session that has expired no longer counts towards the session totals an
  account or an administrator sees.
- **Phase 3.** A personal token's `lastUsedAt` is stamped at most once an
  hour, as it was always meant to be. The hourly check compared a database
  timestamp (`2026-09-10 05:33:50`) against a JavaScript one
  (`2026-09-10T04:33:50.000Z`), and a space sorts before a `T`, so the stored
  value looked older than any cut-off from the same day and the row was
  written on every request a script made.
- **Phase 3.** An invitation link no longer reaches the access log. The link
  carries its secret in a query string, and the invitee's browser sends it to
  this server as an ordinary page request, so the one value the invitation
  system keeps out of the database was landing in the request log instead.
  The value of `token`, `secret` and `api_key` is replaced in every logged
  URL.

- **Phase 4.** An administrator could reset their own password and be locked
  out of the instance. A reset deletes every session of its target, so aiming
  it at yourself signs you out mid-request and the response carrying the new
  password reaches a browser that is already being torn down. The old password
  no longer works either. `POST /api/admin/users/:id/reset-password` now
  refuses a self-target, alongside the disable and the delete it already
  refused.
- **Phase 4.** The account row menu was clipped away by the list's
  `overflow-hidden`, so on the lower rows Disable, Delete and Export were
  painted outside the box and could not be clicked at all.
- **Phase 4.** A failed read in the administration area rendered as "there is
  nothing here". A query that fails leaves its loading flag false and its data
  undefined, so a 500 or a dropped connection reported an empty instance in
  reassuring copy, and the Instance page painted its controls from invented
  defaults including registration "closed".
- **Phase 4.** The Settings back button was a 36 px touch target, on the one
  control every page in that area shares. The AI usage empty state was drawn
  at 1.57:1 contrast, the only text in the app the audit fails on.
- **Phase 4.** `npm run audit:contrast` could not gate anything it was pointed
  at. Its default port was one nothing listens on, its route list named none
  of the administration pages, and it drives a browser with no session — so on
  a gated instance it measured the sign-in screen a dozen times and reported
  zero failures. It now defaults to the port `npm run dev` serves, sweeps the
  administration area, and says in the file that it has to run against an
  instance with sign-in off.

- **Phase 4.** Enrichment reported every refusal as the daily grounding quota
  being exhausted. The branch that did it could not run at all — the shared
  client throws for any non-2xx, so the code reading `res.status` was
  unreachable — and since Phase 3 the likeliest refusal is the per-account AI
  limit, not the quota. The message now comes from the code the server sent,
  and a limit held by another account says so instead of blaming the reader.
- **Phase 4.** A dedupe stream that failed four times used to stop silently:
  no error, no toast, no change on screen, and a progress bar that never moved
  again for a scan that finished normally. An `EventSource` failure carries no
  status, so the client now asks `/api/auth/status` which kind of failure it
  was. A signed-out browser goes to the gate; a working one falls back to
  polling the scan until it ends.
- **Phase 4.** The contacts prefetch ran at module load, before React
  rendered, so the first request of every page load on a gated instance was a
  `401` from a browser that had not yet asked whether it was signed in. It now
  runs when the gate opens, and again for the next account after a sign-out.
- **Phase 4.** Three components reached `/api/...` with a bare `fetch`: the
  bulk import, the link unfurler, and the enrichment call. None of them could
  act on a `401` or a `403`, so a session that expired during an import
  produced a failed import and no way to sign back in.
  `tests/unit/frontend.apiClient.test.ts` scans the source and fails on the
  next one.

### Removed

- **Extra F5.** The environment variable `AUTH_TOKEN`. It was the name
  `API_TOKEN` had before accounts existed, and 1.x went on honouring it with a
  warning at every boot. **The server now refuses to start while it is set**
  rather than starting with no credential at all: an operator who believes
  their instance is protected is the worst of the three possible outcomes.
  Rename it to `API_TOKEN`, which is itself deprecated and goes away in 3.0.

### Changed

- `GET /api/interactions/search`, the MCP note search, runs on the note index.
  It matched `q` as a substring of the title or body and returned raw rows; it
  now matches by word and stem, reads date phrases, accepts the same filters
  as `GET /api/search/interactions`, answers with a plain-text `excerpt` in
  place of the HTML `content`, and hides notes on contacts the app hides. The
  response is still an array, and each hit still carries `title` and
  `contactName`.
- **Extra F2.** CI enforces a coverage floor instead of only reporting one.
  `vitest.config.ts` carries thresholds set two points under what was measured
  when they landed, with a second, independent floor on `server/**`. The
  matrix and manifest tests are what hold the isolation guarantee up, and
  before this a pull request could delete them and go green.
- **Phase 4.** Session length moved from Account settings to Administration →
  Instance. It decides how long every account's sign-in lasts, which stopped
  being a personal setting the moment an instance could have more than one
  account. `/settings/ai-config` redirects for the same reason: one set of
  provider keys pays one bill.
- **Phase 4.** `GET /api/dedupe/active` reports `queued`. A booked scan is a
  real record with phase `starting`, identical to a scan that began a moment
  ago, and this is the only thing that tells them apart after a reload.
- **Phase 4.** `GET /api/admin/audit` takes an `action` filter, validated
  against the actions the app writes. Filtering a fetched page would show two
  sign-ins out of fifty rows with no way to reach the rest, and an audit log
  that answers a typo with an empty page reads as "nothing happened".

- **Phase 4.** Signing in as a different account replaces the whole component
  tree rather than reusing it. Clearing the query cache removed what the
  server had sent; the recently-viewed list, the last AI Search, the dedupe
  scan and every open panel were React state and survived it.
- **Phase 4.** `emitAuthExpired` carries a reason. A `401` and a
  `403 ACCOUNT_DISABLED` both end at the sign-in screen and now say different
  things there, because inviting somebody whose account an administrator
  closed to try their password again sends them round a loop with no end.
- **Phase 4.** `.agent/STYLE.md` states the two mobile rules the primitives
  have carried without documenting: a 44 px minimum hit area on every touch
  control, and modals as bottom sheets below `sm`.
- **Phase 3.** The fourteen routes the route manifest has classed `admin`
  since Phase 2 are now closed to a member. Backups, every write under
  `/api/settings/ai`, the AI diagnostics and grounding-capacity reports, the
  instance-wide embedding backfill, the session-policy write and the
  development cache-stats endpoint each answer `403 ADMIN_REQUIRED`. The guard
  sits on each route rather than on its router, and the manifest test fails
  when an admin route arrives without it.
- **Phase 3.** Deleting an account is two steps. The first answers
  `409 USER_HAS_DATA` with what the account owns and changes nothing, so the
  export button next to the delete button is still useful. A request that says
  `decision: "purge"` removes every row, both vector stores, the embedding
  metadata, the search index rows and the upload directory, in one
  transaction. Ten thousand contacts take 147 ms.
- **Phase 3.** Three guards stand between an administrator and an instance
  nobody can administer. The last active admin cannot be demoted, disabled or
  deleted. An admin cannot disable or delete their own account. The local
  account that owns this device's data cannot be touched while authentication
  is off, because nobody can sign in as it.
- **Phase 3.** The forced password change covers `PUT /api/auth/session-policy`
  as well. That route sets how long every future session on the instance
  lasts, and it lives in the auth router, which the gate exempts so that a
  password change stays reachable. The exemption is now the six paths an
  account with a temporary password actually needs.
- **Phase 3.** `GET /api/auth/status` reports `registrationOpen`,
  `localOwnerPresent` and `legacyTokenConfigured`, and `GET /api/auth/me`
  reports `via`. The environment `API_TOKEN` still works, still acts as the
  first admin, and now logs one deprecation warning at startup. It is removed
  in 3.0, and a personal token replaces it.
- **Phase 3.** Disabling an account ends its sessions at once and refuses its
  personal tokens while it is off. Enabling gives the tokens back. The
  sessions stay gone, because revoking one is a delete rather than a flag.
  Resetting a password revokes both.

- **Phase 2.** Every route that reads or writes owned data now filters by the
  account that asked, and the isolation matrix proves it for all eighty of
  them. A route that carries no test in that file fails the manifest check, so
  a new one cannot arrive unproven.
- **Phase 2g.** A data export contains the account's own rows, in every table
  it returns. Contacts, interactions, lists, list memberships, action items
  and the merge history each stop at the caller. One request used to return
  every account's data on the instance, which made the export the widest read
  in the app by a wide margin.
- **Phase 2g.** An export filename names the account it came from, as
  `contrack-export-<username>-<date>.json` and
  `contrack-contacts-<username>-<date>.csv`. Two people exporting on the same
  day used to download two files with the same name, and the second one
  replaced the first.
- **Phase 2g.** The trash is per account. Restore and purge answer `404` for
  a contact another account deleted, with the same body an id that never
  existed answers. The trash list holds the caller's own deleted contacts and
  nobody else's, and a mixed bulk restore brings back only the caller's rows
  and counts only those, keeping the `200` it has always answered because
  undo is forgiving by design.
- **Phase 2g.** The MCP surface answers for the account that asked. The
  contact query, the follow-up list, the tag and industry vocabularies, the
  interaction search and the whole-account timeline each read one account's
  rows. A personal API token acts as its own account here, exactly as a
  browser session does, so an MCP client reads the contacts of whoever issued
  its token and nobody else.
- **Phase 2h.** Both embedding backfills run one account at a time, inside
  that account's context, and accounts take turns in rounds of 200 contacts.
  A large account no longer holds up a small account's first results, and a
  provider call made from inside a backfill now names the account whose
  contacts it embedded rather than the instance's first administrator. No
  invocation row is written for an embedding yet, so nothing appears in the
  AI stats feed either way, but every path that reads the caller from the
  context gets the right answer.
- **Phase 2i.** `npm run lint` runs `tenant-lint --strict` over the whole of
  `server/`. Every SQL statement that reads an owned table either names the
  owner or carries a one-line reason why it does not.
- **Phase 2i.** The four single-column owner indexes are dropped on the next
  boot, as tenancy schema version 2. Each was the leading column of a
  composite index that answers the same query, so each cost a second B-tree
  write on every insert and gave the query planner a narrower index to prefer
  over the one the reads were built for.

- **Phase 2e.** A duplicate scan reads one account's contacts and finds one
  account's duplicates. Every stage is scoped: the normalized corpus, the five
  child-table loads behind it, the exact email, phone and name passes, the
  embedding neighbours, the co-occurrence and exclusion constraints, and the
  clusters the scan reports. Two people who share a name across two accounts
  are two people, and the scan can no longer suggest merging them into one.
- **Phase 2e.** Every merge checks that both contacts belong to the caller,
  in one statement, before it moves a single child row. A merge that names a
  contact the caller does not own answers `404`, with the same body an id that
  never existed answers, and nothing moves.
- **Phase 2e.** Suggestions, dismissals, exclusions and the merge log are per
  account. The review queue, the sidebar badge, the per-contact banner and the
  merge history each showed every account's rows. Undoing a merge works on the
  caller's own audit entries only.
- **Phase 2e.** A scan status page and its live stream answer `404` for a scan
  another account started. A scan record holds every cluster it found with the
  contacts hydrated inside it, so an id that leaked used to be a complete read
  of somebody else's duplicate list.
- **Phase 2e.** A full-mode scan clears its own account's dedupe vectors. It
  ran an unqualified delete before, so one person choosing "full" erased every
  other account's dedupe index and made their next scan pay a provider to
  rebuild it. Re-embedding changed contacts on a deep scan is scoped the same
  way, and the embedding coverage figure now describes the caller's own
  contacts rather than the instance.
- **Phase 2e.** One scan still runs at a time for the whole instance, and an
  account that arrives while the lock is held takes its turn instead of being
  turned away. Its scan starts on its own when the running one finishes.
- **Phase 2e.** **Breaking:** starting a scan while one is already running
  answers with the standard error envelope, `{ error: { code, message,
requestId, details } }` with code `RATE_LIMITED`, instead of a bare
  `{ error: "<message>" }`. `details.yours` says whether the caller is already
  scanning or somebody else holds the lock, and `details.queued` says whether
  a turn was booked. Any client reading `error` as a string must read
  `error.message` instead.
- **Phase 2f.** AI research batches belong to the account that started them.
  Polling a batch, opening its live stream, or cancelling it works for its own
  account and answers `404` for everybody else, with the same body an id that
  never existed answers. A batch refuses a contact the caller does not own
  before it spends a single token.
- **Phase 2f.** The five-minute research cooldown is per account. One person
  finishing a batch used to make everybody else on the instance wait. The
  single-batch run lock stays instance-wide, because the provider API key it
  protects is shared.
- **Phase 2f.** Starting a batch too soon now answers with the same error
  shape as every other endpoint, including a request id, and says whether the
  refusal is the caller's own cooldown or somebody else's batch holding the
  shared lock. It was the one endpoint that answered with a bare message.
- **Phase 2f.** The AI stats page counts the caller's own invocations, tokens
  and cost. It described every account's AI use before. The shared in-process
  cache counters stay, for an admin only, because they describe the instance
  rather than a person.
- **Phase 2f.** Editing a contact clears that account's cached AI work and
  leaves everybody else's alone. Every affected cache is keyed by account now,
  so one person adding a contact no longer costs every other account a fresh
  search, briefing and daily insight through a paid provider.

- **Phase 2c.** Search returns the caller's own contacts and nobody else's, in
  every channel. Keyword search, the semantic pipeline and its NDJSON stream,
  the executive brief, the hard filters behind a parsed query, and the trait
  boosts all read one account's rows. The keyword index carries an owner token
  and intersects it inside the index, so another account's contacts are never
  read and then dropped.
- **Phase 2c.** Vector search asks one account's partition. The nearest
  neighbour query fetched the instance-wide top hundred and filtered the
  result afterwards, so an account with a few hundred contacts on a large
  instance rarely appeared in that hundred and their vector channel returned
  nothing. This is a correctness fix before it is a speed one. The three
  duplicate-detection vector queries take the same predicate.
- **Phase 2c.** Cached search results are held per account. Reranked matches
  and the executive brief were cached under the query text alone, so the first
  account to search a phrase had its own contacts served to every other
  account that typed the same words for the next twelve hours.
- **Phase 2c.** The executive brief refuses a contact id the caller does not
  own with the same answer a deleted id has always taken.

- **Phase 2b.** Interactions, action items, and lists belong to the account
  that created them. Every timeline, briefing, attachment, follow-up task, and
  list endpoint reads and writes the caller's rows only. Another account's id
  answers `404` with the same body an id that never existed answers.
- **Phase 2b.** A note that mentions somebody now stays inside the writer's
  own contacts. Two paths handle mentions and both were open: the AI extractor
  matched a name against every contact on the instance, so a note could link to
  a stranger's row instead of creating a ghost, and the editor's own mention
  markup was inserted with no check at all, so any contact id in the request
  body was linked. The extractor matches the caller's contacts and creates a
  ghost the caller owns. The markup path drops any id the caller does not own.
- **Phase 2b.** Each account's lists number from zero. `sortOrder` came from
  the highest number on the instance, so a new account's first list started
  above every list stored on that box.
- **Phase 2b.** Removing a contact from a list and adding contacts in bulk now
  check both the list and the contact. Removing checked nothing at all, and
  bulk adding checked only the list. Reordering answers `404` when the request
  names a list the caller does not own, and keeps its `400` for a set of the
  caller's own lists that is not complete.
- **Phase 2d.** The dashboard, the daily insight, and the command palette
  zero-state count the caller's own contacts, interactions, follow-ups, and
  duplicate suggestions. Every number on those three screens described the
  whole instance before.
- **Phase 2d.** The daily insight is cached per account. One account's
  AI-written paragraph about their own network was cached under a key that
  described the instance, so whoever opened the dashboard first had their
  insight served to every other account for 24 hours. The cache now holds one
  entry per account.

- **Phase 2a.** Contacts belong to the account that created them. Every
  contact endpoint reads and writes the caller's rows only: the list, the map,
  the archive, the trash, one contact by id, the score breakdown, both bulk
  endpoints, avatar upload, and enrichment. Another account's id answers `404`
  with the same body an id that never existed answers, so the response cannot
  be used to find out which contacts exist. A bulk request that names another
  account's ids reports the number of the caller's own rows it changed.
- **Phase 2a.** Import-time duplicate matching stops at the importer's own
  contacts. Importing a file that happens to contain a name or an email
  another account already has no longer matches, merges, or files a
  suggestion against that account's contact.
- **Phase 2a.** Uploads are served to their owner only. A request for
  `/uploads/u/<ownerId>/...` answers `404` unless the caller is that owner.
  `/uploads/logos/` stays shared, and every other `/uploads` path answers
  `404`. The check is a comparison against the path, with no database read.

- **Phase 1, breaking.** Endpoints that manage the signed-in account refuse an
  API token with `403 SESSION_REQUIRED`. The code was `403 USER_REQUIRED`. The
  seven affected endpoints are under `/api/auth`: `GET /me`, `PATCH /me`,
  `POST /change-password`, `GET /sessions`, `DELETE /sessions`,
  `GET /session-policy`, `PUT /session-policy`. Nothing else changes, and a
  token still reaches every data endpoint. The rename is because every request
  now carries a user account, so "user required" said the opposite of what the
  gate checks: it wants a browser session, not merely a valid credential.
- **Phase 1.** Auth-off instances now have an account. Every instance gets a
  `local` account at boot that nobody can sign in to, and it owns this
  device's data. `GET /api/auth/status` reports it, so an ungated instance
  answers `authenticated: true` with a user instead of `null`. Securing the
  instance converts that account rather than creating a second one, so
  everything it already owns stays owned and nothing has to be claimed.
- **Phase 1.** Uploads live under `uploads/u/<ownerId>/avatars/` and
  `uploads/u/<ownerId>/files/`. Existing files move on the first boot and the
  stored URLs are rewritten to match. `uploads/logos/` stays shared. A file no
  row references moves to `uploads/orphaned/` and is logged. Nothing is
  deleted. The old flat URL now returns `404` for a file that moved.
- **Phase 1.** `GET /api/auth/status` reports `deviceContacts`, which is what
  `existingContacts` counted. Both names are sent for now so an older frontend
  keeps working; `existingContacts` goes away in Phase 3.
- **Phase 1.** Signing in to a disabled account returns `403 ACCOUNT_DISABLED`
  rather than succeeding. The check runs after the password, so a wrong
  password still gets the shared `401 INVALID_CREDENTIALS` and this cannot be
  used to find out which accounts exist. Disabling an account also ends its
  live sessions on their next request.
- **Phase 1.** Auth-off mode is refused when real accounts exist. The server
  logs an error at boot and enforces auth anyway, because with a second
  account there is no answer to "who is the caller with no credential".

- **Phase 0.** CI now runs for the `v2.0` integration branch. Pull requests
  into `v2.0`, and pushes to it, run the `build-and-test` job. The container
  image job and the release job still run only for `main` and for version
  tags, so `v2.0` publishes nothing.

### Added

- **Phase 1.** Every row in every owned table has an owner, enforced by
  triggers rather than by convention. Eight tables carry `ownerId` now:
  `contacts`, `lists`, `interactions`, `action_items`, `dedupe_suggestions`,
  `dedupe_exclusions`, `dedupe_merge_log` and `ai_invocations`. An insert with
  no owner is refused on the four that have no parent contact, and filled from
  the contact on the four that do. A child row whose owner disagrees with its
  contact is refused, which is what makes a cross-owner duplicate suggestion
  impossible rather than merely unlikely.
- **Phase 1.** The upgrade takes a full copy of the database first, with
  `VACUUM INTO`, into `backups/pre-tenancy-<stamp>.db`. The copy is made before
  any schema change, so restoring it puts the instance exactly back. It is
  skipped with an error in the log when free space is under 1.5 times the
  database size, rather than failing the boot. `backupService` never rotates
  it away, so delete it by hand once the upgrade is trusted.
- **Phase 1.** `npm run tenancy:verify` checks an upgraded instance: no
  unowned rows, every child owner matching its contact, the search index
  complete and correctly tokenized, both vector stores partitioned with no
  orphans, no uploads left at the old paths, and all 27 triggers present.
- **Phase 1.** `scripts/tenancy-rollback-uploads.mjs` moves uploads back to
  the 1.x layout, for a downgrade after restoring the backup.
- **Phase 1.** Vector search is partitioned by owner. Both `vec0` tables gain
  `ownerId TEXT PARTITION KEY`, and existing vectors are copied into the new
  shape rather than recomputed, so upgrading spends nothing with an embedding
  provider. The boot refuses to start on a sqlite-vec below 0.1.6, which is
  where partition keys were introduced.
- **Phase 1.** Per-user API tokens (`ctk_...`) are recognized. Only the
  SHA-256 is stored. A revoked token, an expired one, and one belonging to a
  disabled account are all refused. Phase 3 adds the endpoints that create
  them.

- **Phase 0.** New rows carry their owner. On an instance with
  `AUTH_REQUIRED=true`, a contact, a bulk import, a list, a ghost contact from
  an `@mention`, an AI invocation and a merge log row are all stamped with the
  signed-in user's id as they are written. This starts working without a
  restart. Anonymous instances still write no owner and are unaffected.
- **Phase 0.** A benchmark script, `scripts/bench-tenancy.ts`, to measure
  query and mutation latency under multi-tenant scoping.
- **Phase 0.** A route manifest at `server/tenancy/routeManifest.ts` names
  every route and what guards it. A test compares it against the routes the
  app really registers, so a new route cannot ship unclassified. The route
  list is recorded while the app builds, because Express 5 keeps no mount
  path strings.
- **Phase 0.** `scripts/tenant-lint.mjs` reports SQL over owned tables that
  carries no owner predicate. `npm run lint` runs it in strict mode
  to ensure all queries touching owned tables carry an owner predicate.
- **Phase 0.** The request context, `server/tenancy/scope.ts` and
  `server/tenancy/requestContext.ts`. A request now carries who is asking
  through the async call tree, which later phases use to stamp ownership.
  Nothing reads it on the data path yet, so behavior is unchanged.
- **Phase 0.** A unit test pins the BM25 weighting rule. `bm25()` reads its
  weights by column position and counts `UNINDEXED` columns, so
  `contacts_fts` needs one weight per column and `contactId` needs a zero.
  Search ranking does not change, because the offset this guards against was
  already corrected in 1.5.5. Phase 1 adds two more columns to that table,
  and this test fails if the weight list is not extended with them.

### Fixed

- **Phase 2g.** The MCP contact query no longer answers with rows the app
  hides. It had no trash filter, no ghost filter and no merged-away filter, so
  an MCP client saw people the user had thrown away, the placeholder rows a
  mention creates, and the losing side of every merge. An agent acting on a
  merged id wrote an interaction onto a record the app never shows again.

- **Phase 2h.** A duplicate scan embeds its own account's contacts. It called
  the instance-wide backfill in the middle of a scan, so one person pressing
  "scan" paid a provider to embed every other account's contacts, and a
  full-mode scan that had just cleared its own vectors refilled everybody's.

- **Phase 2i.** `tenant-lint --strict "server/**/*.ts"` covers files that sit
  directly in `server/`. `**` matched one or more directories, so
  `server/db.ts` fell outside every strict glob used, and the
  fourteen boot statements in it were never checked.

- **Phase 2a.** The migration test's second-boot check no longer depends on
  the clock. It compared `updatedAt` against the fixture, which the legacy
  follow-up backfill legitimately moves on one contact during the first boot,
  so the test failed whenever the fixture build and that boot landed in
  different seconds. It now compares against the state the first boot left.

- **Phase 1.** Upgrading no longer re-embeds the whole contact list through a
  paid provider. Two bulk writes during the migration stamped `updatedAt` on
  every row they touched, and the deep dedupe scan re-embeds any contact whose
  `updatedAt` is newer than its last embedding. The ownership claim now runs
  with the seventeen affected triggers dropped, and the uploads relocation runs
  in the same window. Measured on 5,000 contacts: the claim stamped all 5,000
  before, and none after.

- **Phase 0.** `GET /api/contacts/action-items` works again. `contactsRouter`
  mounted before `mcpRouter`, so `GET /contacts/:id` captured `action-items`
  as a contact id and answered `404`. The route was unreachable, so no
  working client changes behavior. The MCP router now mounts first.

## [1.5.5] — 2026-08-09

Corrections from an independent review of the v1.5.4 release, run with fresh
context specifically to catch what the author could not see in their own
work. It caught one real regression — proven live before the fix shipped.

### Fixed

- **v1.5.4's docker-compose file silently disabled scheduled backups.** The
  new env passthrough rendered an absent `BACKUP_INTERVAL_HOURS` as an empty
  string — set, but empty — and the schedule guard's `!== undefined` check
  read that as an explicit `0`: disabled. Any Compose user upgrading through
  v1.5.4 lost the default 24-hour snapshots without a word (our own
  deployment included, which is how the finding was confirmed). Empty now
  means unset; only an explicit `0` disables. All eight forwarded variables
  were audited for the same trap — this was the only one using a presence
  check — and a regression test pins the exact empty-string shape Compose
  sends.
- **Seeding a brand-new data directory failed** with "no such table" — the
  seed scripts opened a private connection before any migration ran. They
  now use the server's own database module, which migrates on import.
  Verified: fresh empty `DATA_DIR` → first run inserts, second run skips.
- **The SSRF guard missed private addresses wrapped in IPv6.** It knew three
  hardcoded `::ffff:` prefixes; `::ffff:169.254.169.254` (cloud metadata),
  CGNAT, `172.16/12`, and NAT64 (`64:ff9b::`) wrappings all walked past it.
  The gap predates 1.5.4, but the connect-time rebinding guard added there
  leans on this function. Any IPv6 address embedding an IPv4 — dotted or
  hex-group form — is now judged by the full IPv4 policy, block and pass
  cases pinned in tests.
- The scripts table in getting-started still claimed `npm run seed` clears
  the database — the one line the docs audit missed. The table now matches
  the code and lists the scripts CI actually enforces.

## [1.5.4] — 2026-08-09

The clone-and-host release. Four independent verification passes — a clean-
clone install test, a full Docker hosting pass, an adversarial review of every
change since 1.5.3, and a docs-vs-reality audit — ran against this tree, and
everything they found is fixed here. The result: `git clone`, one command, and
a running instance, with an API key, a self-hosted OpenAI-compatible endpoint,
or no AI at all.

### Added

- **A fresh clone installs again.** `npm install` failed outright with an
  ERESOLVE peer conflict — `eslint-plugin-jsx-a11y` (at its latest, 6.10.2)
  declares peer support only through eslint 9 while the project uses
  eslint 10. The Dockerfile and CI already passed `--legacy-peer-deps`;
  humans following the README had no such luck. A committed `.npmrc` now
  makes `npm install` and `npm ci` work exactly as the docs write them.
- **A prebuilt-image quick start.** CI has published multi-arch images to
  `ghcr.io/arvarik/contrack` all along; the README finally says so, with a
  one-command `docker run` that skips the from-source build entirely.
- A "Running as a Service" section in the configuration guide: `/healthz`,
  the Docker HEALTHCHECK, SIGTERM drain semantics, the 65-second keep-alive
  and why it matters behind a proxy, and what the production CSP will block.
  The API reference now documents `/healthz`, the 1 MB body limit with its
  single 50 MB exemption, the true pre-auth surface, and fourteen endpoints
  that existed only in code.

- **The process now survives `docker stop`.** SIGTERM/SIGINT drain in-flight
  requests, close SQLite with its WAL checkpoint, and exit 0 — previously the
  process rode Docker's grace period into a SIGKILL on every stop, closing the
  database uncleanly each time. An 8-second internal deadline keeps a hung
  handler from reaching the SIGKILL anyway.
- **`/healthz` and a Docker HEALTHCHECK.** The probe lives outside the auth
  gate (a health check holds no credential), proves both the event loop and
  SQLite answer, and reports nothing else. Docker can now see a process that
  is alive but wedged; `restart: unless-stopped` only ever noticed dead ones.
- Boot failures exit non-zero with a log line naming startup;
  `unhandledRejection` logs with the stack instead of crashing bare;
  `uncaughtException` closes the database before exiting.

### Fixed

- **The seed scripts wrote to the wrong database on any `DATA_DIR` install**
  (Docker included): both hardcoded `curator.db` in the working directory
  while the server reads `$DATA_DIR/curator.db`. Seeding a Docker instance
  created a stray database the app never opens. Both scripts now resolve the
  path exactly as the server does.
- **The configuration guide told Docker users to mount the project root** as
  their persistence volume — advice that would shadow the built app and
  `node_modules` inside the image and break the container. It now says what
  `docker-compose.yml` actually does: mount `/app/data`, which holds the
  database, uploads, backups, and the embedding-model cache, and is the
  entire persistence story.
- **Seeding docs described a destructive import that never existed.**
  `npm run seed` inserts one example contact and skips a non-empty database —
  it deletes nothing, ever. The "~50 demo contacts" (actually ~30, from
  `npm run db:seed`) and the false "seeding clears the existing database"
  warning are corrected everywhere.
- **An OpenAI- or Anthropic-only install booted to a false alarm.** Startup
  validated only the key matching `AI_PROVIDER` (default `gemini`), so a
  working OpenAI-only setup was greeted with "GEMINI_API_KEY is not
  configured — AI features will fail gracefully", which was simply untrue.
  Boot now reports the providers actually configured, and with none it says
  what to do (Settings → AI) instead of implying something is broken.
- `docker-compose.yml` forwarded only eight environment variables, so a
  documented setting like `BACKUP_KEEP=30` in `.env` was silently ignored on
  the Docker path. The optional tuning variables now pass through.
- `APP_URL` was documented in two places and read by zero lines of code —
  removed from the docs and `.env.example`. `DISABLE_BACKGROUND_JOBS`,
  `NODE_ENV`, and the configurable session lifetime were the reverse (real
  behaviour, documented nowhere) and are now in the reference.
- The README's two contradictory test counts (474 in the badge, "180 tests,
  <600ms" in the table) both now reflect the real suite, and the Vite config
  no longer triggers a loader warning on every boot (`__dirname` in an ESM
  config, replaced with `import.meta.dirname`).

- **Swipe-merge stayed blocked after confirming a large cluster.** The drag
  handler captured the confirmation flag once and never saw it change — a
  stale closure the exhaustive-deps burn-down surfaced. The merge buttons
  worked; the swipe silently did not.
- The scroll-position save on unmount read a ref React had already cleared,
  so leaving a list mid-scroll saved nothing and the position restored stale.
- The command palette re-bound its document key listener on every keystroke
  (the action list was rebuilt each render into the handler's dependency
  list), and the AI-result array was minted fresh per render into a memo.

- **A DNS-rebinding hole in the outbound fetch guard.** The SSRF check
  resolved a hostname, validated the address, and then `fetch()` resolved the
  same name again to dial — two queries a hostile DNS server answers
  differently, passing the check with a public address and serving the
  connect `127.0.0.1`. Validation now runs inside the resolver the socket
  actually uses, checks every address in the answer, and fails closed on a
  public/private mix.
- **Every route accepted a 50 MB body**, unauthenticated ones included — a
  limit sized for bulk import, inherited globally. The default is now 1 MB
  with the import route exempt, and an over-limit body answers a clean
  `413 PAYLOAD_TOO_LARGE` instead of a stack-logging 500.
- The SPA fallback answered every HTTP method with `index.html` — a POST to a
  mistyped path returned 200, which reads as success to a script. Navigation
  is GET/HEAD; everything else now 404s.
- Node's 5-second keep-alive default sat below every reverse proxy's reuse
  window, surfacing as sporadic 502s. Now 65 seconds.

### Changed

- Every response carries `X-Content-Type-Options: nosniff` (previously
  `/uploads` only), `X-Frame-Options: DENY`, and a referrer policy. Production
  adds a CSP with `script-src 'self'` — the built `index.html` has no inline
  script, which is what makes the strict policy possible.
- **`aiService.ts` (1,557 lines, four unrelated domains) is now five domain
  modules** — contact parsing, relationship intelligence, mentions, search
  intelligence, shared helpers — behind the same import path, so no call
  site changed.
- **One schema translator serves all three AI adapters.** The three copies
  had drifted; the OpenAI/compat copy dropped a nullable object's properties
  outright. The dialect differences (nullable form, object sealing) are now
  two documented options, and the trap is closed with a test on it.
- The four SQL statements on the per-request auth path are compiled once at
  module load instead of per call (measured ~6× per statement), matching the
  repository's existing convention. `PRAGMA optimize` now runs daily and on
  shutdown.
- `react-hooks/exhaustive-deps` is an error now that its count is zero —
  all 14 warnings reviewed and fixed individually, per the config's ratchet
  policy.

## [1.5.3] — 2026-08-09

A self-hosted release. The headline fix is that a local model server connected
through Settings → AI now actually answers requests; the rest is a sweep of
readability and clarity work across the UI, and the end of a long-running test
flake.

### Fixed

- **A custom OpenAI-compatible endpoint failed every AI request while
  appearing correctly connected.** Adding an Ollama, vLLM, or LM Studio server
  and leaving the capabilities on **Automatic** — which is what you get by
  adding an endpoint and changing nothing else — resolved to the endpoint but
  named no model, and the compat adapter refuses to be called without one. The
  result was `a model must be selected for OpenAI-compatible endpoints` on
  every Magic Paste, mention, or summary, from a settings page reporting the
  endpoint as connected.

  The three built-in providers map a capability onto a model themselves, so
  Automatic passes them no model on purpose. A compat endpoint has no such map,
  so Automatic now names one: the first chat model in the catalog discovered
  from the endpoint. Quick and Deep get the same model, because nothing in the
  OpenAI-compatible model list says which of yours is the cheaper one and
  guessing from model names would be a judgement the user cannot see — pin them
  separately if you run both a small and a large model.

  When discovery found no chat model there is nothing to call, so Automatic now
  skips the endpoint and the capability reports itself unavailable naming the
  endpoint and the fix, instead of failing later with a message about model
  ids.

- **Settings → AI listed every custom endpoint twice**, and the second copy
  carried a "remove" button that removed nothing: it deleted from the
  provider-key store, where an endpoint has no entry, then reported success.
  Endpoints now appear once, in their own section, which is also where their
  discovered model count, discovery errors, and a refresh button now live.

- **A capability pinned to a deleted provider kept pointing at it.** Quick,
  Deep, and Research fall back to Automatic with a warning, but Embeddings
  resolved straight to the dead provider and every embed threw — semantic
  search and duplicate detection stopped working with nothing in the UI to
  explain why, because the pin still looked valid. Removing a provider or an
  endpoint now returns anything pinned to it to Automatic.

- Saving a provider key or an endpoint that then fails its connectivity check
  left the settings list stale. The credential is stored before it is
  validated — deliberately, so a typo does not cost you the key you just typed
  — so the failed save had still changed the page.

- **The duplicate badge counted the wrong thing.** It read pending _pairs_
  while the review queue groups pairs into clusters, because (A,B) and (B,C)
  are one problem with three people rather than two problems. The badge
  promised 7 and the page showed 3.

- The bulk selection toolbar was 80% transparent, so the contact list showed
  through the controls that archive and delete in bulk. The map opened centred
  on longitude 0, putting the Atlantic in the middle, and left empty background
  above and below the world on a tall window. The AI usage feed's separators
  referenced a colour token that did not exist, so Tailwind dropped the class
  and they rendered in near-black.

- An un-researched contact's Dossier tab was blank — every section in it is
  conditional. It now says what a dossier holds and links to Contact
  Enrichment.

- Five of the fourteen AI cache tiers and operations had no display name, so
  the tier table and activity feed printed raw keys like `queryParse` beside
  properly named rows. All fourteen now have a name and an explanation of what
  the tier caches.

- Startup logged both vector stores at their creation width — 768 for
  `contact_embeddings`, 384 for `search_embeddings` — regardless of what they
  actually held. Those literals only apply to a fresh database; choosing a different
  embeddings model rebuilds the tables at that model's width. Vector width is
  the first thing you check when embeddings misbehave, so a hardcoded number
  there is worse than no number. Both lines now read the width back from the
  table.

- **CI's image-architecture check could only ever fail.** It grepped the raw
  manifest for `"architecture":"amd64"`, but current buildx pretty-prints
  `--raw`, so the compact-JSON pattern never matched and `merge-image` reported
  a missing platform on every push while publishing a perfectly good
  two-architecture image. Parsed with `jq` now, filtered to `os == "linux"` so
  the per-platform provenance attestations are not counted as platforms.

- **The integration suite's long-running flake is fixed at the source.**
  `request(app)` makes supertest bind a fresh HTTP server and tear it down for
  every single request — roughly 500 listen/close cycles a run. Ephemeral ports
  recycle faster than closed sockets leave `TIME_WAIT`, so a new server
  occasionally inherited a port a previous connection was still addressing and
  a request was answered by the wrong socket. The symptom was a status the
  route cannot produce: a 404 from a registered path, a 403 from a router with
  no 403 in it, a 401 on an un-gated instance — each one an invitation to audit
  auth code that was never involved.

  Each test file now listens once and every request goes to that server, which
  removes the recycling. Measured at roughly one failed run in six before, and
  none in thirty after; the `retry: 2` that had been absorbing it is gone, so
  the suite reports instability instead of hiding it.

### Added

- **The health score explains itself.** Clicking the badge on the Pulse
  at-risk list breaks the number into its five signals with the measurement
  behind each — "last contact 200 days ago, against a 90-day cadence" rather
  than "42". A score attached to a person is a judgement, and one you cannot
  interrogate is one you either over-trust or ignore.
- **Settings has a filter.** Five groups and a dozen destinations is past where
  scanning beats typing. Items match synonyms too, so "logout" finds Account
  and "bin" finds Trash.
- **Shift-click selects a range and Cmd/Ctrl+A selects everything visible.**
  Ranges add rather than toggle — shift-clicking across selected rows and
  having them flip off is never what "select from here to there" means. The
  shortcut is ignored while focus is in a field.
- **Session lifetime is configurable** (1 day to 1 year, presets in Settings →
  Account) rather than fixed at 30 days. It applies to new sign-ins only, which
  the card says out loud, because someone shortening it to lock out a lost
  device would otherwise believe they had.
- A tooltip on every AI cache tier explaining what it caches and what a hit
  saved. It opens on click as well as hover, because neither hover nor the
  `title` attribute exists on a phone.
- An end-to-end test suite for compat endpoints, running against a stub server
  that speaks the OpenAI wire format. It covers the case the bug above lived
  in — an install whose only provider is a custom endpoint, with everything on
  Automatic — through the real adapter, real base-URL handling, and real model
  discovery.

### Changed

- Duplicates now leads the Organize group, ahead of Lists. It is the one
  destination there with work queued behind it, and a queue nobody sees is a
  queue nobody clears.
- Sign-out lives only on Settings → Account. Two doors to the same action is
  one more than it needs.
- The empty Network view leads with Import rather than "Add contact". Nobody
  builds a personal CRM by typing four hundred people in by hand.
- The first-run setup screen names how many contacts are waiting and states
  they will be assigned to the account being created; the sign-in screen now
  distinguishes an expired session from an ordinary visit.
- The active letter on the alphabet rail is marked on the rail itself. The
  floating marker it replaces covered contact names.

## [1.5.2] — 2026-08-07

### Added

- **Accounts replace the access token.** A gated instance now shows a one-time
  setup screen that creates your account (email + username + password), then a
  real sign-in screen. Sessions are server-side rows lasting 30 days, so
  signing out actually ends the session and "sign out other devices" works.
  Settings → Account holds your profile, password, and the list of devices
  you're signed in on; the sidebar gets a sign-out button.

  Passwords use scrypt (N=2^16, r=8, p=1) from `node:crypto` — no new native
  dependency. Cost parameters are stored inside each hash, so raising them
  later upgrades passwords silently on next sign-in. The session cookie holds a
  random secret and the database stores only its SHA-256, so neither the
  database nor one of the rotating backups yields a live session.

  Existing data is not disturbed: everything already in the database is
  assigned to the account you create. There is no reset email — this is
  self-hosted with no mail server — so
  [Configuration](docs/configuration.md#authentication--remote-access)
  documents the recovery procedure.

- **`ownerId` on `contacts`, `lists`, `ai_invocations` and `dedupe_merge_log`**
  — every table not reachable from `contacts` through a foreign key. Nothing
  filters on it yet; it exists so that adding multi-tenancy later is "scope the
  queries" rather than "scope the queries AND migrate live data". `NULL` means
  "belongs to whoever owns this instance", which is every row until an account
  exists. `ON DELETE RESTRICT`, so a stray `DELETE FROM users` fails loudly
  instead of taking the contacts with it.

- **Provider contract tests** (`npm run test:contract`) — a suite that calls
  real provider APIs to verify the things a mocked test cannot: that
  `listModels` speaks the shape we parse, that structured output returns
  parseable JSON, and that `embed` returns one vector per input. Both provider
  bugs found in 1.4.0 were wire-format mismatches invisible to mocked tests, and
  one of them had a green unit test asserting the wrong shape.

  Not part of CI and not required for development. Each provider block skips
  itself when its credential is absent, so `npm test` remains key-free and
  contributors with a single key exercise only that provider.

### Changed

- **`AUTH_TOKEN` is now `API_TOKEN`**, and means something narrower: the
  credential for scripts, cron jobs and MCP clients, sent as
  `Authorization: Bearer`. People sign in with an account instead. The old name
  still works with a deprecation warning at startup. `AUTH_REQUIRED` keeps its
  name and its `false` default, in Docker as well as locally — the server warns
  at startup when it binds a non-loopback address with auth off.

- Settings → AI now says _why_ a capability is unavailable and what to do about
  it, instead of "nothing available". A self-hosted setup is told that research
  runs through SearXNG — which is accurate, since enrichment works through
  SearXNG even though no provider resolves for the capability.
- Pinning an embeddings model now probes it first and refuses the assignment if
  the provider cannot actually produce a vector. Compat servers advertise bare
  model ids, so embedding capability is guessed from the name; a model that
  looks right on a server without `/v1/embeddings` previously saved a pin that
  silently left the vector store on the old model.

### Fixed

- **Settings → AI reported embeddings as unavailable when it was working.** The
  view resolved every capability except embeddings, so the Auto row rendered an
  amber "nothing available" against a capability served correctly by the
  built-in local model. It now reads "Built-in local model · 384-dim".
- **OpenAI structured output was rejected outright.** The adapter sent
  `strict: true`, which requires `required` to list every key in `properties` —
  but Contrack's schemas have genuinely optional fields (a contact has a name;
  it may not have a company). Every schema-constrained OpenAI call failed with
  `400 Invalid schema for response_format`. As with the Anthropic bug, a unit
  test asserted the broken shape and stayed green. Found by the contract suite
  on its first run against a working key.
- **Changing the embeddings model left the dedupe index at the old width.** The
  settings route rebuilt only the search store, so `contact_embeddings` stayed
  at 384 while new vectors were 1536 and every insert failed with
  `Expected 384 dimensions but received 1536` until the process restarted. Both
  stores now rebuild together, with an integration test asserting they stay the
  same width.
- Contract tests no longer fail on a credential the provider rejects. A stale
  `OPENAI_API_KEY` exported globally for an unrelated tool — common on a
  developer machine — turned the suite red for someone who never meant to test
  that provider. Credentials are probed once up front: rejected ones skip with
  the reason, and only a real adapter fault fails.
- The integration suite no longer makes outbound network calls. Two tests
  stored a key for a built-in provider, which reached the real vendor to
  validate it — the only flaky tests in the suite. They now use a custom
  endpoint pointed at a closed port, which fails immediately and
  deterministically; real provider behaviour is covered by the contract suite.

## [1.4.0] — 2026-08-05

Contrack no longer asks you to pick "an AI provider". You connect whichever
services you have keys for, and each kind of work is routed to a suitable
model. One API key is still all you need — everything else is optional.

### Added

- **Capability-based AI configuration.** Four independent settings — Quick
  tasks, Deep tasks, Embeddings, and Web research — each resolved from
  Settings → AI, an environment variable, or automatically. Providers are no
  longer mutually exclusive; connect several and mix them across tasks.
- **Model discovery.** Saving an API key queries the provider's list-models
  endpoint, which validates the credential and fills the model dropdowns, so
  new releases appear without a Contrack update. Cached 24h, refreshable on
  demand, and populated in the background at startup. Gemini and Anthropic
  report capabilities directly; OpenAI-shaped servers are inferred from the
  model name and marked as guessed.
- **Custom OpenAI-compatible endpoints.** One adapter for Ollama, vLLM, LM
  Studio, llama.cpp, OpenRouter, xAI, DeepSeek, and Mistral — configured with
  a base URL and optional key. Structured output is negotiated per model
  (`json_schema` → `json_object` → prompt) and the working mode is remembered.
- **Self-hosted web research via SearXNG.** Point Contrack at a SearXNG
  instance to enrich contacts from the live web with no cloud provider. With a
  local chat model and the built-in embeddings, the entire AI stack can run on
  your own hardware.
- **Per-task model overrides:** `AI_QUICK_MODEL`, `AI_DEEP_MODEL`,
  `AI_RESEARCH_MODEL`, and `AI_EMBEDDINGS_MODEL`, each accepting `model` or
  `provider:model`. Intended for declarative deployments; a pin made in
  Settings takes precedence.

### Changed

- **`.env.example` rewritten in tiers** — one key at the top, everything else
  optional and commented out. Previously it framed keys as conditional on
  `AI_PROVIDER`, implying you had to choose a provider before anything worked.
- **`AI_PROVIDER` is now only the Auto preference.** It selects which provider
  Auto favours when several keys are present, and does nothing with one key.
  Existing deployments are unaffected.
- **Settings → AI collapses to a single line** ("All tasks → provider, chosen
  automatically") with per-task controls behind a disclosure that opens
  automatically when anything is pinned.
- **Duplicate-detection embeddings now follow the Embeddings setting**, and
  default to the built-in local model. They previously called Gemini directly
  regardless of the setting, so choosing a local model still sent every
  contact to Google.
- Magic Paste output is now sanitized before it reaches a contact record —
  length caps, control-character stripping, injection-echo rejection, and URL
  validation.

### Fixed

Two of these affect data written by v1.3.0. If you ran that version, the
indexes below repair themselves automatically on first start.

- **Gemini embeddings returned one vector per batch instead of one per
  contact.** `contents: string[]` reads as a single Content with many parts,
  so each batch collapsed into one vector and the rest were silently dropped.
  Switching the Embeddings setting to a Gemini model left the semantic index
  almost entirely empty while reporting success.
- **Duplicate-detection embeddings had the same defect**, plus a backfill that
  only ran when the store was completely empty — so a partial index could
  never repair itself. On a 431-contact database it held 5 rows. Duplicate
  matching has been running without the semantic signal it was designed
  around. Restoring it raises match scores but crossed no auto-merge
  thresholds in testing (0 of 381 candidate pairs).
- **Anthropic structured output was broken entirely.** `output_config.format`
  takes the schema directly, but Contrack sent OpenAI's nested `json_schema`
  wrapper, so every JSON operation on Anthropic failed with a 400. Only
  text-only calls worked. Claude also caps schemas at 24 optional parameters,
  which the research schema exceeds; that case now falls back to
  prompt-guided JSON instead of failing.
- A provider returning fewer embeddings than inputs is now a hard error rather
  than a silently short batch, and the backfill refuses to write a partial
  index.
- OpenAI-compatible backends that return `200 OK` with a non-JSON body now
  trigger the structured-output downgrade, not just those that reject the
  format outright.
- Reasoning models (gemma-4, QwQ, DeepSeek-R1) that spend their whole token
  budget on `reasoning_content` now report that explicitly instead of
  surfacing as "malformed JSON".
- `data/` is excluded from version control — it holds the auth token,
  uploads, and backups.
- **Container images are now published for `linux/arm64` as well as
  `linux/amd64`.** Previous releases were amd64-only, so Apple Silicon and ARM
  homelab hosts could not pull them at all.

## [1.3.0] — 2026-08-04

### Added

- Trash view in Settings for restoring or permanently deleting contacts.
- Data lifecycle: soft-delete with retention purge, scheduled SQLite
  snapshots, and full JSON/CSV export.
- Single-user authentication (`AUTH_TOKEN` / `AUTH_REQUIRED`) with an
  HttpOnly cookie and bearer-token support for scripts.

### Changed

- TypeScript `strict` mode enabled across the codebase with real lint
  enforcement in CI.
- Integration tests run HTTP routes against a real SQLite database.
- Heavy startup work moved off the request thread.
- Documentation refresh and release-pipeline improvements.

### Fixed

- Prompt-injection hardening across the AI pipeline: untrusted content is
  fenced and model output is validated before it can be written.
- Soft-merged contacts no longer leak into contact lists.

## [1.1.0] — 2026-08-03

### Added

- Lite-tier model integration and an enhanced hybrid search pipeline.

## [1.0.0] — 2026-08-03

Initial release: local-first AI-powered personal CRM with contact
management, semantic search, AI enrichment, and duplicate detection.

[unreleased]: https://github.com/arvarik/contrack/compare/v1.5.5...HEAD
[1.5.5]: https://github.com/arvarik/contrack/compare/v1.5.4...v1.5.5
[1.5.4]: https://github.com/arvarik/contrack/compare/v1.5.3...v1.5.4
[1.5.3]: https://github.com/arvarik/contrack/compare/v1.5.2...v1.5.3
[1.5.2]: https://github.com/arvarik/contrack/compare/v1.4.0...v1.5.2
[1.4.0]: https://github.com/arvarik/contrack/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/arvarik/contrack/compare/v1.1.0...v1.3.0
[1.1.0]: https://github.com/arvarik/contrack/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/arvarik/contrack/releases/tag/v1.0.0
