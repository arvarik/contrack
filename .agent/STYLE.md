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

### Hover: three kinds of surface

| Surface                                                   | Hover                                             |
| --------------------------------------------------------- | ------------------------------------------------- |
| A flat control: a row, a ghost button, a pill, a nav item | `state-layer`: a 6 percent ink layer, 10 on press |
| A card that is a control: a search result, a tile         | `CARD_INTERACTIVE`: rises 2 px, shadow a step up  |
| A static card                                             | None                                              |

The layer is a background image, so a resting wash or a selected tint stays
under it, on any surface and in both palettes. "One surface step up" meant a
different token on a white card, on the page and on a wash, and six hover
recipes had grown on three pages.

- ✅ `ICON_BTN`, `BTN_QUIET`, `listRow`, `filterPill`, `navLink`, `IconButton`
  and the `ActionMenu` and `Select` triggers already carry the layer.
- ❌ `hover:bg-*` or `active:bg-*` on a flat control, beside the layer.
- ❌ A `shadow-*`, `ring-*`, `scale-*` or `translate-*` hover on a card. The
  card class owns its hover.
- ❌ Scaling anything that holds text. A swatch or an avatar may scale.

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
- ✅ An option in a radio group (a preset tile, a role, an expiry) takes the
  tint and a `RadioDot` (`src/components/ui/RadioDot.tsx`) beside its label:
  a ring on every option, filled with a centre dot on the chosen one. The
  tint alone says "chosen" by hue, about 1.1 to 1 against the other options,
  which WCAG 1.4.1 does not accept as the only cue. The option carries
  `role="radio"` and `aria-checked`, or `aria-pressed`.
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
- ✅ A setting that is not at its default says so in two quiet places, and
  nowhere else: a 6 px accent dot after the title (`CHANGED_MARK`, named
  "Changed from the default" for a screen reader and a pointer) and a
  "Reset" text button (`BTN_QUIET`, a `RotateCcw` glyph and the word) at the
  start of the control cluster, so the control keeps its place on the row's
  right edge. `SettingRow` draws both from `prefKey`.
- ❌ A line of text under the description for the changed state, a coloured
  bar down the row's left edge, or a "Reset" link with an underline.

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
favicon, the PWA icons, the link preview and the README picture. There is no
second drawing anywhere.

### The mark

- `<CorvidMark>` (`src/components/brand/CorvidMark.tsx`) draws the bird
  inline. Variant `mark` is the whole bird, for 24 px and up. Variant `glyph`
  is the crown, the beak and the wing at a heavier stroke, for 16 and 32 px.
- The stroke is `currentColor`. Put the mark on `text-primary` and it follows
  the accent a person chose. The eye fills with `--color-corvid-eye` (light
  `#47befd`, dark `#7fd6ff`) and does not follow the accent. A rose bird keeps
  its cyan eye.
- Decorative by default: `aria-hidden`, never focusable, no Tab stop. Pass
  `decorative={false}` only where the mark is the one thing that names the
  app, and it becomes `role="img"` named "Contrack".
- Every part has an id, `<prefix>-body`, `<prefix>-wing`, `<prefix>-eye` and
  so on. The prefix is unique per instance. The sidebar perch passes
  `idPrefix="corvid"`, so `#corvid-wing` is that one bird and nothing else.
- `<CorvidTile>` is the favicon inline: the gradient rounded square with the
  white glyph, in fixed colours. `<Wordmark>` is the mark beside the name in
  the headline face, for a wide surface.

### Sizes

| Surface                       | Variant       | Size       | Colour                           |
| ----------------------------- | ------------- | ---------- | -------------------------------- |
| Tab strip favicon             | glyph on tile | 16 to 32   | white on gradient, eye `#47befd` |
| PWA and touch icons           | glyph on tile | 180 to 512 | same                             |
| Sidebar perch                 | mark          | 40         | `text-primary`, eye token        |
| Auth card                     | mark          | 40         | `text-primary`                   |
| Empty states                  | mark          | 64 to 96   | `text-primary/60`                |
| Crash screen footer           | mark          | 20         | `text-on-surface-variant`        |
| README header                 | PNG           | 96         | fixed brand colours              |
| Flight overlay                | mark          | 48         | `text-primary`                   |
| Settings footer (phone perch) | mark          | 20         | `text-primary`                   |
| Thinking indicator            | glyph         | 16 to 20   | inherits the slot's colour       |

- ✅ Width equals height. The `size` prop sets both. Never stretch the mark.
- ✅ An empty state passes the mark through the `illustration` slot of
  `<EmptyState>`, at 64 px on `text-primary/60`.
- ❌ No emoji, lucide bird or second drawing as the brand anywhere, the
  README included.
- ❌ No recolouring of the eye, and no mark drawn in a colour that is not a
  text token.

