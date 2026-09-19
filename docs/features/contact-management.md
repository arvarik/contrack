# Contact Management

Contrack's contact management system handles everything from manual entry to AI-powered parsing of unstructured text, with a rich timeline for tracking every interaction.

## Creating Contacts

### Manual Entry

Click the **+** button or press `c` on the contact list to open the new contact form. Fill in any combination of fields — only the name is required. The system auto-generates:

- First/last name split
- FTS5 search index entry
- Doc2Query search expansion terms (async, via AI)
- Local embedding for semantic search

### Magic Paste (`v` key)

Press `v` on the contact list (or use the paste button) to open the Magic Paste modal. Paste any unstructured text — meeting notes, email signatures, LinkedIn bios — and the AI extracts a structured contact:

> "Met Jane Smith at the TechCrunch event. She is VP of Engineering at Acme Corp. jane@acme.com, (415) 555-1234."

→ Parsed into: **Jane Smith** | VP of Engineering | Acme Corp | jane@acme.com | +14155551234

The parsing uses the active AI provider (`POST /api/parse-contact`).

<!-- Screenshot: magic-paste.png -->

### Import (CSV, vCard, EML)

Access via the import button on the contact list, or through **Settings → Import** (`/settings/import`), which provides an inline import workbench and displays recent imports with status, counts, and retry options for failed rows. Supports:

- **CSV files** — Automatic column mapping with header detection
- **vCard (.vcf)** — The format Apple Contacts, Google Contacts, Outlook and
  every phone export. Long lines are unfolded, quoted-printable is decoded, and
  both spellings of a parameter are understood, so a file from an older Android
  or Outlook arrives with its accents and its labels intact
- **EML files** — Email message parsing

The import pipeline runs in 4 SSE-streamed phases:

1. **Importing** — Creating contact records
2. **Embedding** — Generating contact fingerprints for deduplication
3. **Scanning** — Checking for duplicates against existing contacts
4. **Summary** — Final counts (imported, auto-merged, needs review, new unique)

<!-- Screenshot: import-modal.png -->

### Export (vCard, CSV, JSON)

**Settings → Export.** Three formats, because they answer
three different questions:

- **vCard (.vcf)** — another address book. The only format that also comes back
  in, and the same module writes and reads it, so a file exported from Contrack
  and imported into it again is the same contacts rather than nearly.
- **CSV** — a spreadsheet. Flat by definition: three emails become one cell.
- **JSON** — Contrack itself. Contacts, interactions, lists, action items and
  the merge log. Nothing else can rebuild the instance.

Each downloads only the contacts of the account that asked. Trashed contacts
and ghosts are left out of the vCard: one is a contact somebody deleted, the
other is a name pulled out of a note with no card to write.

---

## Network Header and Start Panel

The Network view (`/`) provides a clear, accessible header for search, sort, and contact operations, paired with a rich start panel on desktop viewports when no contact is selected.

### Header Controls

```
Desktop:
Network                              [ Select ] [ Import ] [ + New ▾ ]
[ 🔍 Search...                                        ] [ Sort ▾ ]
[ All 30 ]  <- only when at least one list exists

Phone:
Network                                  [ ▢ ] [ ⭳ ] [ + New ▾ ]
[ 🔍 Search...                                        ] [ Sort ▾ ]
```

1. **Select**: Toggles multi-selection mode. When active, the header displays the count of selected contacts (for example, "3 selected"), along with "Select all" and "Done" buttons. The floating bulk action toolbar appears at the bottom with options to archive, delete, add to list, edit fields, assign colors, or export CSV. On touch screens, long pressing any contact row also enters selection mode.
2. **Import**: Opens the contact import dialog directly from the network header. On screens below 768 px, this renders as a 44 px touch target with an upload icon and accessible name.
3. **+ New ▾**: An ActionMenu dropdown providing quick access to create a single contact, add from text via smart paste, or create a new list. The "+ New" text and caret remain visible across desktop and phone screens.
4. **Sort menu**: An ActionMenu button whose trigger label reflects the current sort choice. Offers five explicit sorting choices: Name A to Z, Name Z to A, Newest first, Oldest first, and Score. The active choice is marked with a checkmark. Initialized from the `listSort` account preference, and selections persist for the browsing session.
5. **List filter row**: The horizontal scrolling pill bar appears only when at least one contact list exists. When no lists exist, the filter row is hidden to keep the header clean and compact.

