# Note Search

Contrack keeps what you write about people. Note search reads it back: ask
"Who discussed hiring last month?" and get the notes that say so, each with
the person it is about, the date, and the passage that matched.

Everything runs locally. The server searches an FTS5 index of your notes and
calls no model, so the same question over the same notes gives the same page
every time, on an instance with no AI key at all.

## Where it is

- **Search page, Notes mode.** Open Ask Contrack (`⌘⇧S` or the sidebar) and
  switch the toggle from People to Notes. The address becomes
  `/search?mode=notes`, so Back returns to the same search and the link can be
  shared.
- **Command palette.** With an AI question typed, "Search notes" opens the
  same words in Notes mode.
- **API and MCP.** `GET /api/search/interactions` for the app, and the MCP
  route `GET /api/interactions/search` for a personal token. Both run on the
  same engine. See [the API reference](../api-reference.md#search).

A result opens the note on its contact's timeline, scrolled to and expanded.

## What a question can say

The words are matched against note titles and bodies. Matching is by stem,
so `hire` finds "hiring" and "hired", and accents are folded, so `cafe` finds
"café". A word is also a prefix, so `berl` finds "Berlin".

Words that make a question a question are set aside before the search: who,
what, when, did, the, discussed, talked, mentioned, and the like. The words
that are left are matched two ways. Every word first. When no note has all of
them, any of them, ranked so a note with more of them comes first, and the
page says so. Two buttons, **All words** and **Any word**, override the
choice.

A period in the question is lifted out and applied as a filter, in your own
time zone:

| Phrase                                            | Period                                     |
| ------------------------------------------------- | ------------------------------------------ |
| `today`, `yesterday`                              | that calendar day                          |
| `this week`, `last week`                          | the calendar week, Monday to Sunday        |
| `this month`, `last month`, `previous month`      | the calendar month                         |
| `this quarter`, `last quarter`                    | the calendar quarter                       |
| `this year`, `last year`                          | the calendar year                          |
| `in the last 30 days`, `past two weeks`           | a window ending now                        |
| `in March`, `March 2026`, `in Sept 2025`          | that month, the most recent one if no year |
| `in 2025`                                         | that year                                  |
| `on 2026-08-12`                                   | that day                                   |
| `since March`, `after March`, `before 2026-08-01` | open at one end                            |
| `between March and May`, `from March to May`      | both months, inclusive                     |

One phrase is read per question, the most specific one. `May` on its own is
left alone unless it is clearly a month, because it is also a verb. Anything
the table does not list stays in the question as words to search for.

The page shows what it understood: `“last month” → Aug 1 – Aug 31, 2026`.

## Filters

- **Period presets:** any time, last 7 days, last 30 days, last month, this
  year, or two dates of your own. A preset overrides a phrase in the
  question; the phrase's words are still lifted out of the text.
- **Kind:** notes, calls, meetings, emails, messages.
- **Order:** best match, or newest first.
- **Pages** of twenty, with the total.

A period or a kind with no words lists the notes in it, newest first, with
the opening of each. With no words and no filter the page is empty: listing
every note is what the timeline is for.

## What is hidden

A note on a contact the app hides is hidden with it: archived, trashed,
merged away, or a ghost. The note stays in the index, and the search joins
to the contact and checks its status at query time, so restoring the contact
brings its notes back without touching the index.

Every statement carries your account three times: in the FTS5 match
expression as an owner token, on the interaction row, and on the contact
row. Another account's notes cannot be returned, and the isolation matrix in
`tests/integration/tenancy.isolation.test.ts` proves it for this route.

## How the index works

`interactions_fts` is an FTS5 table that mirrors `interactions` by rowid, the
way `contacts_fts` mirrors `contacts`. Three triggers keep it in step, in the
same transaction as the note: an insert indexes the note, an edit of the
title or body re-indexes it, a delete removes it. A contact's deletion
cascades to its notes, and the cascade fires the delete trigger.

The body is indexed as plain text. The composer stores TipTap HTML, and
indexing that directly would make `span`, `li` and every mention id into
searchable words. So the triggers call `contrack_note_text`, a SQL function
the server registers on its connection, which strips tags, decodes entities
and drops control characters. One set of triggers therefore covers every
write path: the composer, an email import, a merge, a seed script. The
trade is that a connection without the function cannot insert or update a
note; this database is written by this app, and the app registers it at
boot.

The tokenizer is `porter unicode61 remove_diacritics 2`. Stemming is right
for prose and wrong for names, which is why `contacts_fts` does not stem.
Titles weigh three times a body in the bm25 ranking, and the id and owner
columns weigh nothing.

The index lives under the same version gate as the contact index,
`PRAGMA user_version`, now at 4. A database from an earlier version rebuilds
both tables on its first boot, in one transaction. Later boots index any
note the table is missing, so a note written by a tool that bypassed the
triggers is picked up on the next start.

`interactions.date` holds three shapes, because SQLite's `CURRENT_TIMESTAMP`
writes `2026-09-10 06:14:30` and JavaScript writes
`2026-09-10T06:14:30.000Z`, and a bare date is allowed too. As text they do
not compare across shapes, so the date filter normalises every row with
`strftime` before comparing it to the bound.

## Limits

- The phrases above are the whole vocabulary. There is no model in the loop,
  which is what makes an answer reproducible, and it is also why "the week
  before the offsite" is just words.
- Stemming is English. Notes in other languages are matched by exact word
  and prefix.
- A note is about the contact whose timeline it is on. A note that
  @mentions a second person is found under the first.
- The search covers titles and bodies, not attachments. An imported email is
  found by the summary the import wrote, not the raw message.
