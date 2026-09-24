# Style Guide & Code Conventions

_This document enforces the visual identity and coding patterns of the project. It prevents context drift as multiple agents work on the codebase. Agents MUST follow these rules strictly._

## 1. Visual Language & Tokens

### CSS Framework

- **Tailwind CSS v4** is strictly enforced via `@tailwindcss/vite` plugin.
- All design tokens are defined in `src/index.css` under the `@theme` block.
- Custom component classes are defined in the `@layer components` block.

### Color System

#### Primary Palette

| Token               | Value     | Usage                                                  |
| ------------------- | --------- | ------------------------------------------------------ |
| `primary`           | `#006a91` | Primary actions, active states, interactive highlights |
| `primary-dim`       | `#00628a` | Dimmed primary states                                  |
| `primary-container` | `#47befd` | Pale primary fills only, never text                    |
| `on-primary`        | `#ffffff` | Text/icons on primary-colored backgrounds              |

#### Surface Hierarchy (Paper Stack — "No-Line" Rule)

Warm paper. The light greys lean warm (hue 85 in OKLCH, chroma 0.005 to
0.010) at the lightness the cool greys were measured at, so every text colour
clears AA by the same margin as before. The ink stays a cool slate. The dark
palette is unchanged.

| Level             | Token                       | Hex       | Use                                    |
| ----------------- | --------------------------- | --------- | -------------------------------------- |
| Base Layer        | `surface`                   | `#f8f6f2` | Page background                        |
| Sectional Layer   | `surface-container-low`     | `#f2f1ed` | Section backgrounds, input backgrounds |
| Interactive/Card  | `surface-container-lowest`  | `#ffffff` | Cards, elevated inputs                 |
| Container         | `surface-container`         | `#f1eeea` | Form fields, chips                     |
| Elevated/Emphasis | `surface-container-high`    | `#e7e5e1` | Kbd tags, disabled buttons, dividers   |
| Maximum Emphasis  | `surface-container-highest` | `#e5e2db` | Strong emphasis backgrounds            |
| Hairline          | `outline-variant`           | `#d4d1cb` | Menu edges, the secondary button edge  |

#### Text Colors

| Token                            | Usage                               |
| -------------------------------- | ----------------------------------- |
| `on-surface` (`#2a3437`)         | Primary text on surface backgrounds |
| `on-surface-variant` (`#566164`) | Secondary/muted text, placeholders  |

#### Semantic Accent Colors (Allowed)

| Token     | Semantic Meaning                               |
| --------- | ---------------------------------------------- |
| `success` | Success, healthy, active, merge approval       |
| `warning` | Warning, nearing due, caution                  |
| `error`   | Error, overdue, destructive actions, rejection |
| `info`    | Informational (phone match badge)              |

#### Tones: colour that means something (`src/lib/styles.ts`)