### The Start Panel

When no contact is selected on desktop, the right pane displays the Start Panel (`src/components/layout/StartPanel.tsx`) rather than an empty placeholder.

- **Header**: Features the Corvid mark at 64 px with "No Contact Selected" and guidance text.
- **Up next**: Displays the top 3 actionable items from the Pulse queue (`buildUpNextQueue` in `src/views/pulse/lib/upNext.ts`) rendered with `ActionRow`. Supports checking off items, snoozing, or logging quick notes. Shows an accessible empty state ("Nothing due") when all follow-ups are clear.
- **Recently viewed**: Displays recently visited contacts from `useRecentContacts` with avatar score rings, contact names, and roles or companies, linking directly to each profile. Shows an accessible empty state when no contacts have been viewed in the session.
- **Add people**: Provides dedicated action cards for Import, New contact, and Add from text.
- **Accessibility**: Each column is rendered as a labelled landmark region (`aria-label="Up next"`, `aria-label="Recently viewed"`, `aria-label="Add people"`) with strict `h2` and `h3` heading hierarchy.

---

## Contact Profile

Each contact has a profile page. The page has two layouts. The width of the contact's own pane chooses the layout, not the width of the window.

- **Wide** (the pane is 768 px or wider): the header sits on top. Under it, the Details card is a column on the left, and a **Timeline** and **Dossier** control is on the right. The Details column stays in view while you scroll, when it fits the window. A taller column scrolls with the page, so its last field stays in reach.
- **Narrow** (a phone, or a pane under 768 px): a short header, then a **Timeline**, **Details** and **Dossier** control. The control sticks under the Back bar while the page scrolls. The Timeline tab shows first, with the composer above the first entry.

The pane decides, not the window, because the sidebar and the 350 px contact list sit beside the contact. In a 1024 px window the contact pane is about 600 px wide, which is too narrow for two columns.

### Profile Header

The header names the person, says the facts you need before you talk, and offers one primary action.

```
Wide:
(avatar 96) Thomas Walker (they/them)               [ Log interaction ] ⋮
            UX Researcher at Umbrella Corp
            Sydney · 2:45 AM · 13°C · ThomasWalker ↗ · @Thomas_Walker ↗
            [tech-lead ×] [advisor ×] [+ tag]

Narrow:
← Network
(avatar 56) Thomas Walker                                               ⋮
            UX Researcher · Umbrella Corp
            Sydney · 2:45 AM · ThomasWalker ↗
```

1. **The name** is the page's `h1`. Opening a contact moves focus to it. The name, the role and the company each edit in place. The ring around the avatar is the relationship score (see [The Score Ring](#the-score-ring)).
2. **The meta line** is plain text: the location, the person's local time, and the weather. Facts are not controls, so they do not wear pills. Social links and the website follow as links with a `↗` glyph. Each link opens in a new tab and has its own small menu with **Copy link** and **Remove link**.
3. **The weather** makes a request to Open-Meteo with the contact's coordinates. It shows only when it is allowed. When it is not shown, no request is made. The settings revamp adds the switch for it.
4. **Tags** are chips. **+ tag** adds one. Removing a tag offers **Undo** for 7 seconds. List memberships sit on the same row.
5. **Log interaction** is the one primary button. It opens the Timeline tab and puts focus in the composer's editor.
6. **Contact actions** (the ⋮ menu) holds everything else, in this order: **Change colour**, **Change avatar**, **Copy basic details**, **Copy full details**, **Archive** (or **Unarchive**), and **Delete**. Delete is last, on its own surface tone. The menu follows the menu pattern: focus moves into it when it opens, the arrow keys, Home and End move, a letter jumps to the next item with that letter, and Escape closes it and returns focus to the button.
7. **Change colour** opens the colour picker under the menu button. It is a radiogroup named "Contact colour": the arrow keys move and choose, and Escape closes it and returns focus to the menu button. The colour replaces the primary colour on this contact's page only.

A ghost contact also shows **Promote to contact** beside **Log interaction**. In the narrow header, the button sits under the meta line.

The narrow header is about 140 px tall:

- **Back** shows below the `lg` width and says the page it goes to: **Network**, **Map**, or **Archived contacts**. Its accessible name is "Back to Network", and so on.
- **No Log interaction button.** The composer is the first thing under the section control.
- **No weather**, so the meta line fits on one line more often.
- **The headline, the AI summary, the tags and the lists** move to the top of the **Details** tab.

### The Score Ring

The ring around a contact's avatar shows the relationship score. The ring used to show the contact's colour, and people read a red ring as trouble. Now the ring says one thing.

- **The arc length is the score.** A score of 72 fills 72 percent of the ring, clockwise from the top. A faint track shows the rest.
- **The arc colour is the band.** The bands come from `shared/scoreBand.ts`, which the server and the app both read.

| Band        | Score     | Colour token |
| ----------- | --------- | ------------ |
| **Strong**  | 70 to 100 | `success`    |
| **Fading**  | 40 to 69  | `warning`    |
| **At risk** | under 40  | `error`      |

- **No interactions yet.** A contact with no logged interaction has no score to show. The ring shows the track with no arc, and the tooltip says "No interactions yet".
- **Not by colour alone.** The tooltip says the score in words: "Score 72, strong". In the contact list, each row's accessible name ends with the same words: "Betty Clark, Global Dynamics, score 72, strong".
- **Width.** The ring is 2 px in lists and 3.5 px in the contact header.
- **Photos.** A real photo shows with no grey disc behind it. The drawn fallback avatar keeps the disc, because its corners are transparent.

The contact's colour (**Change colour**) is now only the accent on that contact's page. The component is `ScoreRingAvatar`. The old name, `HealthRingAvatar`, stays as an alias for one release.

### Details: One Pattern for Every Value

Every value in the Details card uses the same pattern, the `Field` component:

```
Email                                   ← the field label, 12 px sentence case
thomas@umbrella.com ✎   Work ▾   ⋮      ← the value, its label, its menu
+ Add                                   ← a real button
```

- **The field label** is sentence case at 12 px (`FIELD_LABEL`). The card heading, "Details", is the one uppercase heading (`SECTION_HEADING`).
- **The value edits in place.** Click it, or focus it and press Enter. In the field, Enter saves and Escape cancels. Focus returns to the value either way.
- **The pencil** after a value shows at 40 percent opacity on a touch screen and when the value has keyboard focus. A pointer also sees a grey wash on hover.
- **The label** (Work, Personal, Mobile, and so on) is a select.
- **The row menu** holds **Make primary** (on every row after the first), **Show on map** (on address rows, when the contact is on the map), and **Remove**. Removing a value offers **Undo** for 7 seconds.
- **Order.** Drag a row by its handle while its menu is open. From the keyboard, press Alt+Arrow Up or Alt+Arrow Down on the value or on its menu button to move the row one place, and a screen reader hears the new position. The first email and the first phone are the primary ones. The first address places the map pin, and its row says **Map pin**.
- **+ Add** is a button under each list. It opens a label select and a field. Enter adds, Escape cancels.
- **Preferences and interests** are chips with the same **+ Add** button, drawn by the `ChipInput` component that also draws the header's tags. An interest that enrichment found wears the AI colour and a sparkle.

| Field             | Type | Notes                                                                                                                                                                                 |
| ----------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name, First, Last | Text | Auto-split on creation                                                                                                                                                                |
| Headline          | Text | One-line professional summary                                                                                                                                                         |
| Role              | Text | Job title                                                                                                                                                                             |
| Company           | Text | Auto-fetches company logo via local proxy                                                                                                                                             |
| Location          | Text | Auto-geocoded, and places the contact's pin on the map. A placed contact shows a small map of that spot, every address row's menu links to it, and "Adjust pin" moves the pin by hand |
| Birthday          | Date | With a badge when the birthday is within 30 days                                                                                                                                      |
| Pronouns          | Text |                                                                                                                                                                                       |
| Industry          | Text | With autocomplete from common industries                                                                                                                                              |
| Website           | URL  |                                                                                                                                                                                       |
| About             | Text | Free-form biography                                                                                                                                                                   |

### Multi-Value Fields

These fields support multiple entries with labels:

- **Emails** — Work, Personal, Other
- **Phones** — Mobile, Work, Home, Other
- **Addresses** — Geocoded too. One of them places the pin, and the map's hover card names which one
- **Social Links** — LinkedIn, GitHub, Twitter, etc. (with platform icons)
- **Education** — School, degree, field, dates
- **Experience** — Company, role, dates, location
- **Tags** — Free-form tags
- **Interests** — Including AI-generated interests
- **Custom Attributes** — Key-value pairs

