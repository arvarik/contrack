# Accessibility

Contrack works with a keyboard alone, with a screen reader, on a phone, and in
the light and the dark theme. The first half of this page says what Contrack
supports. The second half is for contributors: what the suite checks on every
pull request, and what a person still checks by hand.

## What Contrack supports

### Keyboard

Every page works with no pointer. See
[Keyboard shortcuts](keyboard-shortcuts.md) for the keys.

- The first `Tab` on a page shows **Skip to main content**. It moves focus to
  the contact's name on a contact page, to the current row on the Network
  page, past the page list in Settings, and to the main part of every other
  page.
- A ring marks the control that has keyboard focus, in both themes. A click
  does not show it, but a text field shows it on any focus.
- The Network list and its letter rail are one `Tab` stop each. The arrow
  keys, `Home`, `End` and the letters move inside them.
- Opening a contact moves focus to its name. On a phone, **Back** puts focus
  on the row you opened.
- A dialog opens with focus in its first field, or on the dialog itself when
  it has no field, never on **Close**. It keeps focus inside while it is
  open. `Esc` closes it, and focus returns to the control that opened it. A
  menu, the right-click menu too, takes the arrow keys, `Home`, `End` and a
  letter, and `Esc` returns focus to its button. While a dialog or a menu is
  open, the page's own keys wait.
- After a click on blank space, `Space`, `Page Down` and the arrow keys scroll
  the part of the page you clicked.
- `Alt T` (`⌥ T` on a Mac) moves focus to the notifications. After **Undo**,
  focus goes back to where it was.
