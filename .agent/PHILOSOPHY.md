# Product philosophy

Why Contrack exists and what it believes. Use it to decide a feature, a design
or an unclear rule. `STYLE.md` says how the beliefs look on screen.

## Why it exists

Contrack is a self-hosted personal CRM for people whose work runs on
relationships: founders, investors, executives, independents. A sales CRM is
a pipeline that asks for data entry. Contrack asks for the few things only a
person can say, such as a note after a call or who is worth keeping up with.
The machine does the rest: it imports and merges contacts, finds duplicates,
researches people, and says who needs attention today.

## Who it is for

A person who wants to find anyone in their network in a second, during a
meeting, from the keyboard. They bring contacts from Apple, Google, LinkedIn,
mail and calendars, and they expect the app to clean and connect them. They
run it on their own machine or server, alone or with a few trusted accounts.

## What it believes

### Your data stays yours

- The data is one SQLite file on the owner's disk. No hosted database, no
  telemetry, no account with us.
- Each account on an instance sees only its own contacts. Isolation is
  enforced in SQL and proven by tests, not by the UI.
- The app works with no AI provider at all. Search runs on two small local
  models that ship with the app, so an offline instance still finds people.
- AI is a choice at two levels: each account can turn it off, and an admin
  can turn it off for the whole instance. A request reaches a provider only
  when both allow it.
- What leaves the machine is named in the docs, and credentials are encrypted
  at rest.

### Fast first, then right

- The first answer is local and arrives at once: the list in memory, then
  full-text and vector search on the server.
- A model may improve an answer, never fake one. An AI-checked answer cites a
  real field on the contact. A list no model checked says **Not verified by
  AI**.
- Names, emails, phone numbers and simple filters never wait for a model.

### You choose who matters

- Tracking is a decision a person makes. Nobody is tracked by default, not
  even contacts from an import or a connector.
- The score and its ring belong to tracked people only. An untracked contact
  has no score, and no screen implies one.
- Pulse turns those choices into a calm morning page: what is due, who is
  past their cadence, what changed.

### Intelligence is quiet

- Background work fills in what it can: coordinates for the map, search
  vectors, duplicate checks, relationship scores. It never interrupts.
- When the machine changes your data by itself, it says so once, with Undo.
  An undo is an answer it keeps: two contacts you pulled apart stay apart.
- When the machine is unsure, it asks, in one place, with the reason in plain
  words and what a yes would change. It never shows a confidence number, and
  it says when to look twice.
- Names mentioned in notes become ghosts: people the network knows about
  before anyone adds them. A ghost can become a contact with one action.
- A card with nothing to say is one line. Say the fact or say nothing.

### Keyboard first, touch friendly

- `Cmd+K` reaches any person or action. `Cmd+Shift+I` logs a note from
  anywhere. `?` lists every shortcut for the page.
- Every control works on a phone with a thumb: 44 px targets, bottom sheets,
  no hover-only actions.

### Calm, clear design

- Surfaces, not lines. One primary colour for action, one colour that means
  "a model wrote this".
- Plain words, one name for each place, sentence case everywhere.
- Motion is small and purposeful, and reduced motion always wins.

### A bird with a job

The corvid is the mark and a small companion. It blinks and looks about on
its perch, nods when a follow-up is done, and flies when there is something
to celebrate. It never reacts to a failure, never takes focus, and stays still
when a person asks for less motion.

## What it is not

- **Not a sales tool.** No deals, stages, funnels or revenue.
- **Not a team CRM.** Accounts on one instance do not share contacts.
- **Not a task manager.** A follow-up belongs to a person, not to a project.
- **Not a social client.** Profile links are for reference. Contrack never
  posts or reads a feed.
- **Not a data broker.** Research fills in a profile for the owner, never for
  marketing or analytics.
