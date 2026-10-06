# Style guide

The visual and code rules for Contrack v2. Many are enforced by tests, named
beside each rule. The tokens live in `src/index.css` (`@theme`) and
`src/lib/styles.ts`. When this file and the code disagree, the code and its
tests win, and this file needs a fix.

## 1. Visual language

### Colour

- One primary (`--color-primary`, `#006a91` light, `#6ec6ee` dark) for actions,
  links, selection and focus. A contact's colour replaces the primary on that
  contact's page only. A picked accent derives its own readable palette
  (`src/lib/theme.ts`).
- Warm paper surfaces, from `surface` up to `surface-container-highest`. Text
  is `on-surface` or `on-surface-variant`. Semantic colours: `success`,
  `warning`, `error`, `info`.
- Text on a primary wash (`bg-primary/10` to `/20`) is `text-on-primary-wash`,
  never `text-primary`, so it clears AA. `themeContrast.test.ts` holds every
  token pair to WCAG AA in both palettes.
- **`--color-ai` means one thing: a model wrote this.** It marks AI-derived
  data (enriched interests and tags, the AI note glyph), never AI features or
  controls, which use the primary. No vibe or accent preset sits within 30
  degrees of its hue.
- ❌ `violet-*`, `fuchsia-*`, `purple-*`, `indigo-*`, or any raw palette colour
  for a category.

### Tones

A category colour comes from one map in `src/lib/styles.ts`, so a colour means
the same thing everywhere: `TONE_DOT` (a 6 px dot), `TONE_WASH` (a chip or tile
on its 10 percent wash), `TONE_TEXT` (the ink).

| Tone      | Means                                    |
| --------- | ---------------------------------------- |
| `error`   | Overdue, at risk                         |
| `primary` | Today, an action to take, catch up       |
| `warning` | A birthday, a possible duplicate, fading |
| `success` | New people, strong                       |
| `neutral` | Everything else                          |

A search match is a plain `<mark>`, painted by the base layer
(`--color-highlight`). Never classes on the `mark`.

### No-Line hierarchy

Lines are a failure of hierarchy. Sections are told apart by a surface step,
not a border.

- ❌ `border-*` for sectioning.
- ✅ Allowed lines: the focus ring, a `.btn-*` edge, a floating panel's hairline
  (`.menu-panel`), a drag-and-drop outline, the timeline's rail.

### Type

- Headlines are Manrope (`font-headline`), body is Inter (`font-body`), both
  self-hosted in `public/fonts/`.
- **Sentence case** for every string a person reads, including `aria-label`s
  and toasts. Names from `src/lib/names.ts` keep their spelling.
- **A statement ends without a period**: descriptions, hints, empty states,
  toasts, buttons. Words a person only hears (an `aria-` string, a live
  region) keep it. `copyPeriods.test.ts` checks.
- **11 px type floor.** No text under 11 px anywhere. Body 14 px, values 12 px
  or more, 11 px for uppercase labels, badges and key chips.
  `stylesFloor.test.ts` fails on `text-[9px]` and `text-[10px]`, and
  `tests/e2e/metrics.spec.ts` measures the rendered text on a phone.
- Uppercase labels track at `0.08em` (`LABEL`, `SECTION_HEADING`,
  `FORM_LABEL`). Never `tracking-widest`.
- Use the class tokens in `styles.ts` (`LABEL`, `FIELD_LABEL`, `META_LINE`,
  `PAGE_TITLE`, `PAGE_DESCRIPTION`, `SEARCH_INPUT` and the others) instead of
  ad hoc sizes. A link inside a sentence is `TEXT_LINK`, underlined at rest.
  A value's field opened in its place is `INLINE_INPUT`.

### Radius

A chip is 4 px (`rounded-md`), a control 6 px (`rounded-xl`), a card 8 px
(`rounded-2xl`), a dialog 12 px (`rounded-3xl`). `rounded-full` is for circles
only: avatars, dots, rings, switch tracks.

### Motion

One curve (`--ease`) and three durations: `--dur-fast` 120 ms (a press, a
menu), `--dur-base` 160 ms (a hover), `--dur-slow` 240 ms (arrival).
`src/lib/motion.ts` mirrors them for `motion/react`. ❌ A numeric
`duration-*` class. Reduced motion, from the system or the **Motion**
setting, turns movement off.

## 2. Components

Use the primitives in `src/components/ui/` and the classes in
`src/index.css`. Do not rebuild one.

### Buttons

