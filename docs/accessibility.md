# Accessibility

Contrack is keyboard-first, and every screen is meant to work with a screen
reader, at a phone's width, and in both palettes. This page says what that
promise is made of, which parts a machine checks on every pull request, and
which parts a person still has to check.

## What CI checks

`browser-a11y` in `.github/workflows/ci.yml` builds the production bundle,
boots it the way a release runs (`NODE_ENV=production`, `dist/` served, the
CSP on), and drives it in headless Chromium with Playwright. Every worker gets
a server of its own on a free port with a throwaway `DATA_DIR`, so a run never
touches a developer's database and two workers never share state.

| Spec                                     | What it walks                                                                                                                                                               |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/e2e/axe.spec.ts`                  | Every screen scanned with axe against WCAG 2.2 AA, the text-heavy ones in the dark palette too, and the landmark and heading rules on six screens                           |
| `tests/e2e/keyboard.spec.ts`             | The skip link, the sidebar in Tab order with a visible focus ring in both palettes, `/` for search, arrow keys through the list, the mode radiogroup                        |
| `tests/e2e/contact.spec.ts`              | Opening a contact puts focus on its name, the list's arrow keys and type-ahead, and Back on a phone returns focus to the row                                                |
| `tests/e2e/dialogs.spec.ts`              | Shortcuts, new contact, contact card and command palette: focus in, Tab trapped, Escape closes, focus returns, each scanned while open                                      |
| `tests/e2e/search-announcements.spec.ts` | The status region says the search started and what it found; a failure is an alert and the status stays quiet; results restored on Back stay silent                         |
| `tests/e2e/mobile-forms.spec.ts`         | A Pixel 7: the tab bar's targets and `aria-current`, the new contact bottom sheet, 16-pixel fields, setup and sign-in with field-attached errors                            |
| `tests/e2e/metrics.spec.ts`              | A 390 px phone: every visible control has a 44 by 44 pixel hit box and no visible text is under 11 pixels, on Network, a contact, Pulse, Ask Contrack, Settings and the map |
| `tests/e2e/account-transitions.spec.ts`  | A gated instance: setup, sign out, wrong password, sign in, an expired session, and the forced password change                                                              |

The fixtures under `tests/e2e/fixtures/` are the vocabulary the specs share:
`test` for the worker's open, seeded instance, `gatedTest` for a fresh gated
one per test, `expectPageAccessible`, `expectPageStructured`, `expectVisibleFocus`,
`expectFocusStaysWithin`, and `answerPeopleSearch` for a scripted People
search. `map.ts` answers every OpenFreeMap request with an empty style, so a
map scan draws no tiles and needs no network.

### Running it locally

```bash
npm run build          # the suite serves dist/, the same files a release ships
npm run test:e2e       # all journeys, headless
npm run test:e2e:ui    # Playwright's UI mode: pick a test, watch it, time-travel
npx playwright test -g "skip link" --headed
```

A failure writes `playwright-report/`. Open it with
`npx playwright show-report`. Each axe scan is attached as JSON, a failing
test carries its screenshot, and the server's own log is attached under
`server.log`, which is the first place to look when a page never became
ready.

The first run needs Chromium: `npx playwright install chromium`.

## The contracts the suite holds up

### Status messages

WCAG 2.2 SC 4.1.3. A change a sighted person notices without looking for it
has to reach a screen reader without moving focus.

- **Results and progress take `role="status"`.** The search page keeps one
  polite region, `LiveStatus` in `src/components/ui/`, named "Search status".
  It is in the DOM before it has anything to say, because a region that
  appears with text already in it is announced by some screen readers and
  skipped by others. The value it mounts with is not spoken, so the results
  restored on Back to the page are read from the page, not announced twice.
- **The wording is in `src/lib/searchAnnouncements.ts`** and tested as
  sentences. A People search speaks at most three times: that it started,
  that keyword candidates arrived while AI is still working, and what it
  found. A Notes search speaks twice. Nothing speaks on a keystroke.
- **Errors take `role="alert"`** on the visible error itself, which is the
  pattern the auth screens and inline field errors already use. The status
  region says nothing for an error, so a failure is heard once.
- **A field's error is attached to the field.** `aria-invalid` plus
  `aria-describedby` pointing at the message, so a screen reader hears what is
  wrong on the field, not somewhere else on the page.

### Dialogs

Every dialog owes a keyboard user five things, and the shared `Modal`
primitive supplies them: `role="dialog"` with a name, focus moved inside on
open, Tab kept inside, Escape to close, and focus returned to the control
that opened it. The keyboard shortcuts overlay is built on the primitive for
that reason, and the contact card that opens over search results carries the
same five by hand because it fills the viewport rather than sitting in a
card.

### Landmarks and headings

A screen reader user moves through a page by its landmarks and its headings,
so both follow rules, and `expectPageStructured` scans them with axe's
`landmark-one-main`, `page-has-heading-one`, `region` and `heading-order` on
Network, a contact, Pulse, Map, Ask Contrack and Settings. The map answers for
all four rules now that MapLibre draws it. The scan waits for the "Contact
map" region and a named pin first, so it reads the map that is on screen and
not an empty container.

- **One `main` per route, with a name.** The full-page views (Pulse, Ask
  Contrack, Settings) render inside `<main aria-label="…">`. On a wide screen
  the contact list is a complementary landmark named "Contacts" beside the
  contact's main. Below `lg` the list and the contact take turns on screen,
  so whichever is showing is the main. The list pane changes its `role`
  rather than its element, because swapping the element would remount the
  list and lose its search and scroll. The map is the main on `/map`, and a
  contact opened over it is a region named "Contact".
- **The map is a region named "Contact map"**, and everything on it is a real
  button. A pin is named `"<name>, <company>"` and a cluster is named
  `"<n> contacts, zoom in"`, so a screen reader user hears who is there and what
  a click does. Focus on a pin opens the same card that hover opens. A cluster
  that zooming cannot split opens a list of its people, each one a button, so
  a pin under another pin is still reachable. Escape closes a contact opened
  over the map, unless a field being edited or a dialog answers the key first.
- **One `h1` per route.** "Network" on the Network page, the contact's name on
  a contact page, "Map" (visually hidden), "Pulse", "Ask Contrack" and the
  Settings page title. Beside an open contact the list's title steps down to
  an `h2`. Inside a page, sections are `h2` and cards inside them `h3`.
- **Every destination has one name**, in `src/lib/names.ts`. The sidebar, the
  tab bar, the command palette, the shortcuts dialog, document titles and the
  page headings read it, so a place is never "Ask AI" in one spot and "AI
  Search" in the next.
- **A control is named by `aria-label` or its text, not by `title`.** A
  `title` gives a pointer a tooltip and a touch screen nothing.

### Focus

One `:focus-visible` rule in `src/index.css` draws the ring for every
control: 2 px in the primary colour, outside a control so it survives a
filled button, and inset on a text field, where it reads as the field's
border. No component draws a ring of its own, and
`tests/unit/styles.floor.test.ts` fails on a `focus:ring-*` class. A
composite field, such as the Ask search box with its icon and buttons, draws
the same ring on its box with `.focus-frame`, while a button inside the box
keeps its own. The suite asserts an indicator is present after a real Tab
press, in both palettes, and never asserts one after a click, because a
pointer user is not meant to see it. A text field is the exception browsers
make: it shows its ring on any focus.

The first Tab stop on every page is "Skip to main content" (WCAG 2.4.1). Its
target follows the route: the contact's name on a contact page, the list's
current row on the Network page, and the main landmark everywhere else.

- **The contact list is one Tab stop.** A roving `tabindex`
  (`src/views/contact-list/useRovingList.ts`) keeps one row in the Tab order.
  Up and Down move between rows, Home and End jump to the ends, a letter jumps
  to the next name that starts with it, and Enter opens the row. The letter
  rail beside a long list is one Tab stop too, with the arrow keys inside it,
  and draws only the letters that have contacts.
- **Opening a contact moves focus to its name**, the `h1`, which takes focus
  with `tabIndex={-1}` and wears no ring. It does not on a fresh page load,
  where the first Tab belongs to the skip link, nor while someone is typing
  or inside a dialog.
- **Back on a phone returns focus to the row the contact was opened from.**
  The list leaves the screen while a contact is open, so the element that had
  focus is gone when it comes back. The list focuses the last opened contact's
  row instead of letting focus fall to the document.

### The Tab budget

A new control in front of the content costs every keyboard user a Tab press
on every page. `keyboard.spec.ts` holds the count, from the top of the page on
a desktop:

| Page          | Reaches                   | Within | Made of                                                                     |
| ------------- | ------------------------- | ------ | --------------------------------------------------------------------------- |
| A contact     | the contact's name (`h1`) | 17     | skip link, 7 sidebar stops, 6 list controls, the list, the avatar, the name |
| Network (`/`) | the first row of the list | 15     | skip link, 7 sidebar stops, 6 list controls, the list                       |

The list and the letter rail are one stop each however many people they hold.
Before this rule the first control in a contact was stop 42. A change that
needs a new stop in front of the content raises the budget in the spec and
says why in the pull request.

Both budgets went up by one when the corvid mark on top of the sidebar became
a button. It is the seventh sidebar stop. It navigates nowhere: it sends the
bird on a lap of the window and leaves focus exactly where it was, so a
keyboard user who lands on it by accident loses nothing but one Tab press.

### Phones

Fields render at 16 pixels or more below the `sm` breakpoint, because iOS
Safari zooms the viewport when a smaller field takes focus. Dialogs become
bottom sheets.

Every control has a hit box of at least 44 by 44 pixels, and no text is under
11 pixels. A control that looks smaller carries the `hit-area` utility, which
grows its tap box without changing how it looks. `metrics.spec.ts` measures
both floors on six screens, the map among them, and its pins and clusters are
48 pixels across. `tests/unit/styles.floor.test.ts` fails on
`text-[9px]` and `text-[10px]` anywhere in `src/`. See `.agent/STYLE.md` for
the rules.

## What a person still checks

Automation asserts the markup a screen reader reads from and the focus a
keyboard user lands on. It cannot hear a screen reader, and the timing and
phrasing of an announcement is decided by the screen reader and the browser
together, outside anything the DOM exposes. Before a release, and after any
change to a live region, a dialog, or the auth screens, one person does the
pass below. Record the date and the pair used in the release notes.

### Keyboard only, no pointer

Unplug the mouse, or do not touch it.

1. Load `/`. Press Tab once. "Skip to main content" appears in the top-left.
   Press Enter: focus is on the first contact in the list, not the sidebar.
   Press Down and Up, then a letter: focus moves through the list without
   opening anyone. Press Enter: the contact opens and focus is on its name.
2. Tab through the sidebar. Every stop shows a ring you can see at arm's
   length, in light and in dark.
3. Press `/`, type a name, press Escape. The list filters and then clears.
4. Press `n`. Fill the form with Tab and Enter only. Escape closes it.
5. Press `?`. Tab a few times: focus never leaves the overlay. Escape returns
   focus to the shortcuts button.
6. On `/search`, ask a question. Open a result with Enter. Tab around inside
   the card, Escape, and confirm focus is back on the result you opened.
7. Sign out and sign back in with Tab and Enter only.

### Screen reader

Two pairs cover most readers: VoiceOver with Safari on macOS, and NVDA with
Firefox or Chrome on Windows. Do the search page on both.

1. On `/search`, ask a question. You hear, in order, "Searching your network
   for …", then "N matches for …" or "No matches for …". Nothing is read
   twice, and nothing is read while typing.
2. Switch to Notes with the arrow keys. Type a word. You hear "N notes for …".
   Choose "Last 30 days". You hear the new count once.
3. Break the search (stop the server, or turn off the network) and ask
   again. You hear "Search failed" as an interruption, and nothing from the
   status region.
4. Navigate away and back. The results are on screen and nothing is
   announced.
5. Open the keyboard shortcuts overlay. The reader says "Keyboard Shortcuts,
   dialog". Escape, and the reader says where focus landed.
6. Open a contact from the list. The reader announces the name as heading
   level 1. The landmarks list shows "Contacts" and "Contact" on a wide
   screen, and one main on a phone.
7. On the sign-in screen, submit a wrong password. The reader interrupts with
   "Incorrect username or password".
8. On the setup screen, leave the email invalid and Tab away. The field is
   announced as invalid, with the message.

### Zoom and motion

1. At 200% browser zoom, `/`, `/search` and `/settings` show nothing cut off
   and need no horizontal scrolling.
2. With "reduce motion" on in the OS, dialogs and result cards appear without
   animation.
3. With "reduce motion" on in the OS, the corvid on top of the sidebar does
   not blink and does not fly when you click it, whatever "Corvid motion" on
   the Appearance page is set to.

### The corvid

The mark in the sidebar moves. Settings > Appearance > "Corvid motion" sets
how much:

| Choice | What it does                                                            |
| ------ | ----------------------------------------------------------------------- |
| Full   | The bird blinks now and then, and flies a lap of the window on a click. |
| Subtle | The blinks and a hop on a click. No flights.                            |
| Off    | Nothing moves.                                                          |

Two things override the choice, and the row says so when either is on:
"reduce motion" in the operating system, and the "Motion" row directly above
it set to Reduced. Either one means the bird holds still on Full.

Nothing the bird does is announced, and nothing it does can get in the way.
The drawing is `aria-hidden`; its button carries the name "Contrack" and the
tooltip "Let the corvid fly". The flight is a fixed layer that ignores
pointer events and sits under every dialog, panel and menu, so a bird passing
over a button never swallows the click. Escape lands it at once, and changing
page cancels it.

### A phone

On a real phone or the browser's device mode at 412 pixels wide:

1. The tab bar's five targets are easy to hit and the current one is marked.
2. Open "Add Contact". The sheet rises from the bottom, the page does not
   zoom when a field takes focus, and "Save Contact" is reachable above the
   keyboard.
3. The account row at the top of Settings shows who is signed in and signs
   out.
4. Open a contact from the list, then tap Back. With VoiceOver on, focus is
   on the row you opened, not at the top of the page.

## Adding a journey

Write the spec against `test` from `tests/e2e/fixtures/test.ts` for anything
that works on an open instance, and against `gatedTest` when the journey
starts before sign-in. Navigate with `page.goto("/…")`; `baseURL` is set per
worker. Locate by role and name, never by class. Assert what the next screen
says, not the URL, unless the URL is the point. Scan every screen the journey
reaches with `expectPageAccessible`, a new page with `expectPageStructured`
as well, and scan an open dialog with
`b.include('[role="dialog"]')` so the scan covers the dialog and not the
page behind it. When a People search is on the path, script it with
`answerPeopleSearch`, which answers at the network edge and leaves everything
from the request body to the last render real.
