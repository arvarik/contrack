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

Access via **Settings → Import** or the import button on the contact list. Supports:

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

**Settings → Data → Export your contacts.** Three formats, because they answer
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

## Contact Profile

Each contact has a profile page. The header sits on top. Under it, the Details card is on the left and two tabs are on the right: **Timeline** (the composer and the interactions) and **Dossier** (the briefing and the background research).

### Profile Header

The header names the person, says the facts you need before you talk, and offers one primary action.

```
(avatar) Thomas Walker (they/them)                  [ Log interaction ] ⋮
         UX Researcher at Umbrella Corp
         Sydney · 2:45 AM · 13°C · ThomasWalker ↗ · @Thomas_Walker ↗
         [tech-lead ×] [advisor ×] [+ tag]
```

1. **The name** is the page's `h1`. Opening a contact moves focus to it. The name, the role and the company each edit in place.
2. **The meta line** is plain text: the location, the person's local time, and the weather. Facts are not controls, so they do not wear pills. Social links and the website follow as links with a `↗` glyph. Each link opens in a new tab and has its own small menu with **Copy link** and **Remove link**.
3. **The weather** makes a request to Open-Meteo with the contact's coordinates. It shows only when it is allowed. When it is not shown, no request is made. The settings revamp adds the switch for it.
4. **Tags** are chips. **+ tag** adds one. Removing a tag offers **Undo** for 7 seconds. List memberships sit on the same row.
5. **Log interaction** is the one primary button. It opens the Timeline tab and puts focus in the composer's editor.
6. **Contact actions** (the ⋮ menu) holds everything else, in this order: **Change colour**, **Change avatar**, **Copy basic details**, **Copy full details**, **Archive** (or **Unarchive**), and **Delete**. Delete is last, on its own surface tone. The menu follows the menu pattern: focus moves into it when it opens, the arrow keys, Home and End move, a letter jumps to the next item with that letter, and Escape closes it and returns focus to the button.
7. **Change colour** opens the colour picker under the menu button. It is a radiogroup named "Contact colour": the arrow keys move and choose, and Escape closes it and returns focus to the menu button. The colour replaces the primary colour on this contact's page only.

A ghost contact also shows **Promote to contact** beside **Log interaction**.

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

The timeline tab shows all interactions with a contact in chronological order. Each interaction has:

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