- `.btn-primary` (one main action per view), `.btn-secondary`, `.btn-danger`
  (an irreversible act), with `.btn-sm` and `.btn-icon`. A button has a face on
  a darker edge: it rises on hover and sinks on press. The call site adds
  layout only.
- ❌ A background, size, padding, shadow, ring or hover class on a `.btn-*`,
  an ad hoc filled button, or `rounded-full` on a filled button or a chip.
  `stylesFloor.test.ts` fails on these.
- `.btn-latch` for a button that opens a panel and closes it again
  (`SidePanel`).

### Hover

| Surface                                                   | Hover                                      |
| --------------------------------------------------------- | ------------------------------------------ |
| A flat control: a row, a ghost button, a pill, a nav item | `state-layer` (6 percent ink, 10 on press) |
| A tile that is a control                                  | `lift` (rises 1 px)                        |
| A card that is a control                                  | `card-interactive` (rises 2 px)            |
| A static card or row                                      | None                                       |

❌ `hover:bg-*` beside the state layer, or a shadow, ring, scale or translate
hover on a card.

### Elevation

A lift says "this whole thing opens something". A self-contained surface that
acts as one control lifts. A row in a list, a button and a static card never
lift. The Network list is the one exception: its rows rise toward the pointer
(`useProximityLift`). ❌ A hand-rolled `hover:-translate-y-*`.

### Selection and focus

- A selected row is `SELECTED_ROW` (a 10 percent primary tint) with its name in
  `text-on-primary-wash`. A selected pill or chip is `SELECTED_TINT`. A radio
  option adds a `RadioDot`, through `ChoiceGroup` or `Segmented`.
- ❌ A coloured bar down a box's edge, a ring on a selected row, a filled
  primary pill for a selection.
- **One focus ring**: the base layer's 2 px primary outline. A composite field
  uses `focus-frame`. ❌ `focus:ring-*`, `focus-visible:ring-*`,
  `focus:outline-none`.

### Menus, switches, dialogs

- `ActionMenu` for actions, `Select` for values, `ContextMenu` for right-click.
  They open in the top layer. No native `<select>`, and no `glass-panel` on a
  menu.
- `Switch` for every on/off setting. A setting off its default shows the
  `CHANGED_MARK` dot, and the page ends with one **Reset to defaults** button.
- `Modal` renders as a bottom sheet below `sm`. `ConfirmDialog` for anything
  irreversible. Never a hand-rolled overlay. A dialog with a header of its
  own ends it with `DialogCloseButton`, the one X named "Close dialog", and
  its buttons sit in `DIALOG_ACTIONS`.
- `ActionMenu` and `ContextMenu` draw the same rows (`MENU_ITEM`, `MENU_ICON`),
  and a row that waits is dimmed by `MENU_ITEM` itself.
- `EmptyState` for every empty screen: an icon or the corvid, a title, at most
  one sentence and one action.
- `glass-panel` is for modals, the command palette and toasts.

### Page layout

- Every page's top is `PageHeader`: an optional back link, the title (the
  page's `h1`, in `PAGE_TITLE`), an optional suffix, one line of description,
  then children. The Map has no header.
- The Network list and the Settings rail share one resizable left pane width
  (`LEFT_PANE`).
- A side panel (Ask Contrack's history, the map's insights) is `SidePanel`: one
  latching button in the top right, a 320 px panel over the page, a bottom
  sheet below `lg`.
- Every scroller draws the same thin bar. The two left panes keep it on the
  left and show it on hover.

## 3. Phones and touch

### 44 px minimum hit area