### Keyboard on a Contact

The shortcuts dialog (`?`) lists these under **Contact**. They come from `src/lib/shortcuts.ts`.

| Keys      | What they do                                                   |
| --------- | -------------------------------------------------------------- |
| `Enter`   | Edit the value that has focus                                  |
| `Esc`     | Cancel the edit                                                |
| `⌥ ↑`     | Move an address, email or phone up one place                   |
| `⌥ ↓`     | Move an address, email or phone down one place                 |
| `⌘ Enter` | Save the interaction you are writing (listed under **Global**) |

### The Pin on the Map

The geocoder places a pin from the address. When it places it wrongly, **Adjust
pin** under the small map opens a dialog where you drag the pin, click the
map, or nudge the pin with the arrow keys, and save. The contact then shows a
"Placed by hand" badge, and the geocoder leaves that pin alone. It reads the
address again only when the address changes, or when you choose **Use address
again** in the same dialog. A contact the geocoder could not place shows "Not
on the map yet" and **Set location**, which opens the same dialog with no pin
until you click the map. See [Map View](map-view.md#moving-a-pin-by-hand).

<!-- Screenshot: contact-detail.png -->

---

## Timeline

The Timeline tab shows every interaction with a contact in one column, newest first. The timeline used to zigzag, with cards on alternate sides. At 1440 px each card was 250 px wide, and titles wrapped to three lines.

```
THIS WEEK
10    📞  Follow up regarding partnership                            ⋮
Sep       Sent over the requested documents…
AUGUST
28    📝  Follow up regarding partnership                            ⋮
Aug
```

- **Groups.** "This week" holds the entries of the current week, from Monday. Each earlier month is one group: "August" in the current year, "December 2025" in an earlier year. Each group heading is an `h2`, and its entries are a list.
- **The date column** is 64 px wide. It shows the day and the short month.
- **The full date** is the entry's tooltip. It uses `formatDay`, the one format for a date across the app.
- **The type glyph** follows the date: note, call, meeting, email and the rest.
- **The title** is a button. It opens the interaction in a dialog, with the full text, the follow-ups, **Edit** and **Delete**.
- **The body** shows at most three lines. The dialog shows all of it.
- **Mentions, attachments, follow-ups and the duration** show under the body.
- **The entry menu** (⋮) holds **Edit** and **Delete**. It shows when the pointer is over the entry, when focus is in the entry, and always on a touch screen. There is no red button at rest.

### Deleting an Interaction

1. **Delete** (from the entry menu or the dialog) asks first: "Delete this interaction?"
2. **Delete interaction** takes the entry off the timeline, and a toast says "Interaction deleted" with **Undo** for 10 seconds.
3. **Undo** puts the entry back. Nothing was sent to the server.
4. When the toast closes without **Undo**, the app sends the delete. The server delete is permanent: the interaction and its attached file are gone.

The delete waits for the toast to close, because the server has no Trash for interactions. The wait continues when you leave the contact page. The app sends every waiting delete if you close the tab. If the server refuses a delete, the entry comes back and a toast says so.

Each interaction has:

- **Type** — Note, Call, Meeting, Email, Message, SMS
- **Title** — Short description
- **Content** — Rich text (rendered via Tiptap)
- **Date** — When the interaction occurred
- **File attachments** — PDFs, images, documents
- **Action items** — Linked follow-up tasks
- **@Mentions** — Clickable links to other contacts

### Logging Interactions

One composer writes every interaction, on the Timeline tab and in the quick interaction dialog (`Cmd+Shift+I`). It is `src/components/InteractionComposer.tsx`. The dialog uses its `compact` form.

1. **The editor** is a TipTap editor named "Note". Type `@` to mention a person (see below).
2. **The next-action line** turns a date into a follow-up task. "Send slides next Tuesday" becomes the task "Send slides", due next Tuesday. The parsed date shows beside the field.
3. **The type** is a radiogroup: Note, Call, Meeting, Email. It shows text from the `sm` width and icons below it. Tab reaches the chosen type, and the arrow keys change it.
4. **Save** is always enabled. A Save with nothing written says "Write something first" and puts focus in the editor. In the dialog, a Save with no contact chosen says "Choose a contact first" and puts focus in the contact search.
5. **`Cmd+Enter`** saves from anywhere in the composer. The hint at the end of the next-action line says so, from the `sm` width.

A save clears only what was sent, and only after the server has it. On the Timeline tab the draft is kept on this device, per account and contact, until it is saved. The dialog keeps no draft.

In the narrow layout the composer is one line, "Write a quick note...", until it takes focus. Then the next-action line, the type and **Save** open under it. When focus leaves and nothing is written, it closes again. A draft that comes back from this device opens it. On a phone, **Save** sticks above the tab bar while a long note is written.

`QuickInteractionModal` takes an optional `initialContactId`. With it, the dialog opens for that person: the contact search is not shown, and focus starts in the editor.

Files dropped on the Timeline tab are attached to the contact. An `.eml` file is summarised into an interaction.

<!-- Screenshot: timeline-mentions.png -->

---

## @Mentions & Network Weaving

Type `@` followed by a name in any interaction to create a bi-directional link:

1. A dropdown appears with fuzzy-matched contact suggestions
2. Select a contact to insert the mention
3. The system creates entries in the `interaction_mentions` junction table
4. Both contacts' timelines reference the interaction
5. Ghost contacts are created for unrecognized names

This builds an implicit relationship graph — the more contacts mention each other, the stronger the network signal.

---

## Ghost Contacts

When the AI detects names in interactions that don't match any existing contact, it creates a **Ghost** contact (`isGhost = 1`):

- Ghosts appear in the zero-state intelligence as "mentioned N times but not in contacts"
- Ghosts can be **promoted** to full contacts via the profile UI
- When promoted, their profile is pre-hydrated with all historical mentions
- Ghosts are excluded from the main contact list, map, and dedupe engine. `GET /api/contacts/map` enforces the map exclusion

**API:** `POST /api/contacts/:id/promote`

---

## Briefing

Walking into a meeting? The **Briefing** card at the top of the **Dossier** tab writes three points from the contact's profile and recent timeline: what you last discussed, what is still open, and something to open the conversation with.

- **Generate briefing** writes it. **Regenerate briefing** writes it again.
- A briefing stays for three days. After that the card offers **Generate briefing** again.
- The briefing needs an AI provider. Without one, the card says it could not write the briefing and asks you to check the AI setup in Settings.

The card sits in the Dossier tab because a briefing is a summary to read before a meeting, the same kind of content as the dossier. It stays on screen while you scroll, and the header keeps one primary action.

It is also in the Command Palette action sub-menu (`B`).

<!-- Screenshot: briefing-card.png -->

**API:** `POST /api/contacts/:id/briefing`

---

## Avatar System

Open **Contact actions → Change avatar**. There are three ways to set a contact's avatar:

1. **Upload** — Drag or click to upload an image (max 10 MB)
2. **URL** — Paste an image URL
3. **Generated** — Automatic fallback using initials on the contact's colour

Uploaded avatars are processed by Sharp (resized, optimized) and stored in `uploads/avatars/`.

---

## Archived Contacts

Archive contacts to hide them from the Network and Map views without deleting them. `GET /api/contacts/map` leaves out archived contacts, and it leaves out trashed contacts and ghosts as well:

- Archive with **Contact actions → Archive**, or from the bulk selection toolbar
- View archived contacts in **Settings → Archived Contacts**
- Restore individual contacts or bulk-restore selections
- Delete from the archive view (moves to Trash)

Archived contacts are excluded from search, dedupe, and relationship scoring.

---

## Trash & Undoable Deletes

Deleting a contact is never instantly permanent:

- **Delete** moves the contact (and its full history) to the Trash — an
  Undo action appears in the toast
- Review deletions in **Settings → Trash**: each entry shows when it was
  deleted and when it will auto-purge
- **Restore** brings a contact back fully searchable, or **Delete forever**
  purges it immediately (with confirmation)
- A contact in the Trash leaves the map, and Restore puts its pin back
- The trash empties itself after `TRASH_RETENTION_DAYS` (default 30 days)

Combined with automatic database backups (`DATA_DIR/backups`, every 24h) and
one-click full export (**`GET /api/export/json`** / **`csv`**), a stray
delete or bulk operation is always recoverable. See
[Configuration → Data Lifecycle](../configuration.md#data-lifecycle).
