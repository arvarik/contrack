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

| Spec                                     | What it walks                                                                                                                                        |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/e2e/axe.spec.ts`                  | Every screen scanned with axe against WCAG 2.2 AA, the text-heavy ones in the dark palette too                                                       |
| `tests/e2e/keyboard.spec.ts`             | The skip link, the sidebar in Tab order with a visible focus ring in both palettes, `/` for search, arrow keys through the list, the mode radiogroup |
| `tests/e2e/dialogs.spec.ts`              | Shortcuts, new contact, contact card and command palette: focus in, Tab trapped, Escape closes, focus returns, each scanned while open               |
| `tests/e2e/search-announcements.spec.ts` | The status region says the search started and what it found; a failure is an alert and the status stays quiet; results restored on Back stay silent  |
| `tests/e2e/mobile-forms.spec.ts`         | A Pixel 7: the tab bar's targets and `aria-current`, the new contact bottom sheet, 16-pixel fields, setup and sign-in with field-attached errors     |
| `tests/e2e/account-transitions.spec.ts`  | A gated instance: setup, sign out, wrong password, sign in, an expired session, and the forced password change                                       |

The fixtures under `tests/e2e/fixtures/` are the vocabulary the specs share:
`test` for the worker's open, seeded instance, `gatedTest` for a fresh gated
one per test, `expectPageAccessible`, `expectVisibleFocus`,
`expectFocusStaysWithin`, and `answerPeopleSearch` for a scripted People
search.

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

### Focus

One `:focus-visible` rule in `src/index.css` draws the ring for every
control, in the primary colour, outside the control so it survives a filled
button. A handful of fields draw a ring of their own. The suite asserts an
indicator is present after a real Tab press, in both palettes, and never
asserts one after a click, because a pointer user is not meant to see it.

The first Tab stop on every page is "Skip to main content", which moves
focus past the sidebar or the tab bar to the page's own content (WCAG 2.4.1).

### Phones

Fields render at 16 pixels or more below the `sm` breakpoint, because iOS
Safari zooms the viewport when a smaller field takes focus. Tab bar targets
are at least 44 pixels tall. Dialogs become bottom sheets.

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
   Press Enter, then Tab: focus is in the contact list, not the sidebar.
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
6. On the sign-in screen, submit a wrong password. The reader interrupts with
   "Incorrect username or password".
7. On the setup screen, leave the email invalid and Tab away. The field is
   announced as invalid, with the message.

### Zoom and motion

1. At 200% browser zoom, `/`, `/search` and `/settings` show nothing cut off
   and need no horizontal scrolling.
2. With "reduce motion" on in the OS, dialogs and result cards appear without
   animation.

### A phone

On a real phone or the browser's device mode at 412 pixels wide:

1. The tab bar's five targets are easy to hit and the current one is marked.
2. Open "Add Contact". The sheet rises from the bottom, the page does not
   zoom when a field takes focus, and "Save Contact" is reachable above the
   keyboard.
3. The account row at the top of Settings shows who is signed in and signs
   out.

## Adding a journey

Write the spec against `test` from `tests/e2e/fixtures/test.ts` for anything
that works on an open instance, and against `gatedTest` when the journey
starts before sign-in. Navigate with `page.goto("/…")`; `baseURL` is set per
worker. Locate by role and name, never by class. Assert what the next screen
says, not the URL, unless the URL is the point. Scan every screen the journey
reaches with `expectPageAccessible`, and scan an open dialog with
`b.include('[role="dialog"]')` so the scan covers the dialog and not the
page behind it. When a People search is on the path, script it with
`answerPeopleSearch`, which answers at the network edge and leaves everything
from the request body to the last render real.