Every control a finger can reach has a hit box of at least 44 by 44 CSS
pixels. Use `IconButton` for an icon button. Add `hit-area` to a control that
looks smaller (a chip's remove button, a swatch). Give rows and inputs
`min-h-[44px]`, and drop it only for a mouse: `sm:pointer-fine:min-h-0`, never
`sm:min-h-0`. A tablet and a phone on its side are wider than `sm` and still
touch screens. ❌ `hit-area` on a form field or inside `overflow-hidden`.
`tests/e2e/metrics.spec.ts` measures every visible control on a 390 px phone.

### Other phone rules

- No hover-only control on a touch screen, at any width. A control that waits
  for hover hides only for a mouse (`pointer-fine:opacity-0`,
  `sm:pointer-fine:w-0`), and every action shows at rest on a touch screen.
- An icon-only control is labelled with `RailTooltip` (`side="bottom"` under
  a header button, `bottom-end` at a header's right end). A mouse sees the
  label on hover and a finger on a long press. An icon-only `ActionMenu`
  passes `title`, and the menu draws the tooltip.
- Key chips (`<kbd>`) hide below `sm`.
- Inputs are 16 px on a phone, so iOS does not zoom.

## 4. Code conventions

- **Data fetching** goes through React Query hooks in `src/api/`. Defaults are
  in `src/main.tsx` (`staleTime` 30 s, `gcTime` 10 min, `retry` 1, no refetch
  on focus). Overrides are in `src/lib/queryConfig.ts`. A mutation invalidates
  what it changed.
- **State**: server state in React Query, local state in `useState` or
  `useReducer`, shared state in the contexts in `src/contexts/`.
- **Types**: `strict` is on and `any` is an error. Use `Record<string,
unknown>` and narrow. Cast a better-sqlite3 row once, to a narrow row type.
- **Validation**: zod schemas at the route.
- **Imports**: relative imports under `server/`, `shared/`, `src/db/` and
  `scripts/` carry the `.ts` extension. `@/` is for frontend code only.
- **Docs in code**: exported functions in `src/lib/`, `server/utils/` and the
  repository types carry TSDoc.
- **Shortcuts**: every key binding is a row in `src/lib/shortcuts.ts`, and
  bare letters obey the **Single-key shortcuts** switch.
- **Command palette**: a control inside it that is not a `Command.Item` needs
  `onMouseDown={(e) => e.preventDefault()}`, or cmdk closes the palette.

## 5. Anti-patterns

- ❌ Borders for sectioning, a second focus ring, a hover fill beside the state
  layer.
- ❌ `useEffect` fetch loops.
- ❌ A provider SDK import outside `server/ai/adapters/`.
- ❌ Business logic in a route.
- ❌ An empty `.catch(() => {})` or `console.log` in app code.
- ❌ Relying on a `vec0` cascade.
- ❌ A raw read of `contact.relationshipScore` in the UI (see section 7).

## 6. Brand

The corvid is the one mark. `src/assets/corvidPaths.ts` holds the drawing, and
everything that shows the bird reads it: `CorvidMark`, the rig, the favicons,
the app icons and the brand kit in `docs/brand/`.

- **The ring never moves.** Only the bird animates. When it flies, the ring
  waits empty.
- The stroke is `currentColor`. The eye is `--color-corvid-eye` and never
  follows the accent.
- The mark is decorative (`aria-hidden`) unless it is the one thing that names
  the app.
- Four optical sizes (`tiny`, `small`, `medium`, `large`). The size a person
  sees picks the master. Never scale one weight to every size.
- **Public icons are generated, never edited.** `npm run brand:icons` writes
  `public/` and `docs/brand/`, including the animated README lockups.
  `tests/unit/frontend/brand/icons.test.ts` fails when a committed file differs
  from a fresh render. No CSS variables and no system fonts in anything the
  script draws.
- **The rig** (`src/assets/corvidRig.ts`) poses the bird from numbers.
  `HOME_POSE` draws the logo point for point. Never squash the bird with CSS,
  and never add a stroke without a place in `HOME_POSE` that draws nothing.
- **Motion levels**: the **Corvid motion** setting is `full`, `subtle` or `off`.
  Reduced motion always wins: read the level through `useCorvidLevel()`, never
  `mascotMotion` alone.
- **Life**: `useCorvidLife` runs the brain (`src/lib/corvidBrain.ts`) with the
  repertoire in `src/lib/corvidMotion.ts`: blinks, small acts, big acts, and
  held postures (ready, dozing). It draws frames only while something moves.
- **Flights**: call `flyCorvid({ kind })` from `src/lib/corvid.ts`. One overlay,
  `CorvidFlight`, flies the bird. Never animate the bird inside a view.
- **Reactions**: `corvidReact()` on success only (a nod when a follow-up is
  done, a hop for a new contact, a preen after a merge). Never on a failure,
  a crash or a destructive confirmation.
- The thinking bird never carries meaning alone. Text beside it says what the
  app waits for.

## 7. The ring means tracked

The relationship score belongs to the people a person chose to track. Every
surface asks `scoreView` in `shared/scoreBand.ts`, which answers one of three
states:

| State       | Shows                                                                       |
| ----------- | --------------------------------------------------------------------------- |
| `untracked` | No ring, no chip, no words                                                  |
| `unscored`  | The empty track and "No interactions yet"                                   |
| `scored`    | The arc in its band colour (Strong, Fading, At risk) and "Score 72, strong" |

- An untracked contact is never at risk, and no row speaks a score for it.
- One control sets the flag on a contact page: `TrackButton`, with the
  **Keep up** menu (Weekly, Monthly, Quarterly, Yearly, and **Stop tracking**).
  The `t` key, the palette and the bulk bars run the same `useTrackToggle`,
  with the same toast and Undo.
- A control keeps one shape and one width whatever its state says.
- The words: Track, Tracked, Not tracked, Stop tracking, Keeping up, Catch
  up, cadence. "Stop tracking" is the action everywhere: the Track menu, the
  bulk bars, the palette and the toasts. ❌ "Untrack". Strong, Fading and At
  risk are band words only.

## 8. Pulse

Pulse answers, in order: what is today, who do I reach, what changed. The rules
are `src/views/pulse/lib/pulseStyles.ts` in words.

- Sizes come from `PULSE_TYPE`. The grid is `GRID_CLASSES` and
  `COLUMN_CLASSES`: Focus, Intelligence and Network at `xl`, two columns at
  `lg`, one below.
- A card is a title and a body, with no line and no icon. A card with nothing
  to show is one line (`CardFrame variant="line"`).
- The masthead is `PageHeader` with the day as its suffix and one sentence of
  counts. **Log note** is the one primary button.
- Up next is a pane of rows grouped Overdue, Today, This week, Birthdays and
  Catch up, each in its tone. Chips say facts in words ("12 days overdue").
  Below `lg` it shows its first eight rows and **Show all**.
- Enter belongs to the control that has focus. Rows use a roving tab stop,
  and only the current row's controls are Tab stops. The first queue key
  only shows the highlight, and no page key acts while a dialog or a menu is
  open.
- A change to a follow-up or to the layout ends with a toast with Undo: done,
  snooze, reset.
- Customize mode drags a card by its grip and offers a Move menu, so no one
  has to drag. Its bar sits under the masthead, where no toast covers it,
  and each column shows the name its Move menu says.

## 9. Decisions the machine asks for

Possible duplicates is the model for a screen where a person decides what the
machine is unsure of. The rules are `src/views/dedupe/components/` in words,
and `tests/unit/frontend/dedupe/duplicateQueue.test.tsx` holds the keys and
the Undo.

- **One place to decide.** A kind of decision has one review screen. Every
  other place links to it and shows the same count: Settings, the Pulse inbox,
  the command palette, a contact's banner.
- **Words, not scores.** Never print a percentage from the engine or a model.
  Show the reason in plain words, and say the level once, in a part's heading:
  Very likely, Likely, Check carefully. A setting that holds a threshold says
  what it merges, not the number.
- **The caution sits where the doubt is**: on the row before anything opens,
  under the field it is about, in the warning tone with its glyph, and named
  by the button it guards (`aria-describedby`). A pair with a caution never
  joins a batch action.
- **Show the differences, then what is lost.** One column for each record,
  only the rows that differ at first, the rest in one "Same:" line with **Show
  all fields**. A value the action drops is struck through, with "not kept"
  for a screen reader. The comparison ends with what moves, what is not kept,
  and how to undo it. ❌ KEPT and DISCARDED labels.
- **Undo over confirm.** A reversible decision ends with a toast with Undo
  (`withUndo`), one at a time, and `Z` takes back the last one. A durable
  history has Undo too. An undo of a machine's decision records the person's
  answer, so the machine does not make it again.
- **The machine says what it did.** Background work that changes data tells
  the person once, with Undo. A page for a record that no longer exists goes
  to the record that replaced it and says so.
- **One key per decision, then the next.** `J` and `K` move, `L` acts, `H`
  declines, `Z` undoes, and focus moves to the next item after a decision. A
  key another control used first (`event.defaultPrevented`, an arrow in a
  radio group) is that control's, and so is a key while a menu or a dialog
  is open. Letters obey **Single-key shortcuts**, and Caps Lock does not
  change them.
- **A caution takes two steps.** The first `L` on a Check carefully item
  opens its comparison and puts focus on the action, which the caution
  describes. The second `L` or `Enter` acts. Its button is never the primary
  one, and below `lg` its row offers Compare instead.
- **List and detail.** From `lg` the list and the open item sit side by side,
  with the item's actions at the top of its pane. Below `lg` each row carries
  its actions, and the item opens in a sheet with its actions at the bottom.
- ❌ A swipe card for a decision that changes data. It hides the comparison
  and rewards speed. A swipe may speed up a row action that a button also
  does, never replace it.
- The AI colour and glyph mark a reason a model wrote. A reason from a fixed
  rule takes the neutral ink and the glyph of what matched: an envelope for an
  email, a phone for a number.