A category colour comes from one map, so a colour means the same thing on
every card. `TONE_DOT` is the 6 px dot before a group's name, `TONE_WASH` a
chip or an icon tile (the tone's 10 percent wash with its own ink), and
`TONE_TEXT` the ink alone.

| Tone      | Means                                    | Where                         |
| --------- | ---------------------------------------- | ----------------------------- |
| `error`   | Overdue, at risk                         | Up next overdue, Keeping up   |
| `primary` | Today, an action to take                 | Up next today, catch up       |
| `warning` | A birthday, a possible duplicate, fading | Up next birthdays, Inbox      |
| `success` | New people, strong                       | Inbox new people, Keeping up  |
| `neutral` | Everything else                          | This week, Inbox hygiene rows |

- ✅ A group's dot, its rows' leading glyph and its chips read from the same
  tone.
- ❌ A raw palette colour (`amber-500`, `text-amber-800`) for a category.
- ❌ The AI colour as a tone. It marks what a model wrote.

#### The highlighter (`--color-highlight`)

The words a search matched are a plain `<mark>`. The base layer paints it: a
warm wash (`#fce7a6`, dark `#5a4116`) with the ink colour on it whatever the
text around it is. Never a second blue, and never classes on the `mark`.

#### AI-derived data (`--color-ai`)

| Token        | Light     | Dark      | Usage                                                  |
| ------------ | --------- | --------- | ------------------------------------------------------ |
| `ai`         | `#6f3fd0` | `#bfa3f9` | A glyph or icon on a surface or on `bg-ai/10`          |
| `on-ai-wash` | `#6734c6` | `#bfa3f9` | Text on a `bg-ai/10`, `/15` or `/20` wash (an AI chip) |

The second accent, and it means one thing: **a model wrote this, not the
person**. The interests and tags an enrichment run added wear it
(`bg-ai/10 text-on-ai-wash` with a sparkle), and so does the note glyph on the
timeline (`bg-ai/10 text-ai`).

- ✅ AI-derived data only.
- ❌ Not for AI features. The Ask Contrack button, the briefing button and the
  enrichment page are controls, and controls use `primary`.
- ❌ Not for a selection. The composer's selected type is a selection, so it
  uses `primary`.
- The token is not part of an accent. A contact's colour replaces `primary` on
  its page and leaves `ai` alone.
- No accent sits on its hue. The contact vibes and the accent presets keep
  `AI_HUE_CLEARANCE` (30) degrees of OKLCH hue away from `ai`, so there is no
  violet or indigo vibe and no violet preset: on a violet contact the Save
  button and every link wore the colour that means "a model wrote this".
  `tests/unit/theme.contrast.test.ts` holds it.
- Defined in three places in `src/index.css` (`@theme` and both dark blocks)
  and in `LIGHT` and `DARK` in `src/lib/theme.ts`.
  `tests/unit/theme.contrast.test.ts` checks that they agree and clear AA.

#### Off-Palette Colors (FORBIDDEN)

- ❌ `violet-*`, `fuchsia-*`, `purple-*` — replaced by `primary` tokens, or by
  `ai` for AI-derived data
- ❌ `indigo-*` — replaced by `primary-dim`

### Surface Hierarchy ("No-Line" Principle)

**Lines are a failure of hierarchy.** Containment is strictly enforced by surface color shifts.

- ❌ **NEVER** use `border-b border-gray-200` (or any `border-*`) for visual sectioning.
- ✅ **ALWAYS** use a different `bg-` surface level between adjacent sections.

**Exceptions** — lines ARE allowed for:

- The one focus ring (the base layer's outline, see "Focus" below)
- A pressable button's edge: the 1 px border and the solid shadow under a
  `.btn-*` are part of the control, not a boundary between sections
- A floating panel's hairline (`.menu-panel`), which has no neighbour to
  shift against
- Drag-and-drop overlay borders (`border-4 border-dashed border-primary`)
- The timeline vertical line (decorative, not sectioning)

### Typography

| Role      | Tailwind Class                                                                       | Font    | Weights            |
| --------- | ------------------------------------------------------------------------------------ | ------- | ------------------ |
| Headlines | `font-headline`                                                                      | Manrope | 400, 600, 700, 800 |
| Body      | `font-body`                                                                          | Inter   | 300, 400, 500, 600 |
| Labels    | `LABEL`: `text-[11px] font-bold uppercase tracking-[0.08em] text-on-surface-variant` | Inter   | —                  |

#### One tracking for uppercase (REQUIRED)

Every uppercase label tracks at `0.08em`: `LABEL`, `SECTION_HEADING`,
`FORM_LABEL`, or `tracking-[0.08em]` where none of those fits. Never
`tracking-widest`. `tests/unit/styles.floor.test.ts` fails on it.

#### Sentence case (REQUIRED)

Every string a person reads is sentence case: buttons, headings, labels,
menu items, tooltips, `aria-label`s, placeholders, empty states and toasts.
Capitalize the first word and proper nouns only. "Index missing", not "Index
Missing". Product and destination names from `src/lib/names.ts` (Contrack,
Ask Contrack, Pulse, Network, Map), brand names and acronyms keep their
spelling.

#### A statement ends without a period (REQUIRED)

The line under a page's title, a row's description, a field's hint, an
empty state's sentence, a card's subtitle, a dialog's description, a toast
and a button are statements, and they end without a period: "Find and
merge contacts that are the same person". A statement of several sentences
keeps the periods between them and drops the last one. An ellipsis
("Searching…") is not a period.

- ✅ "Choose 2 to 5 contacts to merge. All their data is combined"
- ❌ "Runs a few seconds after you add one."
- ✅ Words a person only hears keep the period, because a speech engine
  ends a sentence on it: an `aria-` name or description, a live region's
  words (`lib/searchAnnouncements.ts`) and the drag announcements
  (`PulseGrid`). A string that copies another system's words exactly keeps
  them too, such as the server's sign-in error.
- `tests/unit/copy.periods.test.ts` fails on a statement prop, on the text
  before a closing tag and on any sentence written as a string under `src/`
  that ends with one, and on a settings page's or a destination's
  description that does.

#### 11 px type floor (REQUIRED)

No text a person reads is smaller than 11 px, anywhere. Body text is 14 px,
values are 12 px or more, and 11 px is for uppercase labels, badges and
keyboard chips.

- ❌ `text-[9px]` and `text-[10px]` (or any arbitrary size under 11 px).
  `tests/unit/styles.floor.test.ts` fails on them in `src/`.
- ✅ Use the tokens below. They already sit on the floor.
- `tests/e2e/metrics.spec.ts` measures the rendered size of every visible text
  node on a 390 px phone.

#### Shared class tokens (`src/lib/styles.ts`)

| Token                                           | Size          | Use                                                            |
| ----------------------------------------------- | ------------- | -------------------------------------------------------------- |
| `LABEL`, `LABEL_PRIMARY`                        | 11 px, caps   | Micro labels, tracking 0.08em                                  |
| `SECTION_HEADING`                               | 11 px, caps   | Card titles ("DETAILS"), one step below body                   |
| `FIELD_LABEL`                                   | 12 px         | The name above one value ("Location"), sentence case           |
| `META_LINE`                                     | 14 px         | Facts under a name, joined by a middle dot                     |
| `KBD_SM`, `MICRO_BADGE`, `STATUS_BADGE_SUCCESS` | 11 px         | Keyboard chips, inline badges                                  |
| `TAG_PILL`, `SOURCE_BADGE`                      | 11 px         | Pills                                                          |
| `ICON_BTN`                                      | 32 px visual  | Dense toolbar icon buttons, with `hit-area` (44 px target)     |
| `PAGE_TITLE`                                    | 24 / 30 px    | A page's title, its name and its `h1` (see \"Page header\")    |
| `PAGE_TITLE_SUFFIX`                             | 24 / 30 px    | The title line's second part in the variant ink: Pulse's day   |
| `PAGE_EYEBROW`                                  | 13 px         | The small line above a title: the back link to the parent page |
| `PAGE_DESCRIPTION`                              | 14 / 16 px    | The one line under a title                                     |
| `SEARCH_INPUT`                                  | 44 px / 40 px | The list search box: 44 px tall on a phone, 40 px from `sm`    |

### Radius System

One tight scale. A control is 6 px, a card is 8 px, a dialog is 12 px and a
chip is 4 px. `rounded-full` is for circles only: avatars, dots, rings and
switch tracks. A chip, a badge, a filter pill or a `Segmented` option is
`rounded-md`.

| Token              | Value                     | Usage                                                 |
| ------------------ | ------------------------- | ----------------------------------------------------- |
| `sm`               | `0.1875rem` (3px)         | Keyboard chips, the smallest badges                   |
| `md`               | `0.25rem` (4px)           | Chips, badges, filter pills, menu items               |
| `lg`               | `0.375rem` (6px)          | Inner controls: tab items, "+ Add", chip tap boxes    |
| `xl`               | `0.375rem` (6px)          | Controls: buttons, inputs, list rows, icon buttons    |
| `2xl`              | `0.5rem` (8px)            | Cards, panels, popovers, `.menu-panel`                |
| `3xl`              | `0.75rem` (12px)          | Dialogs, sheets, the auth card                        |
| Buttons (`.btn-*`) | `0.375rem` (`rounded-xl`) | CSS `.btn-primary` / `.btn-secondary` / `.btn-danger` |
| Circles            | `9999px`                  | Avatars, dots, rings, switch tracks. Never a label    |

## 2. Component CSS Classes (defined in `src/index.css`)

These reusable atomic classes are the blessed patterns. Use them instead of ad-hoc utilities.

| Class              | Pattern                                                                  | Usage                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `glass-panel`      | `rgba(255,255,255,0.80)` + `blur(20px)`                                  | Modals, the Command Palette, floating nav. Not menus                                                                                  |
| `menu-panel`       | Solid card surface, hairline ring, soft shadow                           | Every list that opens under a control. Add `menu-enter` for the entrance, or `menu-enter-none` when Motion animates the panel         |
| `card`             | Card surface, `rounded-2xl`, `p-6`, the soft shadow                      | A static card. `CARD` in `styles.ts`. No hover                                                                                        |
| `card-interactive` | Rises 2 px on hover, its shadow a step up, its edge a primary tint       | Beside `card`, on a card that is itself a control. `CARD_INTERACTIVE`                                                                 |
| `state-layer`      | A 6 percent ink layer on hover, 10 on press, over any background         | Every flat control: a row, a ghost or icon button, a pill, a nav item                                                                 |
| `row-selected`     | A 10 percent primary tint on the row's face, no ring and no bar          | The selected row in a list. `SELECTED_ROW`. A Tailwind `@utility`, so it takes a variant: `aria-selected:row-selected` in the palette |
| `focus-frame`      | Draws the focus ring on a box while its field has focus                  | A composite field: an icon, an input and buttons in one box                                                                           |
| `input`            | `bg-surface-container-low rounded-xl px-4 py-2.5`                        | Text inputs                                                                                                                           |
| `btn-primary`      | The primary face on a darker edge, bold 14 px, 44 px tall (40 from `sm`) | The main call to action. One per view where possible                                                                                  |
| `btn-secondary`    | The card face on the hairline edge, same shape                           | Other actions (Cancel, Back). `btn-secondary text-error` for a destructive act that is not final                                      |
| `btn-danger`       | The error face on a darker edge, same shape                              | An irreversible destructive act: delete forever, remove an account                                                                    |
| `btn-sm`           | 32 px face, 2 px edge, 13 px type, a built-in 44 px tap box              | With a `.btn-*`, in a toolbar, a dense row or a floating bar                                                                          |
| `btn-icon`         | A square face for a glyph with no label                                  | With a `.btn-*`, such as the Network list's New (`ActionMenu variant="primary"`)                                                      |
| `hit-area`         | `::after` box of `max(100%, 44px)`, centred, draws nothing               | A control that looks smaller than 44 px (see below)                                                                                   |

### Buttons: pressable, with an edge

A call to action has depth: a darker edge under its face, the way a key sits
on its base. The face is the button's box, the edge its 1 px border and a
solid shadow `--btn-lift` below it (3 px, 2 px for `.btn-sm`). On hover the
face rises 1 px and the edge grows 1 px, on press the face sinks until 1 px
of edge is left, and the edge's bottom line never moves. Hover is gated on
`@media (hover: hover)`, so a tap never leaves a button raised on a phone.
The edge colour is mixed from the face, so it follows a picked accent, a
contact's vibe and the dark palette.

- ✅ `.btn-primary` for the main action, `.btn-secondary` for the others,
  `.btn-danger` for an irreversible destructive act, `.btn-sm` for the small
  size. The call site adds layout only (`w-full`, `flex-1`, `sm:w-auto`,
  `shrink-0`, a margin). The class sets the face, the edge, the shape, the
  type, the height and the disabled look.
- ✅ One disabled look for all three: flat, with no edge, a
  `surface-container-high` fill and an `on-surface-variant` label. A button a
  person cannot press no longer looks pressable, and a disabled primary no
  longer looks like a secondary.
- ✅ Depth means "this does something". Icon buttons, text buttons, chips,
  rows, tabs and menu items stay flat and take `state-layer`.
- ✅ `.btn-latch` for a button that opens a panel and stays its one way out
  (`SidePanel`'s button): while `aria-expanded` is true the face sits on its
  last pixel of edge, as on press, in the selected tint. It says "open, and
  pressing me closes it" without a second close button.
- ❌ A background, text size, padding, height, shadow, ring, hover, active,
  opacity or disabled class on a `.btn-*`. Utilities come after the class, so
  each of them takes the edge or the face away. The scan in
  `tests/unit/styles.floor.test.ts` fails on them.
- ❌ An ad-hoc filled button (`bg-primary text-on-primary rounded-xl px-4`,
  `bg-red-500 text-white`). It is a `.btn-*`.
- ❌ `rounded-full` on a filled `bg-primary` button, and on any chip, badge,
  filter pill or `Segmented` option: those are `rounded-md`. Circles are for
  avatars, dots, rings and switch tracks. `tests/unit/styles.floor.test.ts`
  fails on a class string with a solid `bg-primary`, `rounded-full` and
  `px-2` or more outside its allow-list.

### Hover: four kinds of surface

| Surface                                                              | Hover                                             |
| -------------------------------------------------------------------- | ------------------------------------------------- |
| A flat control: a row in a list, a ghost button, a pill, a nav item  | `state-layer`: a 6 percent ink layer, 10 on press |
| A tile that is a control: a chip on the page, a row on a card's wash | `lift`: rises 1 px, a soft shadow, down on press  |
| A card that is a control: a search result                            | `CARD_INTERACTIVE`: rises 2 px, shadow a step up  |
| A static card, a static row                                          | None                                              |

The layer is a background image, so a resting wash or a selected tint stays
under it, on any surface and in both palettes. "One surface step up" meant a
different token on a white card, on the page and on a wash, and six hover
recipes had grown on three pages.

- ✅ `ICON_BTN`, `BTN_QUIET`, `listRow`, `filterPill`, `navLink`, `IconButton`
  and the `ActionMenu` and `Select` triggers already carry the layer.
- ✅ A control that floats on a photo, the pencil on a contact's avatar,
  turns its translucent face solid on hover and focus instead. The layer's
  6 percent ink on a clear face over a photo reads as a smudge.
- ❌ `hover:bg-*` or `active:bg-*` on a flat control, beside the layer.
- ❌ A `shadow-*`, `ring-*`, `scale-*` or `translate-*` hover on a card. The
  card class owns its hover.
- ❌ Scaling anything that holds text. A swatch or an avatar may scale.

### Elevation: when a thing lifts

A lift says "this whole thing opens something". It is earned, not
decoration, so the rule is short:

1. **It lifts when it is a self-contained surface that acts as one
   control**: it has its own face (a card, a tile, a chip, a row on a wash
   with space around it) and a press anywhere on it opens or runs one thing.
   A card lifts 2 px (`card-interactive`), and anything smaller lifts 1 px
   (`lift`).
2. **It never lifts when it is one row in a list of rows** (the Up next
   queue, a menu, the history, the settings rail). Rows touch or nearly
   touch, and a lift would stack one over its neighbour. They take the
   state layer. **One list is the exception: the Network list**, the one a
   person scans with the pointer all day. Its rows rise with the pointer's
   nearness (`useProximityLift`, `.proximity-row`): the row under a mouse up
   to 2 px with a soft shadow, and the neighbour on the pointer's side more
   as the pointer nears it, the two lifts always adding up to one. A mouse
   only, no rise under reduced motion, and a key press lays the rows down.
   No other list takes it.
3. **It never lifts when it is a button.** A button has its own edge and
   press (`.btn-*`) or the state layer (`ICON_BTN`, `BTN_QUIET`).
4. **It never lifts when it is static** (a card that only shows), or when
   it holds text a person reads while the pointer rests on it.

- ✅ `lift` carries its own transition. Add no `transition-*` class beside
  it, or the transform snaps.
- ✅ `lift` and `state-layer` may sit together: the tile rises and its face
  takes the layer.
- ❌ A hand-rolled `hover:-translate-y-*` or `hover:shadow-*`.

### Scrollbars: one bar

Every scroller draws the same thin bar: the hairline token for the thumb,
no track (the base layer in `src/index.css`, for all elements). Add no
other scrollbar class. `scrollbar-hide` hides the bar on a row of chips that
scrolls sideways. The two left panes, the Network list and the Settings
rail, keep their bar on the left edge (`dir="rtl"` on the scroller, `ltr`
inside it): away from the list's letter rail, and on the sidebar's side of
the rail.

The two left panes also carry `scrollbar-on-hover`: the thumb shows only
while the pointer is over the pane or the keyboard is in it. A bar against
the sidebar that never goes away reads as part of the sidebar. The lane
stays, so nothing moves when the thumb comes back, and a screen with no
hover keeps the bar the platform draws.

- ❌ No `scrollbar-on-hover` on a page, a card or a dialog. The bar is how a
  person sees that there is more, and only the two panes beside the sidebar
  are always long.

### The left pane: one width

From `lg` the Network list beside a contact and the Settings rail beside a
settings page are one pane: 350 px to open, 300 to 480 px by the edge a
person drags (`ResizeHandle`), and one width stored for both
(`LEFT_PANE` in `src/components/layout/paneWidth.ts`). Moving between
Network and Settings leaves the page beside the pane where it was. The
pane's class reads the width (`w-(--pane-width)`), and the handle sits
inside the pane, which is a child of the row it shares with the page.

- ❌ A second resizable pane with bounds of its own, or a fixed width on a
  left pane.

### The right-hand panel: one button, one panel

A page with a side panel (Ask Contrack's history, the map's insights) uses
`SidePanel` (`src/components/layout/SidePanel.tsx`):

- A button in the page's top-right corner, level with the page title
  (`inset="page"`) or with a toolbar floating over a canvas
  (`inset="overlay"`). It is a `.btn-secondary btn-icon` with
  `.btn-latch`: a square with the panel's glyph alone, the insights bars on
  the map and the clock on Ask, named for the panel, with its key in the
  tooltip. It is a disclosure (`aria-expanded`, `aria-controls`), and it is
  the panel's one way out: no Hide button, no X.
- The panel, 320 px, slides in from the window's edge under the button, over
  the page (an overlay, with a soft shadow on its open edge,
  `.side-panel`), so opening it moves nothing on the page and the button
  never moves. It opens at the slow duration and leaves at the base one, on
  the app's curve, and its content follows it in a beat behind. A page that moves something with
  it reads `SIDE_PANEL_OPEN_MS`: the map eases its padding on the same
  timing and curve.
- Its heading row starts level with the button and ends with the button's
  own face drawn invisible, so the title and the actions stop where the
  button begins at any word length. Under the row the content takes the
  panel's full width, and a scroller in it (`SIDE_PANEL_SCROLLER`) reaches
  the window's edge, so its bar sits on the edge. A panel whose content says what it is keeps its heading for a screen reader and gives the row to a control (`titleHidden`, `lead`): the map's Summary and People switch.
- However it closes (the button, Escape inside it, the page's own key), a
  keyboard inside it lands on the button. A closed panel is `inert`.
- The page keeps the panel's 320 px clear of what matters under it where it
  can. Ask Contrack places its column so the open panel never covers the
  search box (`ASK_COLUMN`), and the map fits its pins beside the panel.
- From `lg`. Below it the page opens the same content in a bottom sheet from
  a button of the same kind in its header or toolbar.
- ❌ A panel that pushes the page's content aside, a rail that takes a lane
  of the layout for one icon, a second close control, or a second header
  style for a panel.

### Selected: one look

- ✅ A selected row in a list (a contact row, a queue row, a history entry, a
  settings rail item) is `SELECTED_ROW`: the 10 percent primary tint on the
  row's face. Its name, or its label, takes `text-on-primary-wash` as the
  second cue: the tint alone sits about 1.06 to 1 against a resting wash,
  and the name's ink is the cue a person finds. Text that was
  `text-primary` is `text-on-primary-wash` too.
- ✅ A selected pill, chip, toggle or nav item is `SELECTED_TINT`: the same
  tint and its ink. A menu option is `MENU_ITEM_SELECTED`, the same tint.
- ❌ A coloured bar or sliver down a box's leading edge, for a selection, a
  tone or an accent: a `border-l-*` colour, a `before:` bar or an inset
  shadow. It is the stock accent of generated interfaces, and a list that
  wears it looks assembled rather than designed. `styles.floor.test.ts`
  fails on it. A tone goes on a dot, a chip or the text.
- ❌ A ring on a selected row. It reads as keyboard focus, on every visit.
- ✅ An option in a radio group (a preset tile, a role, a scan, a reset's
  delivery) takes the tint and a `RadioDot`
  (`src/components/ui/RadioDot.tsx`) beside its label: a ring on every
  option, filled with a centre dot on the chosen one. The tint alone says
  "chosen" by hue, about 1.1 to 1 against the other options, which WCAG
  1.4.1 does not accept as the only cue. `ChoiceGroup`
  (`src/components/ui/ChoiceGroup.tsx`) draws the group: `role="radiogroup"`
  and `role="radio"` with `aria-checked`, one Tab stop, the arrow keys, a
  hint under a label, `pending` while a change saves and `locked` when the
  environment sets the value, both by `aria-disabled` so focus stays.
- ❌ A radio group written by hand. Settings had ten.
- ✅ A short exclusive choice with no hint is a `Segmented`, which keeps its
  raised option in a trough, radio semantics and the arrow keys.
- ✅ The chosen swatch in a picker of colours, icons or avatars is
  `SWATCH_SELECTED`: a 2 px ring in the ink colour, 2 px off the swatch. A
  swatch's fill is its content, so it cannot take the tint, and it has no
  room for a dot. The ring is the ink, never the primary, so it
  does not read as the focus ring. It is the one ring a selection wears.
- ✅ A selected card in a list is `SELECTED_ROW` too: on a `.card` the tint
  mixes with the card's own face (`--row-face`) and the card keeps its
  shadow, so it reads as raised and chosen.
- ❌ A ring for a selection, except a swatch's. It read as keyboard focus on
  every visit, and a focused selected row drew two rings.
- ❌ A filled `bg-primary` pill for a selection.

### Focus: one ring

The base layer's outline is the only focus indicator: 2 px of the primary,
2 px outside a control, and inset on its own edge for a text field, where it
reads as the field's border. A composite field (an icon, an input and
buttons in one box, the note composer's card) puts `focus-frame` on the box,
which draws the inset ring while its field has focus. A button inside keeps
its own ring, so the ring always says which element Enter acts on.

- ❌ `focus:ring-*`, `focus-visible:ring-*`, `focus-within:ring-*`,
  `focus:outline-none` or a `focus:border-*` indicator. The scan fails on the
  rings.
- `MENU_ITEM` draws the same ring inset, because its rows touch and the
  panel would cut an outside ring. The map's zoom buttons draw it as an inset
  shadow for the same reason: their group clips anything outside. The map
  credit's "i" takes the normal outside ring on its pill. A pointer's focus
  draws nothing on either, so MapLibre's own blue glow never shows.
- The command palette's input draws no ring. The palette is a dialog with
  one field that has focus for as long as it is open, so a ring would never
  go away and would say nothing.
- A notes search keeps a spinner, not the thinking bird: no model reads the
  notes, and the bird would say one does.

### Page header: one layout

Every page's top is `PageHeader` (`src/components/layout/PageHeader.tsx`):

```text
back link                                            actions
Title  suffix
One line of description
children (a search box, filters, a form)
```

- The title is the page's name and its `h1`, in `PAGE_TITLE`: the same size,
  face and ink on Network, Pulse, Ask Contrack and every Settings page. The
  Map has no header, because it paints edge to edge. The Network list uses
  an `h2` when an open contact's name is the page's `h1`.
- `suffix` continues the title line with the one fact a page leads with, in
  `PAGE_TITLE_SUFFIX`: the title's face and size in the variant ink, so the
  line reads as one headline in two tones. Pulse is the one page with a
  suffix: "Pulse Tuesday, September 22". The suffix is a `p` outside the
  heading, so the heading's name stays the page's name. A header with a
  suffix is a grid (`TITLE_GRID`): in a narrow header the title and the
  actions share the first row and the suffix takes a full line under them,
  so a phone never squeezes the day into a column beside the buttons. From
  `@2xl` the suffix sits on the title's baseline.
- ❌ An eyebrow: a small label with the page's name over a large line that
  is not the name. The page's name is the title.
- `back={{ to, label }}` draws the link to the parent page above the title,
  in small type (`PAGE_EYEBROW`). Its text is the parent's name and its
  accessible name is "Back to …", like every back control in the app,
  because the sidebar has a link with the bare name too.
- A back link names the page's real parent, and only where nothing else on
  screen already leads there. Settings shows none from `lg`: the rail and
  the sidebar are both on screen, and the link pushed every settings title
  20 px below every other page's. Below `lg` a settings page has
  "‹ Settings", back to the list, and the list has none: the tab bar is the
  way out. `settingsBackLink` in `src/views/settings/registry.ts` is the
  rule.
- Below `lg` the move between the settings list and a page slides: in from
  the right going down, out to the right going back, at the slow duration
  on the curve (`src/views/settings/slide.tsx`, the View Transitions API,
  and the block at the end of `src/index.css`). Reduced motion, from the
  system or the Motion row, navigates at once.
- A settings page's description is its registry `description`, drawn by
  the shell, and its buttons go through `SettingsHeaderActions` into the
  header's actions. ❌ A page that writes its own intro paragraph under
  the header, or its own row of buttons above its first card.
- The title block shrinks to its longest word, so the actions stay at the
  right and the description wraps beside them, and they drop under the
  block only on a phone. The title is 24 px on a phone and 30 px from `md`
  on every page, the narrow Network pane too, so moving between pages does
  not change the title's size. The description and the suffix's place follow
  the header's own width (`PageHeader` is a size container).
- The page owns the padding: `PAGE_X` for the sides (a narrow pane keeps
  `px-4`) and `PAGE_TOP` above the header, so every title starts at the
  same height. A skeleton or a route fallback mirrors it.
- ❌ A band behind the header, a border under it, or an icon tile beside the
  title.

### The shortcuts dialog: the page's own

`?` and the sidebar's keyboard button open `KeyboardShortcutsModal`, two
columns from `sm` and one below it:

- The left column is the shortcuts that work everywhere (`COMMON_GROUPS`:
  Navigation and Global), the same on every page.
- The right column is the page's own (`pageShortcutGroups(pathname)`): a
  contact's and the list's beside it on a contact, the map's on the map,
  the queue's on Pulse. A page with none says "No shortcuts of its own".
- With single-key shortcuts off, the letters that switch turns off are
  dimmed and named "off", and the footer says so with a link to turn them
  on. Otherwise the footer says `?` opens the dialog anywhere and links to
  **All shortcuts**, Settings, Keyboard, which lists the whole table.
- Every key a page binds is a row in `SHORTCUTS` (`src/lib/shortcuts.ts`)
  with the page it works on (`page`, matched by `isOnPage`), and obeys the
  single-key switch. The caps are `ShortcutKeys`: a combination side by
  side, alternatives with "or" between them.

### Menus and dropdowns

One look, three components, no native `<select>`:

- `ActionMenu` (`src/components/ui/ActionMenu.tsx`): a button that opens a
  list of actions. `role="menu"`, arrow keys, Home and End, a letter, Escape
  back to the button. Items take `icon`, `checked`, `hint`, `danger`, `to`.
- `Select` (`src/components/ui/Select.tsx`): a button that opens a list of
  values. `role="combobox"` over a `role="listbox"`, the same keys. Three
  forms: `field` (a form box), `chip` (the uppercase label on a value, via
  `CustomSelect`) and `ghost` (a toolbar trigger). Options take `icon`,
  `description` and `group`.
- `ContextMenu`: the right-click menu, positioned by the pointer.

A list that none of these can draw (the saved views menu has rename and
delete buttons in each row) composes the same constants from
`src/lib/styles.ts`:
`MENU_PANEL`, `MENU_ITEM`, `MENU_ITEM_DANGER`, `MENU_ITEM_SELECTED`,
`MENU_HEADING`, `MENU_SEPARATOR`, `MENU_HINT`, `MENU_ICON`. Nothing that opens
under a control uses `glass-panel`, a `border`, or its own row classes.

`ActionMenu` and `Select` open their panel in the browser's top layer through
`usePanelPlacement` (`src/hooks/usePanelPlacement.ts`): `popover="manual"`,
`showPopover()`, then a fixed position measured from the trigger. The top
layer paints above every stacking context and every `overflow: hidden`, and
the panel stays in the DOM under its trigger, so a click inside it is inside
the trigger's wrapper and a dialog's focus trap still sees its rows. The
selected contact row is `z-10` and comes after the `sticky z-10` Network
header, and the sort menu used to open under it. A scroll that moves the
trigger closes the panel. Do not give a panel a `z-index` and hope: put it
in the top layer, or in a portal at `document.body` like `ContextMenu`.

### Switches, and a value off its default

- ✅ `Switch` (`src/components/ui/Switch.tsx`) for every on/off setting. A
  44 by 24 px track that is the button itself, with `hit-area` for the tap
  box. Off: the highest container tone inside a hairline, a 16 px knob in
  `on-surface-variant`. On: the accent, a 20 px knob in `on-primary` with a
  check in it. Never a hand-rolled `role="switch"`.
- ✅ A setting that is not at its default says so with a 6 px accent dot
  after the title (`CHANGED_MARK`, named "Changed from the default" for a
  screen reader and a pointer). "Not at its default" is the value, not the
  storage: a value set back by hand is stored and takes its dot away
  (`changed` in `PreferencesContext`).
- ✅ While any setting on a page is changed, the page ends with one
  **Reset to defaults** button, in the look of Pulse's Log note
  (`.btn-primary` with a `RotateCcw` glyph), right-aligned under the last
  card and the full width on a phone. It resets every changed setting on
  the page, says how many in a toast with Undo, and puts the keyboard on the
  first row it reset. `SettingRow` tells the page which key it holds, and
  the shell draws the button (`ResetToDefaults`).
- ❌ A "Reset" on each row, a line of text under the description for the
  changed state, a coloured bar down the row's left edge, or a "Reset" link
  with an underline.

## 3. Component Patterns

### Grid & Overflow Restrictions

- When managing responsive layouts with `flex` or `grid`, always use `min-w-0` on immediate children holding distinct internal DOM components (like text truncation or images). This prevents Flexbox from violating column parameters and overflowing content.
- 🔴 **The `ring-inset` Rule:** Using `overflow-hidden` will aggressively clip any standard `ring-*` styling since rings render outside the box-model. Whenever elements sit within `overflow-hidden` containers (like Command Palette lists or Glass modals), you **MUST** use `ring-inset` to guarantee safe rendering inside paddings.

### When `overflow-hidden` IS Appropriate

- Animate height transitions: `motion.div` with `height: 0 → auto` needs `overflow-hidden`.
- Inside cards: On card content that should clip (images, long text).

### Command Palette (`src/components/command-palette/`)

This acts as an intricate state machine managing layered interactions (`cmdk`).

- **Focus-Stealing Prevention:** Any interactive DOM object (button, input) inside the Command Palette that is _not_ a standard `Command.Item` must carry `onMouseDown={(e) => e.preventDefault()}`. Omitting this prompts `cmdk` to automatically perceive clicks as an "outside DOM click," instantly crashing/closing the palette.
- **Event Bubbling Safety:** Wrap internal components with `onMouseDown={(e) => e.stopPropagation()}` to prevent event bleeding into the overlay container.
- **Keyboard Architecture:** `useGlobalNavShortcuts` governs `Cmd+Shift+X`. Inside deeply nested components (`ActionSubMenu`, `FacetAutocomplete`), custom keyboard hooks must exclusively employ the `capture phase`: `window.addEventListener('keydown', handler, true)`. Always pair with `e.stopPropagation()` to prevent the event from reaching other listeners.

### Mobile Responsiveness

- Keybinding tags (`<kbd>`) must remain `hidden sm:inline-flex`.
- Footer navigation bars: `hidden sm:flex` on desktop-only hint bars.
- Touch targets: `p-2 sm:p-1` for buttons, `py-3 sm:py-2.5` for list items.
- Touch feedback: `state-layer` draws a press on a flat control and a `.btn-*`
  sinks onto its edge. No `active:bg-*` or `active:scale-*` beside them.
- Responsive text: Show "Cancel" on mobile, "ESC back" on desktop.
- Enlarged hit-areas via padded mobile rules.

#### 44 px minimum hit area (REQUIRED)

Every control a finger can reach is at least 44 × 44 CSS pixels, whatever its
visible chrome. Apple HIG says 44 and Material says 48; below that, controls are
missable on a phone, and a missed control on a destructive row is worse than
missable.

- ✅ Use `<IconButton>` (`src/components/ui/IconButton.tsx`) for icon-only
  buttons. It carries `min-w-[44px] min-h-[44px]` and lets `size` change only
  the icon halo, never the hit area.
- ✅ For a control that is not an `IconButton`, write the floor yourself:
  `inline-flex items-center justify-center min-w-[44px] min-h-[44px]`.
- ✅ When a control must look smaller than 44 px (a chip's remove button, a
  colour swatch, a letter in the rail, a label select, an inline link), add
  `hit-area`. Its `::after` box is centred on the control and is at least
  44 px on each side, and a tap on it is a tap on the control. `ICON_BTN`
  already carries it.
- ✅ A full-width row, a tab, a `Segmented` option or a text input gets a real
  height below `sm`: `min-h-[44px] sm:min-h-0`, or `py-3 sm:py-2`.
- ❌ `hit-area` on a `<select>`, `<input>` or `<textarea>`. Browsers draw no
  `::after` on them. Give the field a 44 px height below `sm` instead.
- ❌ `hit-area` inside an `overflow-hidden` ancestor. The ancestor clips the
  box. Remove the `overflow-hidden` or grow the control.
- Two controls closer than 44 px share the gap, and the later one in the
  document wins the tap there. Keep 12 px between icon buttons that use
  `hit-area`.
- The visible padding grows the icon's halo. The hit area is the full square.
  The two are tuned independently and only one of them is negotiable.
- `tests/e2e/metrics.spec.ts` measures every visible control on a 390 px
  phone on Network, a contact, Pulse, Ask Contrack and Settings. The hit box
  is the largest of the control's box, its `::after` box and a wrapping
  `<label>`.

#### Empty states (REQUIRED)

A screen with nothing to show renders `<EmptyState>`
(`src/components/ui/EmptyState.tsx`). There is one style.

```tsx
<EmptyState
  icon={Users}
  title="Your network is empty"
  body="Bring in the people you already have, or add one by hand."
  action={{ label: "Import", onClick: openImport, icon: Upload }}
/>
```

- A 48 px icon tile on its tone's wash (`tone`, `primary` by default,
  `error` for a place that failed to load), a 16 px bold title, one
  sentence at 14 px, and at most one action drawn as `.btn-primary`. `action`
  is one object, so a second button cannot be passed.
- The sentence is for a place whose emptiness needs explaining. A simple
  place says it in the title and takes none: "No lists yet" with New list
  under it, "No tags yet", "Trash is empty". A section with nothing in it
  and nothing to do (Recent imports before the first import) is not drawn.
- The title is an `h2`. Inside a card that has its own `h2`, pass `level={3}`.
- `illustration` replaces the icon tile. The corvid mark goes there.
- The copy says what happened and what to do next, in one sentence each. The
  table in `docs/v2/ui-ux-review.md` section 6 holds the copy for each screen.
- ❌ A hand-rolled empty block (a tinted square, a big faint icon, a grey card
  with a sentence).

#### Modals are bottom sheets on mobile (REQUIRED)

A centred dialog on a phone puts its actions in the middle of the screen, out
of thumb reach, and its close control in the top corner, which is the furthest
point from the thumb on the device.

- ✅ Use `<Modal>` (`src/components/ui/Modal.tsx`). Below `sm` it renders as a
  bottom sheet — `inset-x-0 bottom-0 rounded-t-2xl` — and from `sm` it becomes
  a centred card. Its close control is a 44 px target and its scroll container
  carries `pb-[max(1.25rem,env(safe-area-inset-bottom))]` so the last row
  clears the home indicator.
- ✅ Use `<ConfirmDialog>` (`src/components/ui/ConfirmDialog.tsx`) for anything
  irreversible. It wraps `Modal`, so it inherits all of the above, and its
  buttons stack `flex-col-reverse` under `sm` — the confirming action on top,
  where the thumb is.
- ❌ `disableMobileSheet` exists for dialogs that must stay centred (a preview
  anchored to something behind it). It is the exception and needs a reason in
  the call site.
- ❌ Never hand-roll a fixed-position overlay. Nested focus, scroll locking,
  Escape and focus restoration are all in the primitive, and re-deriving them
  is how a dialog ends up trapping the page behind it.

### Motion: one curve, three durations

`--ease` (`cubic-bezier(0.16, 1, 0.3, 1)`) and `--dur-fast` 120 ms (a press,
a menu opening), `--dur-base` 160 ms (a hover, a colour change) and
`--dur-slow` 240 ms (something arriving or expanding). Tailwind's default
transition runs at the base duration on the curve, and `ease-out` is the same
curve. `src/lib/motion.ts` holds the same numbers as `DURATION` and `EASE`
for `motion/react`, and a scan checks the two files agree.

- ✅ `transition-colors` and nothing else for a hover. `duration-(--dur-fast)`
  or `duration-(--dur-slow)` for the other two.
- ✅ `transition={{ duration: DURATION.base, ease: EASE }}` in `motion/react`.
  A spring, a repeating spinner or a deliberate long animation keeps its
  numbers.
- ❌ A numeric `duration-*` class. The scan fails on it.

Two rendering strategies, chosen by context:

**Framer Motion (`motion/react`)** — for layout transitions:

```tsx
// Route transitions, panel sliding, presence animations
<motion.main
  initial={{ x: "100%", opacity: 0.5 }}
  animate={{ x: 0, opacity: 1 }}
  exit={{ x: "100%", opacity: 0 }}
  transition={{ type: "spring", bounce: 0, duration: 0.4 }}
/>
```

**CSS `@keyframes`** — for GPU-composited list animations:

```tsx
// result-card-enter: opacity-only entrance for search result cards
// Avoids subpixel reflow jitter from translateY transforms
<div
  className="result-card-enter"
  style={{ animationDelay: `${index * 30}ms` }}
/>

// timeline-entry: staggered opacity + translateY(8px) for timeline items
<div
  className="timeline-entry"
  style={{ animationDelay: `${index * 40}ms` }}
/>
```

### Error Boundaries

- **`ErrorBoundary`** (global, in `src/components/layout/ErrorBoundary.tsx`): Wraps entire app in `main.tsx`.
- **`RouteErrorBoundary`** (per-view, in `src/components/layout/RouteErrorBoundary.tsx`): Wraps each route's content. Isolates crashes to individual views so navigation remains functional.

### Toast Notifications

Use `sonner` via the `<Toaster>` in `App.tsx`. Toasts use `glass-panel` styling with no borders.

## 4. Code Conventions

### Architecture Patterns

- **Local-First Boundary**: Exclusively use the SQLite database (`curator.db`). No external databases.
- **Thin Routes / Heavy Services**: Express routes in `server/routes/` parse payloads and delegate. All business logic lives in `server/services/`.
- **AI Abstraction**: All AI calls go through the `ai` singleton from `server/ai/index.ts`. Never invoke `@google/genai` outside `server/ai/adapters/gemini.ts`.
- **Repository Pattern**: Data-access queries and hydration logic live in `server/repositories/`, not in services or routes.

### React Query Conventions

- All data fetching uses `@tanstack/react-query` hooks defined in `src/api/`.
- Global defaults: `staleTime: 30s`, `gcTime: 10min`, `retry: 1`, `refetchOnWindowFocus: false`.
- Per-query overrides documented in `src/lib/queryConfig.ts`.
- Mutations use `onSuccess` → `queryClient.invalidateQueries()` for cache coherence.

### Strict Typing

- Utilize `Record<string, unknown>` for object placeholders instead of implicit indexing.
- No `any` logic outside strict type narrowing clauses.
- Use `zod` schemas for runtime payload validation in routes.

### Import Conventions

- Use `@/` path alias for absolute imports (resolves to project root).
- Server imports use explicit `.ts` extensions (required by `tsx` runtime).
- Barrel exports (`index.ts`) used for major module boundaries (`server/ai/`, `src/api/`, view directories).

### State Management

- **Server state**: React Query (no Redux, no Zustand).
- **Local UI state**: React `useState` / `useReducer`.
- **Shared feature state**: React Context (`AISearchContext`, `DedupeContext`).
- **Client-side routing**: `react-router-dom` v7 with `BrowserRouter`.

## 5. Anti-Patterns (FORBIDDEN)

- ❌ 1px solid borders for visual segmentation — use surface color shifts.
- ❌ A focus ring of a component's own, a selection ring, a hover fill beside
  `state-layer`, or a shadow on a flat control.
- ❌ `tracking-widest`, a Title Case label, or a numeric `duration-*` class.
- ❌ Blind nested DOM interactivity inside the Command Palette without `onMouseDown` preventions.
- ❌ Utilizing `overflow-hidden` on parent wrappers when attempting to show `ring-2` effects without `ring-inset`.
- ❌ Invoking native `useEffect` fetch loops instead of `@tanstack/react-query` lifecycle managers.
- ❌ Relying on vec0 SQL cascades without explicit backend code deletion blocks.
- ❌ Using `violet-*`, `fuchsia-*`, `purple-*`, or `indigo-*` colors anywhere, or a vibe or accent preset near the AI hue.
- ❌ Direct `@google/genai` imports outside `server/ai/adapters/gemini.ts`.
- ❌ Placing business logic in Express route files — delegate to services.
- ❌ Using `any` type without explicit narrowing justification.

## 6. Brand

The corvid is the one mark. `src/assets/corvidPaths.ts` holds the drawing, and
everything that shows the bird reads that file: the React components, the
rig that moves it, the favicon, the PWA icons, the link preview, the model
sheet and the README picture. There is no second drawing anywhere.

The mark is two things. **The ring** is the C the bird sits in, and nothing
ever moves it. **The bird** is everything else, and it is the only thing any
animation touches. When the bird flies, the ring stays where it is, empty,
until the bird lands in it again.

### The mark

- `<CorvidMark>` (`src/components/brand/CorvidMark.tsx`) draws the bird
  inline. Variant `mark` is the logo at its own weight, the strokes the rig
  moves. Variant `glyph` is the small optical size, for 16 to 20 px: every
  part, at a heavier stroke, with a larger eye.
- The ring is its own path, first in the svg. The bird is a `[data-bird]`
  group after it: the nape, the chest, the wing, the two tail strokes, the
  head and the eye. A rule or a script that moves the bird reaches the group
  or a part inside it, never the svg.
- The stroke is `currentColor`. Put the mark on `text-primary` and it follows
  the accent a person chose. The eye fills with `--color-corvid-eye` (light
  `#47befd`, dark `#7fd6ff`) and does not follow the accent. A rose bird keeps
  its cyan eye. The eye is an ellipse, so it can blink.
- Decorative by default: `aria-hidden`, never focusable, no Tab stop. Pass
  `decorative={false}` only where the mark is the one thing that names the
  app, and it becomes `role="img"` named "Contrack".
- Every part has an id, `<prefix>-ring`, `<prefix>-wing`, `<prefix>-eye` and
  so on, and a `data-part` with the same name without the prefix. The prefix
  is unique per instance. The sidebar perch passes `idPrefix="corvid"`.
- The nape is the one line the logo does not show. Sitting in the ring, the
  bird borrows the ring for the back of its head, so the nape's path is
  empty. Out of the ring it draws itself in from the crown.
- `<CorvidTile>` is the app icon inline: the gradient rounded square with the
  white bird, in fixed colours, at the optical size its size calls for.
  `<Wordmark>` is the mark beside the name in the headline face, for a wide
  surface.

### Optical sizes

One stroke cannot serve every size, so the mark has four masters,
`CORVID_OPTICAL` in `corvidPaths.ts`. Each draws the same paths. The size a
person sees picks the master, not the file's pixels (`opticalSize`).
`docs/brand/README.md` shows them.

| Master   | Seen at                              | Parts                        | Stroke | Eye  |
| -------- | ------------------------------------ | ---------------------------- | ------ | ---- |
| `tiny`   | 16 px on a 1x screen                 | ring, head, wing, outer tail | 7.5    | none |
| `small`  | 16 to 47 pt, two pixels to a point   | all six                      | 5.2    | 4.2  |
| `medium` | 48 to 95 pt: launcher and home icons | all six                      | 4.4    | 3.6  |
| `large`  | 96 pt and up: the logo as drawn      | all six                      | 3.6    | 3    |

- ❌ Never scale one weight to every size. That is what made the old favicon
  a wave: one heavy stroke that filled in at 32 px.
- ❌ Never draw white on the branding gradient's end, `#47befd`. The tile
  stops at 55 percent of the gradient, `#2795c9`, so the white bird keeps
  3:1 in its lightest corner.

### Sizes

| Surface                       | Variant                   | Size       | Colour                           |
| ----------------------------- | ------------------------- | ---------- | -------------------------------- |
| Tab strip favicon             | tiny or small on the tile | 16 to 48   | white on the tile, eye `#47befd` |
| PWA and touch icons           | medium on the tile        | 180 to 512 | same                             |
| Sidebar perch                 | mark                      | 40         | `text-primary`, eye token        |
| Auth card                     | mark                      | 40         | `text-primary`                   |
| Appearance preview            | mark                      | 36         | `text-primary`                   |
| Empty states                  | mark                      | 64 to 96   | `text-primary/60`                |
| Start panel                   | mark                      | 144        | `text-primary/35`                |
| Crash screen footer           | mark                      | 20         | `text-on-surface-variant`        |
| README header                 | the lockup SVG            | 400 wide   | light and dark versions          |
| Flying bird                   | the rig                   | 52 to 64   | `text-primary`                   |
| Settings footer (phone perch) | mark                      | 20         | `text-primary`                   |
| Thinking indicator            | glyph                     | 16 to 20   | inherits the slot's colour       |

- ✅ Width equals height. The `size` prop sets both. Never stretch the mark.
- ✅ An empty state passes the mark through the `illustration` slot of
  `<EmptyState>`, at 64 px on `text-primary/60`.
- ❌ No emoji, lucide bird or second drawing as the brand anywhere, the
  README included.
- ❌ No recolouring of the eye, and no mark drawn in a colour that is not a
  text token.

### Public icons are generated, never edited

- `npm run brand:icons` runs `scripts/brand/build-icons.ts`. It writes the
  favicons (`favicon-16.png`, `favicon-32.png`, `favicon-48.png` and
  `favicon.ico`), the touch, launcher and maskable icons and `og-image.png`
  in `public/`, and the brand kit in `docs/brand/`: the mark in four
  versions, the app icon, the lockups, the repository card, the model sheet
  and the guide's sheets. `docs/brand/README.md` lists every file and what it
  is for.
- ❌ Never edit a file the script writes. Change `corvidPaths.ts` or
  `corvidRig.ts`, run the script, commit what it writes.
  `tests/unit/brand.icons.test.ts` renders every SVG again and fails when a
  committed file differs.
- ❌ No SVG favicon. A browser takes it over every sized picture and scales
  one weight to every size. Each favicon is drawn for its pixels, and the two
  smallest are fitted to the pixel grid.
- ❌ No CSS variables in anything the script renders. librsvg does not resolve
  them. Colours there are literals from `BRAND` and `TILE` in
  `corvidPaths.ts`, and `tests/unit/brand.paths.test.ts` holds each to its
  token.
- ❌ No text set by the machine's fonts. Words in a brand image are outlines
  of the app's own faces (`scripts/brand/type.ts`). Pango on macOS looks
  fonts up through the system, and the link preview once came out in
  Helvetica.
- `docs/brand/corvid-source.jpg` is the reference drawing. Nothing serves it,
  and `public/` holds only what the script writes.
- The icon links in `index.html` and the manifest carry `?v=corvid-2`.
  Browsers pin a favicon hard. Change the query when an icon changes.

### The rig

`src/assets/corvidRig.ts` is the bird, able to move. A pose is a set of
numbers, `CorvidPose`: how far into flight, which way the body and the head
face, how high the wing is, how open the eye. `drawCorvid(pose)` turns one
into the same strokes the mark is drawn with.

- **At rest it is the logo, point for point.** The rig reads the bird's
  parts from `CORVID_PATHS` when it loads, and `HOME_POSE` draws them back
  exactly. A mark at rest repaints the logo's own path data, not the rig's
  copy of it.
- **The head is never redrawn.** It is the logo's head, turned about the
  neck, `NECK` at (37, 35). The body turns under it about the same x, so a
  bird can turn round on its perch with its head held still, which is what
  a real one does.
- **The wing is the logo's wing in its own frame.** It opens, bends, swings
  about the shoulder and, through the middle of a stroke, turns edge on, so
  its leading edge stays in front on the way down and on the way up.
- **The throat hangs between the head and the body.** Each of its points
  follows the head by a weight that falls to nothing at the shoulder, so the
  neck bends rather than breaking.
- **The flying shape is the same five strokes in other places.** The logo's
  body faces left and its head looks back over its shoulder to the right. In
  the air the head faces the way the bird goes. Flying right is the rig's
  mirror.
- **A barrel roll turns the points, not the pen.** `rollDrawing` moves every
  point toward the line the flight holds the bird by, so edge on the bird is
  a line as thick as its strokes.
- ❌ Never squash or stretch the bird with a CSS `scale`. It thins the
  strokes with the shape, and an edge-on bird breaks up into a hairline.
- ❌ Never add a stroke to the bird without a place for it in `HOME_POSE`
  that draws nothing, the way the nape does. The logo is the one pose that
  must not change.
- ❌ Never move the ring. The rig does not draw it, and no rule, keyframe or
  script may select it to animate it.

### The motion

Three levels, one account preference, `mascotMotion`, on the Appearance page
under "Corvid motion".

| Level    | What the bird does                                                               |
| -------- | -------------------------------------------------------------------------------- |
| `full`   | Lives in its ring, answers the app, and leaves the ring to fly. Default.         |
| `subtle` | Lives in its ring and answers the app. A press is a flutter; it never leaves it. |
| `off`    | Nothing. The static mark.                                                        |

- **Reduced motion wins.** `motionLevel(mascotMotion, prefersReducedMotion,
motionPreference)` in `src/lib/corvid.ts` is the only place that decides,
  and it answers `off` when the operating system asks for reduced motion or
  when the Motion row is set to Reduced, whatever the account chose. Read the
  level through `useCorvidLevel()`. Never read `mascotMotion` on its own.
- **A living mark.** Pass `alive` to `<CorvidMark>` and `useCorvidLife` runs
  a brain for it (`src/lib/corvidBrain.ts`). Blinks come every three to seven
  seconds, one in five doubled. Small acts (a look about, a cock of the
  head, a look back) come every six to fourteen seconds. Big acts (a preen,
  a feather shake, a wing stretch, a silent caw, a hop) every twenty to
  fifty, never the same one twice running, and never while the person is
  typing. Every act is made fresh from a random source
  (`src/lib/corvidMotion.ts`), so no two are quite alike, and every one ends
  in the logo.
- **What it costs.** Nothing while it is still, asleep included. Between
  acts it sleeps on one timer; it draws frames only while something moves;
  it stops altogether in a hidden tab, out of view, while its bird is away
  flying, and at `off`.
  Under 24 px a mark does not live, but a mark passed `alive` still answers a
  reaction addressed to it.
- **The app's own bird.** The sidebar perch passes `primary`. That bird, and
  only that one, answers `corvidReact()` and the app's activity, watches the
  pointer when it comes within 260 px (the head turns in quick snaps and
  still holds, the way a bird's does), gets ready when its button is
  hovered or focused, and falls asleep after two and a half quiet minutes.
  Any input wakes it with a start.
- **Flights.** Anything that wants a flight calls `flyCorvid({ kind })` from
  `src/lib/corvid.ts` and forgets about it. `kind` is `"loop"` (a lap of the
  window), `"swoop"` (the celebration: a pass along the top, sometimes with
  a barrel roll) or `"sortie"` (a short outing near home). Pass `perch` to
  leave from a living mark other than the one on screen, as the Appearance
  preview does, or `from` for a rectangle with no bird of its own.
- **Every flight is new.** `planFlight` in `src/lib/corvidFlight.ts` draws a
  random route through random waypoints, with its own speed, its own bursts
  of wingbeats and glides, and pitch with the climb. No waypoint turns it
  sharper than a bird at speed could, and it slows through a tight curve.
  The bird turns round when the route doubles back, rather than flying
  upside down, and its pitch leans through level as it turns. It leaves as
  the logo and lands as the logo, at the perch's place and size, so the swap
  between the perch's bird and the flying one cannot be seen.
- **One overlay.** `CorvidFlight`, mounted once in `App` beside the
  `Toaster`, is the only listener. It hides the perch's `[data-bird]` group,
  never the ring, flies, lands and gives the bird back. A ring that moved
  while the bird was out, because its page scrolled, is landed on where it
  is. Escape and a route change land it at once.
- **A second press asks it home by a short way**, eased out of the frame it
  was in, to the ring it left, whichever perch was pressed. It is heard
  only while the bird is out and on its way, not while it is still leaving
  or already coming in. A flight the app asks for by itself, a celebration
  or an outing, never cuts a person's lap short: it is dropped.
- **A celebration waits to be seen.** `flyWhenClear()` flies at once on a
  clear page, or when the dialog that covers it closes, and lets the moment
  pass after twenty seconds.
- **The thinking bird is CSS.** It is small and there can be several, so its
  head tilt is the one keyframe left, `corvid-thinking` in `src/index.css`.
  It moves `[data-part="head"]` and the eye about the rig's neck, with
  `transform-box: view-box`, and each instance keeps its own period and
  starting point.
- ❌ Never animate the bird in a view. One overlay, one event. Two birds in
  the air at once is a bug, and a per-view animation cannot be cancelled when
  the route changes.
- ❌ Never let the bird take a pointer event or a Tab stop. The flight layer
  is `aria-hidden`, `pointer-events-none` and `z-[60]`, under the contact
  overlay and the palette (`z-[100]`) and under `Modal` (`z-[200]`).
- The sidebar perch is a control: a `<button>` named "Contrack", titled "Let
  the corvid fly", with `navLink(false)` padding. It is the seventh sidebar
  Tab stop and the reason both budgets in `keyboard.spec.ts` are one higher
  than the controls on the page. The Appearance preview is the other: a
  button named "Try the corvid".

### The moments it answers

The bird is part of the app's work, not a toy beside it. Each moment below
is asked for by the code that did the work, on success only, through
`corvidReact()`, which drops a repeat that comes within four seconds.

| Moment                               | What the bird does                         | Asked for by                                      |
| ------------------------------------ | ------------------------------------------ | ------------------------------------------------- |
| A follow-up is done                  | Nods                                       | `useCompleteActionItem`                           |
| A conversation is written down       | Caws, silently                             | `useAddInteraction`                               |
| Somebody new is added                | Hops                                       | `useCreateContact`                                |
| A person is tracked                  | Cocks its head at them                     | `useSetTracked`                                   |
| Two records are merged               | Preens                                     | every merge hook in `dedupe.ts`, `suggestions.ts` |
| A contact comes back from the trash  | Nods                                       | `useRestoreContact`                               |
| An import adds people                | Flies the celebration pass                 | `ImportPanel`                                     |
| The last follow-up in Up next clears | Flies the celebration pass, under confetti | `UpNextCard`                                      |
| The app at work                      | Does something of its own                  | `noteCorvidActivity()`, from `apiFetch`           |

- **The app at work.** `apiFetch` counts every request that comes back OK.
  About once a hundred requests, or once every six to twelve AI answers, the
  bird is stirred: it plays a big act, if the page is quiet. Now and then,
  at `full`, the stir is a short outing near home instead. Never twice in
  twenty seconds, an outing never twice in three minutes, and never an
  outing while a dialog, a menu or the palette is open or a field has focus.

### Where the bird lives

One row per surface. A new one goes here, and nowhere else gets a bird
without a reason a person could state.

| Surface                                    | What it does                                                                  | Component            |
| ------------------------------------------ | ----------------------------------------------------------------------------- | -------------------- |
| Sidebar perch, 40 px                       | Lives, answers the app, watches the pointer, dozes, flies on a press          | `Sidebar.tsx`        |
| Settings footer on a phone, 20 px          | Flies on a press, where there is no sidebar; flutters at Subtle               | `SettingsHome.tsx`   |
| Sign-in and setup card, 40 px              | Lives calmly, shakes its head at a wrong password                             | `AuthShell.tsx`      |
| Settings, Appearance, "Corvid motion"      | Lives faster, so the row shows what it does; flies from its own ring          | `CorvidPreview.tsx`  |
| Synthesis bar, enrich badge, briefing card | Tilts its head while AI works                                                 | `CorvidThinking.tsx` |
| Ask Contrack while a People search runs    | Tilts its head in the search box, on "Searching…" and on "Enriching with AI…" | `CorvidThinking.tsx` |
| Pulse, when the last follow-up clears      | The celebration pass, under the confetti                                      | `UpNextCard.tsx`     |
| Duplicates, "All reviewed"                 | Hops when it arrives, then lives calmly                                       | `DedupeView.tsx`     |
| Start panel, 144 px                        | Lives calmly: blinks, looks about, looks back, nothing bigger                 | `StartPanel.tsx`     |
| Empty network, Trash, Archived             | Still, as the illustration                                                    | `EmptyState` callers |
| Crash screen footer, 20 px                 | Still                                                                         | `ErrorBoundary.tsx`  |

- **One rule, one hook.** `useCorvidLevel()` answers "how much may this bird
  move", and every surface above reads it, directly or through `CorvidMark`.
  A surface that animates without asking is a bug: reduced motion, from the
  operating system or from the Motion row, has to reach every one of them.
- **`CorvidMark` gates its own life.** A caller may pass `alive`, `hop` or
  `primary` without checking the level first.
- **Perches.** The sidebar's perch stays in the DOM below `md`, hidden by
  CSS, and the Settings footer carries the phone's. `findPerch()` in
  `CorvidFlight.tsx` picks the one with a layout box. The Appearance preview
  is not found that way: it passes itself as `perch`. A new perch does one
  or the other, or the bird leaves from the wrong ring.
- **The thinking bird never carries the meaning alone.** Every surface that
  shows it also says what it is waiting for in text, and where that text is
  beside the bird the bird is `decorative`. A person who cannot see it loses
  nothing, and a person who can hears the sentence once.
- ❌ No bird on a crash, a destructive confirmation or an error, except the
  head shake at a wrong password, which is the bird saying no rather than
  the bird being cheerful.
- ❌ No reaction on a failure. A moment above is asked for in `onSuccess`,
  never in `onSettled`.

## 7. The ring means tracked

The relationship score belongs to the people a person chose to keep up with.
Nothing on screen shows a score for anybody else, and no surface asks the
question on its own: they all call `scoreView` in `shared/scoreBand.ts`.

`scoreView(contact)` answers in one of three states. A surface that shows a
score handles all three:

| State       | What it means                    | What the surface shows                                   |
| ----------- | -------------------------------- | -------------------------------------------------------- |
| `untracked` | Nobody tracks this contact       | No ring, no chip, no words. The picture at its full size |
| `unscored`  | Tracked, with nothing logged yet | The empty track, and "No interactions yet"               |
| `scored`    | Tracked, with a score and a band | The arc in the band colour, and "Score 72, strong"       |

Rules that follow from it:

- **An untracked contact is never At risk.** The band needs a score. The map
  health layer paints its pin with a ring in the variant ink
  (`ring-on-surface-variant`), as the legend draws it, the cluster arc leaves
  it out, and the stats strip counts it in neither At risk nor the average.
  Both it and a never-met contact used to be painted red.
- **Say nothing rather than say unknown.** A row that names a contact
  ("Betty Clark, Global Dynamics, score 72, strong") calls `scoreWords`,
  which is null for an untracked contact, and leaves the part out.
- **A scored ring explains itself.** On the contact page the ring is the
  `ScoreBreakdown` trigger, named "Relationship score 72 out of 100,
  explain". The ring inside it is then `decorative`, so the score is said
  once.
- **The Track button.** One control sets the flag on a contact page:
  `TrackButton`, a menu button (`ActionMenu`) with the `Radar` glyph, one
  word and a 12 px chevron, 32 px tall and about 110 px wide at its widest
  word, flat, with the state layer. Its menu is as slim as its words, 11 rem
  (`panelClassName`), where other menus start at 13. Untracked it
  reads Track on the container fill. Tracked it reads the cadence, one
  word ("Quarterly", or "2 months" for a value off the list), in the
  selected tint, with the glyph in `text-primary`. Narrow, the glyph and
  the chevron, with the words in the name and the tooltip. The "Contact
  actions" menu gets no Track item, and no other surface grows a second
  control for the flag: the `t` key, the palette row and the page toggle
  all run the same `useTrackToggle`, with the same toast and Undo.
- **One menu says how often, and stopping is one of its rows.** Under the
  heading "Keep up": Weekly, Monthly, Quarterly and Yearly
  (`CADENCE_CHOICES`). Untracked, each row tracks at that cadence, and the
  account's default carries the hint "Default", which a screen reader hears
  too (`speakHint`). Tracked, the current row is checked, a value off the
  four shows as one more checked row in its place (`cadenceOptions`), and
  Stop tracking follows under a hairline (`separatorBefore`). It was a
  split button, the word a toggle and a caret behind a hairline, which the
  owner found heavy.
- **A control does not change shape when it is pressed.** A part that
  appears on press is a part that was not there to be found, and on a
  right-aligned row it drags the label out from under the pointer as it
  arrives. Give the control every part it will ever have, and let the state
  change the fill and the word. Where several words share one control, size
  the label to the widest of them (`TrackButton` draws every word it can
  show, invisibly, in one grid cell, and the current word over them), so
  the control keeps one width whatever it says.
- **The words.** Track, Tracked, Stop tracking, Untrack, Not tracked,
  Keeping up, Catch up, cadence, and the four cadences, one word each:
  Weekly, Monthly, Quarterly, Yearly. The band words, Strong, Fading and At
  risk, keep their own meaning and are never used for the flag.
- ❌ No surface reads `contact.relationshipScore` directly. A raw column
  read is how "Score 50" reached the map for a person nobody had ever met.

## 8. Pulse: the morning page

Pulse answers three questions in this order: what day is it and how am I
doing, who do I reach today, what changed in my network. Everything that does
not answer one of them gets smaller, quieter, or goes. The rules below are
`src/views/pulse/lib/pulseStyles.ts` in words.

### The type scale

One object, `PULSE_TYPE`, holds every size on the page. Two sizes, 13 and
15 px, are new on the app's scale and live only there, so no other page picks
them up by accident. The 11 px floor stands.

| Key         | Size and weight                         | Use                                                                 |
| ----------- | --------------------------------------- | ------------------------------------------------------------------- |
| `cardTitle` | 15 px bold, tight tracking              | A card's `h2`                                                       |
| `cardCount` | 15 px semibold, variant colour, tabular | The muted count after a card title                                  |
| `name`      | 14 px semibold                          | A person's name in a row                                            |
| `rowTitle`  | 14 px                                   | The task or the fact in a row                                       |
| `meta`      | 13 px, variant colour                   | Dates, counts, hints                                                |
| `group`     | 13 px semibold, variant colour          | A group heading inside the queue                                    |
| `figure`    | 24 px bold headline face, tabular       | The one large figure on a card: the "9" of "9 of 10 within cadence" |
| `insight`   | 15 px, relaxed leading                  | The insight's own text, a paragraph a person reads                  |

The masthead's title and day are the page header's (`PAGE_TITLE` and
`PAGE_TITLE_SUFFIX`), not keys here, so Pulse's title is the size of every
page's title.

- ✅ Read a size from `PULSE_TYPE`. A card title is 15 px everywhere because
  one constant says so.
- ❌ A literal `text-[13px]` or `text-[15px]` in a Pulse card. Add a key if
  a new role needs one.
- The grid is `GRID_CLASSES` and `COLUMN_CLASSES`: 5, 3 and 4 of twelve at
  `xl` (Focus, Intelligence, Network), 5 and 7 at `lg` with Intelligence two
  across underneath, one column below. `PulseView`, `PulseSkeleton` and the
  `pulse` variant of `RouteFallback` read the same constants, so the three
  silhouettes cannot disagree.

### A card is a title and a body

`CardFrame` draws no line between its header and its body and carries no
icon. The `h2` is the title, and the count follows it as muted text inside
the `h2` after a screen-reader-only comma, so the section is named "Up next,
10". `headerAction` keeps its place at the header's end.

### An empty card is a line

`CardFrame variant="line"` is for a card with nothing to show: the title,
the count, one sentence in `PULSE_TYPE.meta` and at most one link, on one
row on the page surface with no card background. In customize mode the same
controls appear at the row's end, in the same order with the same names as
on a card, so "Hide Completed" is one locator in both shapes.

- ✅ A line for Completed with nothing completed, Inbox at zero, Coming up
  with nothing in two weeks, Daily insight without a key.
- ❌ A framed card whose body is one italic sentence. Nobody reads a box that
  says nothing.

### The masthead and its line

The masthead is `PageHeader` with the title "Pulse", the `h1`, and the day
as its `suffix`: "Pulse Tuesday, September 22", one line in two tones at the
size of every page's title. On a phone the day takes its own line under the
title and the actions. One line from `buildDayLine` in `lib/dayLine.ts`
replaces the chips: the counts above zero in the order overdue, due today,
birthdays this week, joined by the middle dot (`MetaDot` with `pause`, so a
screen reader hears a comma), with no commas and no closing period. One
item stands alone, with no dot. Each dot stays with the item after it, so a
wrapped line never ends on one. The streak, from two days, is one more
item: "Nothing due today · 12 days in a row". From `sm` up each count is a
`hit-area` button that jumps to its card. Below `sm` the counts are plain
text, because the queue starts one flick down and inline 44 px tap boxes
would overlap across two wrapped lines. Log note is the one `.btn-primary`.
It is a label, so it takes no article, like New contact. New contact and
Customize layout live in an `ActionMenu` named More.

- ❌ A progress ring or a "3 to do" beside the actions. It repeats the
  sentence's counts in a smaller, vaguer form.

### Customize: moving a card

Customize mode moves a card by its grip, and the drop lands where the
pointer is, not where the card's box is.

- ✅ The grip (`GripVertical`) on every card at every width. A mouse drags
  after 4 px. A finger holds for 200 ms first, and the grip keeps
  `touch-action: manipulation`, so a flick that starts on it still scrolls
  the page. The grip tints while a hold waits to become a drag.
- ✅ The pointer picks the column, then the place: before the first card
  whose middle is below it, in reading order in the two-across grid at
  `lg`. Each step moves the card in a draft of the layout, and the cards
  it passes slide with a transform (`lib/flip.ts`). One write, on drop,
  through `pulseLayoutReducer`. Escape puts the draft back.
- ✅ The card's slot is a 64 px dashed box, the height of the preview, and
  the preview under the pointer is a compact card: the title, where it will
  land ("Intelligence · 3 of 5") and the grip. A tall card at full height
  opened an 800 px gap and pushed the rest of its column off screen.
- ✅ A way to move without dragging (WCAG 2.5.7): the Move menu on every
  card, with Move up, Move down and each other column, and the arrow keys
  on a focused grip. Announcements name the card, its column and its place.
- ✅ Reduced motion: nothing slides and the drop does not fly, and the card
  still lands where the pointer left it.
- ❌ A `transition-*` class that includes `transform` on a card that drags:
  it animates the drag itself, and the card trails the pointer.

### The queue: a pane of rows

From `lg` the Up next pane is the scrollport (`lg:max-h-[calc(100dvh-17rem)]
lg:overflow-y-auto`, the gutter reserved), so the page never grows with the
queue. Below `lg` it has no cap. The pane is `role="group"` named "Up next
items". Each group is a `section` with an `h3` whose id is
`up-next-<group>`, in `PULSE_TYPE.group`, sentence case, with a 6 px dot in
the group's tone and the count at the right, over its own `role="list"`
named for the group. A list may own only list items, so the heading sits
beside the list and never inside it. The heading sticks to the pane in the
card's own colour.

A row is `rounded-xl px-3 py-2.5` on `bg-surface-container-low/70`, with no
border. From `sm`, line one is the name (`PULSE_TYPE.name`) and the chip
(`PULSE_CHIP`, 12 px semibold on `rounded-md px-2 py-0.5`, a wash and an ink,
no border, no caps), and it wraps so the name is never cut. Line two is the title
(`PULSE_TYPE.rowTitle`, one line). Under them, `PULSE_TYPE.meta` for "Last
spoke 12 days ago". The one action, snooze, is an `ActionMenu` that floats
over the row's right edge on a wash and shows on hover or focus. Below `sm`
the row takes the phone anatomy (`compact`): the name on line one with the
snooze at its end as a 32 px glyph with the 44 px tap box, the title on up
to two lines, then a meta line with the chip and "Last spoke". A phone row
has about 220 px for text, and a name, a chip and a button do not share it.
Selected is `SELECTED_ROW`, the tint and nothing else, the same as the
Network list's current row. Hover is `state-layer` over the resting wash.
The group's dot, the row's leading glyph and its chip read from the group's
tone (`TONE_*`): overdue `error`, today `primary`, this week `neutral`,
birthdays `warning`, catch up `primary`. A click on the row opens the
contact, and a click that starts on a control inside it belongs to that
control.

`CardFrame` sets one inset, 16 px on a phone and 20 px from `sm`, from its
header and body padding. The `CARD` surface class carries its own `p-6`,
and the frame zeroes it: with both, a phone card lost 80 of its 350 px to
padding.

- ✅ Chips in words: "12 days overdue", "Tomorrow", "Wednesday", "3 weeks
  past due", from `describeDueChip` and `describePastDue`.
- ❌ "12D OVERDUE", "IN 2D", "WED". A chip is a fact, and a fact reads.
- ❌ A hover-only control on a phone. Below `sm` every action is visible at
  rest and 44 px.

### The other cards: one row shape, one line when empty

Every list row on a Pulse card that is not the queue (Inbox, Coming up) is
`PULSE_ROW` from `lib/pulseStyles.ts`: `rounded-xl px-3 py-2.5` on
`bg-surface-container-low/70`, 44 px tall at least, no border, and the
whole row is the link. It has its own face and space around it, so it lifts
on hover (`lift`) and its face takes the state layer. The Ghosts row lifts
while it is closed. Open, the item holds the names too, so the button takes
the state layer alone, and each name is a chip that lifts. An Inbox row's
icon sits in a small tile in its tone: new people `success`, possible
duplicates `warning`, correspondents `primary`, the hygiene rows `neutral`.
The count in a row's sentence is bold (`4 without a company`). A fact at
the right edge is `PULSE_CHIP_NEUTRAL`, "In 10 days". Two more type roles:
`figure` for the one large number on a card (Keeping up's "31") and
`insight` for the insight's paragraph at 15 px.

- ✅ Inbox with nothing to do, Coming up with nothing in two weeks, Daily
  insight without a key: `variant="line"`, one sentence, at most one link.
- ✅ Each fact once. Up next owns birthdays through day seven, Coming up
  starts at day eight, the masthead owns the streak.
- ✅ A chart fills its card. The heatmap's squares are one SVG at
  `width="100%"`; its month labels and weekday letters are HTML, so they
  stay 12 px while the squares scale. The sparkline is drawn at the width
  `useElementWidth` measures, never stretched with
  `preserveAspectRatio="none"`.
- ✅ One hue for a part-of-whole chart: `COMPOSITION_RAMP`, the primary at
  six steps of opacity, Other in the neutral track tone.
- ❌ `--color-ai` on a chart of people. It marks AI-derived data only, and
  the sparkle on the insight's category is the one place on Pulse that is.
- ❌ A native `title` as the one way to read a value. The heatmap's tooltip
  opens on hover and on a tap, and its words are in a hidden list too.
- ❌ A line that promises a feature ("shows after four weeks"). Say the
  fact or say nothing.

### Enter belongs to the control that has focus

No window-level Enter on Pulse. Each Up next row is a `listitem` with a
roving `tabIndex` (0 on the highlighted row, -1 elsewhere) and its own
`onKeyDown`: Enter opens the contact, Space does the row's primary action,
ArrowDown and ArrowUp move the highlight. A key is claimed only when the
event target is the row itself, so a button inside the row keeps its own
Enter and Space. J and K stay as bare letters on the window. The row keeps
its list role: it is a clickable element with a keyboard equivalent, not a
button.

The highlight wears its tint only while the keyboard uses the queue: keyboard
focus in the list, or a queue key. While it does not show, the first of J,
K, D, S and L only shows it, and acts from the next press, so D never
completes a row nobody can see. A pointer press outside the list hides it.