### Public icons are generated, never edited

- `npm run brand:icons` runs `scripts/brand/build-icons.ts`. It writes
  `public/favicon.svg`, `icon-192.png`, `icon-512.png`,
  `icon-maskable-512.png`, `apple-touch-icon.png`, `og-image.png` and
  `docs/brand/corvid-mark.png` from the paths.
- ❌ Never edit a file the script writes. Change `corvidPaths.ts`, run the
  script, commit what it writes. `tests/unit/brand.icons.test.ts` renders the
  favicon again and fails when the committed file differs.
- ❌ No CSS variables in anything the script renders. librsvg does not resolve
  them. Colours there are literals from `BRAND` and `TILE` in
  `corvidPaths.ts`, copied from the light palette.
- `docs/brand/corvid-source.jpg` is the reference drawing. Nothing serves it,
  and `public/` holds only what the script writes.
- The icon links in `index.html` and the manifest carry `?v=corvid`. Browsers
  pin a favicon hard. Change the query when the tile changes.

### The motion

Three levels, one account preference, `mascotMotion`, on the Appearance page
under "Corvid motion".

| Level    | What the bird does                                |
| -------- | ------------------------------------------------- |
| `full`   | Blinks, tilts its head, hops, and flies. Default. |
| `subtle` | Blinks, tilts and hops. No flights, no swoops.    |
| `off`    | Nothing. The static mark.                         |

- **Reduced motion wins.** `motionLevel(mascotMotion, prefersReducedMotion,
motionPreference)` in `src/lib/corvid.ts` is the only place that decides,
  and it answers `off` when the operating system asks for reduced motion or
  when the Motion row is set to Reduced, whatever the account chose. Read the
  level through that function. Never read `mascotMotion` on its own.
- **What idles.** Pass `idle` to `<CorvidMark>` and `useCorvidIdle` schedules
  a blink 4 to 9 seconds out, with one beat in five a two-degree head tilt
  instead. It holds still while the tab is hidden, and a mark under 24 px
  never gets a timer: there is one timer per idling mark, so only the marks a
  person actually looks at ask for one. The sidebar perch idles. The empty
  states and the crash screen do not.
- **The keyframes are CSS, and select on `data-part`.** `corvid-blink`,
  `corvid-tilt`, `corvid-hop` and `corvid-flap` live in `src/index.css`. They
  reach the bird through `[data-part="eye"]` and `[data-part="wing"]`, never
  through an id: `CorvidMark` gives every instance its own id prefix, so
  `#corvid-eye` is one specific bird. All four are `transform` only, and the
  reduced-motion blocks switch them off outright.
- **The event API.** Anything that wants a flight calls `flyCorvid({ kind })`
  from `src/lib/corvid.ts` and forgets about it. `kind` is `"loop"` (the
  circuit of the window, 4.5 s) or `"swoop"` (one pass across the top, 2 s).
  Pass `from` to leave from a rectangle other than the sidebar perch.
  `CorvidFlight`, mounted once in `App` beside the `Toaster`, is the only
  listener: it measures the perch, hides it, flies, lands and gives it back.
- ❌ Never animate the bird in a view. One overlay, one event. Two birds in
  the air at once is a bug, and a per-view animation cannot be cancelled when
  the route changes.
- ❌ Never let the bird take a pointer event or a Tab stop. The flight layer
  is `aria-hidden`, `pointer-events-none` and `z-[60]`, under the contact
  overlay and the palette (`z-[100]`) and under `Modal` (`z-[200]`).
- The sidebar perch is the one mark that is a control: a `<button>` named
  "Contrack", titled "Let the corvid fly", with `navLink(false)` padding. It
  is the seventh sidebar Tab stop and the reason both budgets in
  `keyboard.spec.ts` are one higher than the controls on the page.

### Where the bird lives

One row per surface. A new one goes here, and nowhere else gets a bird
without a reason a person could state.

| Surface                                     | What it does                                                                  | Component            |
| ------------------------------------------- | ----------------------------------------------------------------------------- | -------------------- |
| Sidebar perch, 40 px                        | Idles, hops, flies on a click                                                 | `Sidebar.tsx`        |
| Settings footer on a phone, 20 px           | The same, where there is no sidebar                                           | `SettingsHome.tsx`   |
| Sign-in and setup card, 40 px               | Idles, shakes at a wrong password                                             | `AuthShell.tsx`      |
| Synthesis bar, enrich badge, briefing card  | Tilts its head while AI works                                                 | `CorvidThinking.tsx` |
| Ask Contrack while a People search runs     | Tilts its head in the search box, on "Searching…" and on "Enriching with AI…" | `CorvidThinking.tsx` |
| Pulse, when the last follow-up clears       | One swoop, under the confetti                                                 | `UpNextCard.tsx`     |
| Duplicates, "All reviewed"                  | One hop when it arrives                                                       | `DedupeView.tsx`     |
| Empty network, Trash, Archived, start panel | Still, as the illustration                                                    | `EmptyState` callers |
| Crash screen footer, 20 px                  | Still                                                                         | `ErrorBoundary.tsx`  |