- Speech input or a stray press can set off a shortcut that is one key, such
  as `N`. Turn off **Single-key shortcuts** in **Settings → Keyboard** to
  stop all of them but `?` and the Network list's letters. See
  [Turn off single-key shortcuts](keyboard-shortcuts.md#turn-off-single-key-shortcuts).

### Screen readers

- Each page has one main landmark and one level-one heading. On a wide
  screen, the Network list is a landmark named "Contacts" beside the contact,
  named "Contact".
- Every control has a name. Help text opens from a button, with a key, a
  click or a tap, not on hover alone.
- Search progress and results are spoken without moving focus, such as "12
  matches for …". A list that AI did not check ends with "Not verified by
  AI." The Network search, a bulk bar's count and a moved email, phone or
  address are spoken too, such as "Moved to position 2 of 3".
- An error interrupts, a field's error is read with the field, and a score is
  said in words, such as "Score 72, strong".
- The map is a region named "Contact map". Each pin is a button named for the
  person and the company. Each cluster says how many people it holds and
  what a press does, such as "12 contacts, zoom in".

### Motion, text and themes

- **Motion**, in **Settings → Appearance**: **System** follows the reduce
  motion setting of your device, and **Reduced** keeps animation to a minimum
  for your account.
- **Corvid motion**: **Full**, **Subtle** or **Off**, for the bird in the
  sidebar. Reduced motion holds the bird still whatever you choose. The bird
  is never announced, never takes a click, and `Esc` lands it.
- **Text size**: **Large** makes all text one step larger.
- **Theme**: **Light**, **Dark** or **System**. Every **Accent color** you
  can pick is adjusted to meet WCAG 2.2 AA contrast in both themes.

### Phones

Every control has a touch target of at least 44 by 44 pixels, and no text is
smaller than 11 pixels. On a touch screen, form fields and the note editor are
16 pixels or larger, so the browser does not zoom in when a field takes
focus. The tab bar marks the current page.

- Dialogs are sheets that rise from the bottom of the screen. Drag one down
  by its handle or its title to close it. On Android, **Back** closes an open
  sheet or menu instead of leaving the page, in browsers that have
  `CloseWatcher` (Chrome, Edge and Samsung Internet). While a sheet is open,
  notifications show at the top of the screen, clear of its buttons.
- On a touch screen, a dialog takes focus itself, not its first field.
  **Ask Contrack** and the sign-in screens put no cursor in a field either.
  The on-screen keyboard opens only when you tap a field.
- On a touch screen, controls keep their 44 px size at every width, a tablet
  too, and no control waits for a hover. A long press on an icon button shows
  its name.
- While you type, the tab bar steps aside, and the note's **Save** bar and a
  sheet's buttons stay above the keyboard.
- The app keeps clear of the status bar, the home indicator and, on a phone
  on its side, the camera cutout. On its side the rail packs tight, so
  Settings stays in reach.
- Added to the Home Screen, Contrack opens as an app, with shortcuts to
  Pulse, Ask Contrack and the map. The browser bar takes the theme you chose
  in the app.

## How it is checked

This half is for contributors.

### What CI runs

The **Browser accessibility** job in `.github/workflows/ci.yml` builds the
production bundle and runs `npx playwright test` in headless Chromium. Each
worker starts its own production server (`NODE_ENV=production`, `dist/`, the
CSP on) on a free port, with a new temporary `DATA_DIR`. The suite runs with
reduced motion, the `en-US` locale and the `America/Los_Angeles` time zone.
The report is uploaded on every run.

| Spec                           | What it holds                                                                                                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `axe.spec.ts`                  | Eight screens against WCAG 2.2 AA, four of them in dark too. Landmark and heading rules on six screens and two phone screens                                           |
| `keyboard.spec.ts`             | The skip link, the sidebar in order with a visible ring in both themes, `/`, the list's arrow keys, the `Ctrl Alt` keys and the Tab budget                             |
| `contact.spec.ts`              | Focus when a contact opens, the list keys, the header menu, tracking, the timeline and the composer. On a phone: Back, the call and mail links, Share and a long press |
| `dialogs.spec.ts`              | Five dialogs: focus in, `Tab` kept inside, `Esc` (a list inside a dialog closes first), focus back, and a scan while open                                              |
| `search-announcements.spec.ts` | The status messages and alerts of People and Notes searches                                                                                                            |
| `palette-keys.spec.ts`         | The command palette: the arrows, `Esc` one layer at a time, `aria-activedescendant` in every list it shows, focus kept and given back                                  |
| `mobile-forms.spec.ts`         | A Pixel 7: the tab bar, the new contact sheet with 16 px fields, and setup errors tied to their fields                                                                 |
| `metrics.spec.ts`              | A 390 px phone: 44 px targets and 11 px text on seven screens                                                                                                          |
| `phone-shell.spec.ts`          | Typing hides the tab bar and keeps Save in view, a sheet drags closed, the browser bar's theme, asset caching, the rail on its side                                    |
| `account-transitions.spec.ts`  | A gated instance: setup, sign out, sign in, an expired session and a forced password change                                                                            |

Most other specs, such as Pulse, the map and Settings, also scan the screens
they reach. In the unit suite, `tests/unit/frontend/style/stylesFloor.test.ts`
fails on text under 11 px and on a focus ring drawn by a component.
`themeContrast.test.ts` beside it checks both palettes and every accent
against WCAG AA.

### Run it locally

```bash
npm run build                    # the suite serves dist/
npx playwright install chromium  # first run only
npm run test:e2e                 # every journey, headless
npm run test:e2e:ui              # pick a test and watch it
npx playwright test -g "skip link" --headed
```

Every run writes `playwright-report/`. Open it with
`npx playwright show-report`. It holds each axe scan as JSON and, for a
failed test, its screenshot and the server's log as `server.log`. Specs that
take docs screenshots save them in `test-results/docs-screenshots/`, or in
`docs/screenshots/` when `DOCS_SCREENSHOTS=1` is set.

### The rules the suite holds

- **Status**: results and progress go to a polite region, `LiveStatus` in
  `src/components/ui/`, that is in the page before it speaks. The search words
  are in `src/lib/searchAnnouncements.ts`. An error takes `role="alert"`, and
  a field's error sets `aria-invalid` and `aria-describedby`.
- **Dialogs**: build on `Modal` in `src/components/ui/`. It names the dialog,
  moves focus in, keeps `Tab` inside, closes on `Esc` and returns focus.
- **Structure**: one named `main` per route, one `h1`, headings in order, and
  nothing outside a landmark. Destination names come from `src/lib/names.ts`.
- **Names and focus**: name a control by its text or `aria-label`, never by
  `title` alone, and put an explanation in `InfoTip`. One `:focus-visible`
  rule in `src/index.css` draws every ring, and `.focus-frame` draws it on a
  composite field.
- **Tab budget**: from the top of the page, a contact's name is within 21
  presses of `Tab`, and the first Network row within 18. A new stop in front
  of the content raises the budget in `keyboard.spec.ts`, with the reason in
  the pull request.
- **Phones**: 44 px targets on every touch screen (`sm:pointer-fine:` drops
  them only for a mouse), with `hit-area` for a small control, and 16 px
  fields on a touch screen, which `src/index.css` sets. See `.agent/STYLE.md`.

## What a person still checks

Automation checks the markup a screen reader reads and the focus a keyboard
user lands on. It cannot hear a screen reader. Before a release, and after a
change to a live region, a dialog or the sign-in screens, one person does this
pass. Record the date and the screen reader and browser in the release notes.

### Keyboard only

1. Load `/` and press `Tab`, then `Enter` on **Skip to main content**. Focus
   is on the list's current row. `↓`, `↑` and a letter move focus without
   opening anyone, and `Enter` opens the contact with focus on its name.
2. Tab through the sidebar. Every stop shows a ring, in light and in dark.
3. Press `/`, type a name and press `Esc`: the list filters, then clears.
   Press `N`, move through the form with `Tab`, and close it with `Esc`.
4. Open the shortcuts dialog from the sidebar's **Keyboard shortcuts**
   button. Focus stays inside on `Tab`, and `Esc` puts it back on the button.
5. On **Ask Contrack**, open a result with `Enter`, `Tab` inside the card,
   and press `Esc`. Focus is back on the result.
6. Sign out and sign in again with `Tab` and `Enter` only.

### Screen reader

Use VoiceOver with Safari on macOS and NVDA with Firefox or Chrome on
Windows. Do steps 1 to 4 with both.

1. On **Ask Contrack**, ask a question. You hear "Searching your network
   for …", then "N matches for …" or "No matches for …". Nothing is read
   twice, and nothing is read while you type.
2. Switch to **Notes** with the arrow keys, type a word and press `Enter`.
   You hear "N notes for …". Choose **Last 30 days**, and you hear the new
   count once.
3. Stop the server and ask again. You hear "Could not search" as an
   interruption, and nothing from the status region.
4. Leave the page and come back. The results show, and nothing is read.
5. Open the shortcuts dialog. You hear "Keyboard shortcuts, dialog".
6. Open a contact. You hear its name as heading level 1. The landmarks list
   shows "Contacts" and "Contact" on a wide screen, and one main on a phone.
7. Submit a wrong password on the sign-in screen. You hear "Incorrect
   username or password." On the setup screen, type an email that is not
   valid and press `Tab`. You hear that the field is not valid, and why.

### Zoom, motion and a phone

1. At 200% browser zoom, `/`, `/search` and `/settings` cut nothing off and
   need no sideways scrolling.
2. With reduce motion on in the operating system, dialogs and result cards
   appear with no animation, and the corvid holds still.
3. On a phone, or in device mode at 412 px wide, the five tabs are easy to
   hit. **New contact** rises from the bottom, no field zooms the page, and
   **Save contact** stays above the keyboard. The account row at the top of
   **Settings** signs out. With VoiceOver on, **Back** from a contact puts
   focus on the row you opened.

## Add a journey

Write the spec against `test` from `tests/e2e/fixtures/test.ts` for an open
instance, or against `gatedTest` when the journey starts before sign-in. Go
to a page with `page.goto("/…")`, because each worker sets `baseURL`. Find
elements by role and name, and assert what the next screen says, not the URL.
Scan every screen the journey reaches with `expectPageAccessible`, a new page
with `expectPageStructured` too, and an open dialog with
`b.include('[role="dialog"]')`. Script a People search with
`answerPeopleSearch` from `fixtures/search.ts`, and answer the basemap with
`stubBasemap` from `fixtures/map.ts`.

## Related

- [Keyboard shortcuts](keyboard-shortcuts.md)
- [Getting started](getting-started.md#find-your-way-around)
- [Architecture](architecture.md)
- [Contributing](../CONTRIBUTING.md)
