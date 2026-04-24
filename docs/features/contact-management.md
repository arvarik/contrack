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
- **vCard (.vcf)** — Standard contact card format
- **EML files** — Email message parsing

The import pipeline runs in 4 SSE-streamed phases:
1. **Importing** — Creating contact records
2. **Embedding** — Generating contact fingerprints for deduplication
3. **Scanning** — Checking for duplicates against existing contacts
4. **Summary** — Final counts (imported, auto-merged, needs review, new unique)

<!-- Screenshot: import-modal.png -->

---

## Contact Profile

Each contact has a comprehensive profile with two tabs: **Dossier** (details) and **Timeline** (interactions).

### Profile Header

- **Avatar** — Upload, pick from URL, or use the auto-generated fallback (initials on vibe color)
- **Vibe Color** — Choose a theme color for the contact card (persists across all views)
- **Relationship Score** — AI-computed score (0–100) based on interaction frequency, recency, and depth
- **Data Age Halo** — Colored ring around the avatar indicating data freshness:
  - 🟢 Green: Last updated < 3 months ago
  - 🟡 Yellow: 3–6 months ago
  - 🔴 Red: > 6 months ago

### Detail Fields

| Field | Type | Notes |
|-------|------|-------|
| Name, First, Last | Text | Auto-split on creation |
| Headline | Text | One-line professional summary |
| Role | Text | Job title |
| Company | Text | Auto-fetches company logo via local proxy |
| Location | Text | Auto-geocoded for map view |
| Birthday | Date | With age calculation display |
| Pronouns | Text | |
| Industry | Text | With autocomplete from existing industries |
| Website | URL | |
| About | Text | Free-form biography |

### Multi-Value Fields

These fields support multiple entries with labels:
- **Emails** — Work, Personal, Other
- **Phones** — Mobile, Work, Home, Other
- **Addresses** — With geocoding for map integration
- **Social Links** — LinkedIn, GitHub, Twitter, etc. (with platform icons)
- **Education** — School, degree, field, dates
- **Experience** — Company, role, dates, location
- **Tags** — Free-form tags with autocomplete
- **Interests** — Including AI-generated interests
- **Custom Attributes** — Key-value pairs

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

Use the **Rich Interaction Composer** at the bottom of the timeline tab. Features:
- Type selector pills (Note / Call / Meeting / Email)
- Tiptap rich text editor with @mention support
- File upload via drag-and-drop or click
- `Cmd+Enter` to save
- Optional action item creation with due date

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
- Ghosts are excluded from the main contact list, map, and dedupe engine

**API:** `POST /api/contacts/:id/promote`

---

## Catch-Me-Up Briefing

Walking into a meeting? The briefing pipeline generates a structured executive summary from the contact's timeline history:

- Feeds up to 3 years of timeline data into the AI provider
- Produces a structured brief: **Wins**, **Projects**, **Open Loops**
- Uses strict JSON bounding to prevent hallucination
- Cached for 24 hours (via `aiCache.briefing` tier)

Trigger via the **Catch-Me-Up** button on the contact profile or through the Command Palette action sub-menu (`B`).

<!-- Screenshot: briefing-card.png -->

**API:** `POST /api/contacts/:id/briefing`

---

## Avatar System

Three ways to set a contact's avatar:

1. **Upload** — Drag or click to upload an image (max 10 MB)
2. **URL** — Paste an image URL
3. **Generated** — Automatic fallback using initials on the contact's vibe color

Uploaded avatars are processed by Sharp (resized, optimized) and stored in `uploads/avatars/`.

---

## Archived Contacts

Archive contacts to hide them from the Network and Map views without deleting them:

- Archive via the contact actions menu or bulk selection toolbar
- View archived contacts in **Settings → Archived Contacts**
- Restore individual contacts or bulk-restore selections
- Permanently delete from the archive view

Archived contacts are excluded from search, dedupe, and relationship scoring.