- **One rule, one hook.** `useCorvidLevel()` answers "how much may this bird
  move", and every surface above reads it, directly or through `CorvidMark`.
  A surface that animates without asking is a bug: reduced motion, from the
  operating system or from the Motion row, has to reach every one of them.
- **`CorvidMark` gates its own `idle` and `hop`.** A caller may pass either
  without checking the level first.
- **Two perches, one bird.** The sidebar's perch stays in the DOM below `md`,
  hidden by CSS, and the Settings footer carries the phone's. `findPerch()`
  in `CorvidFlight.tsx` picks the one with a layout box. A third perch goes
  through the same function or the bird leaves from the wrong rectangle.
- **The thinking bird never carries the meaning alone.** Every surface that
  shows it also says what it is waiting for in text, and where that text is
  beside the bird the bird is `decorative`. A person who cannot see it loses
  nothing, and a person who can hears the sentence once.
- ❌ No bird on a crash, a destructive confirmation or an error, except the
  head shake at a wrong password, which is the bird saying no rather than
  the bird being cheerful.

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
  `TrackButton`, a `<button aria-pressed>` with the `Radar` glyph and one
  word, Track or Tracked. Off it is `.btn-secondary`. On it takes the
  primary wash (`bg-primary/10 text-on-primary-wash`) and the glyph takes
  `text-primary`. Narrow, the glyph alone with the word in the name. The
  "Contact actions" menu gets no Track item, and no other surface grows a
  second control for the flag: the `t` key, the palette row and the page
  toggle all run the same `useTrackToggle`, with the same toast and Undo.
- **Track is a split button.** The word is the action a person takes most,
  and the caret beside it, behind a hairline in the same rounded shell,
  holds the close relatives of that action. Both halves are real buttons:
  the word carries `aria-pressed`, and the caret carries `aria-haspopup`
  and `aria-expanded` through `ActionMenu`. The caret is there in both
  states and means one thing in both, "how often": untracked its rows
  track at the cadence a person picks rather than at the account's
  default, and tracked they change the cadence, with the current one
  checked and a value off the list shown as a sixth checked item. It
  carries no words, so its name and its tooltip say what it does.
- **A control does not change shape when it is pressed.** A part that
  appears on press is a part that was not there to be found, and on a
  right-aligned row it drags the label out from under the pointer as it
  arrives. Hold no empty slots either: an untracked Track button with a
  gap where the caret will go looks broken. Give the control every part it
  will ever have, and let the state change the fill and the word. Where
  two words share one control, size the label to the longer of them
  (`TrackButton` draws "Track" over an invisible "Tracked"), so the text
  starts at the same pixel in both states.
- **The words.** Track, Tracked, Untrack, Not tracked, Keeping up, Catch
  up, cadence. The band words, Strong, Fading and At risk, keep their own
  meaning and are never used for the flag.
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
10". `badge` and `headerAction` keep their places.

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

### The masthead and its sentence

The masthead is `PageHeader` with the title "Pulse", the `h1`, and the day
as its `suffix`: "Pulse Tuesday, September 22", one line in two tones at the
size of every page's title. On a phone the day takes its own line under the
title and the actions. One sentence from `buildDayLine` in `lib/dayLine.ts`
replaces the chips: the counts above zero in the order
overdue, due today, birthdays this week, joined by commas and closed by a
period, then the streak from two days. From `sm` up each count is a
`hit-area` button that jumps to its card. Below `sm` the counts are plain
text, because the queue starts one flick down and inline 44 px tap boxes
would overlap across two wrapped lines. Log note is the one `.btn-primary`.
It is a label, so it takes no article, like New contact. New contact and
Customize layout live in an `ActionMenu` named More.

- ❌ A progress ring or a "3 to do" beside the actions. It repeats the
  sentence's counts in a smaller, vaguer form.

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
`bg-surface-container-low/70`, 44 px tall at least, no border, the state
layer on hover, and the whole row is the link. An Inbox row's icon sits in a
small tile in its tone: new people `success`, possible duplicates `warning`,
correspondents `primary`, the hygiene rows `neutral`. The count in a row's
sentence is bold (`4 without a company`). A fact at the right edge is
`PULSE_CHIP_NEUTRAL`, "In 10 days". Two more type roles: `figure` for the
one large number on a card (Keeping up's "31") and `insight` for the
insight's paragraph at 15 px.

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
  the insight's badge is the one place on Pulse that is.
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
