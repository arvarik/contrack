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
| `primary-dim`       | `#00628a` | Signature gradient dark end, dimmed primary states     |
| `primary-container` | `#47befd` | Signature gradient light end, primary containers       |
| `on-primary`        | `#ffffff` | Text/icons on primary-colored backgrounds              |

#### Surface Hierarchy (Paper Stack — "No-Line" Rule)

| Level             | Token                       | Hex       | Use                                    |
| ----------------- | --------------------------- | --------- | -------------------------------------- |
| Base Layer        | `surface`                   | `#f5f6f9` | Page background                        |
| Sectional Layer   | `surface-container-low`     | `#eff1f4` | Section backgrounds, input backgrounds |
| Interactive/Card  | `surface-container-lowest`  | `#ffffff` | Cards, elevated inputs                 |
| Elevated/Emphasis | `surface-container-high`    | `#e0e3e6` | Hovered states, kbd tags, dividers     |
| Maximum Emphasis  | `surface-container-highest` | `#d9e4e8` | Strong emphasis backgrounds            |

#### Text Colors

| Token                            | Usage                               |
| -------------------------------- | ----------------------------------- |
| `on-surface` (`#2a3437`)         | Primary text on surface backgrounds |
| `on-surface-variant` (`#566164`) | Secondary/muted text, placeholders  |

#### Semantic Accent Colors (Allowed)

| Color         | Semantic Meaning                               |
| ------------- | ---------------------------------------------- |
| `emerald-500` | Success, healthy, active, merge approval       |
| `amber-500`   | Warning, nearing due, caution                  |
| `rose-500`    | Error, overdue, destructive actions, rejection |
| `blue-500`    | Informational (phone match badge)              |

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
  its page and leaves `ai` alone, so a violet contact never makes its own notes
  read as AI.
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

**Exceptions** — borders ARE allowed for:

- Focus rings on inputs (`focus:ring-2 focus:ring-primary/30`)
- Active selection rings (`ring-2 ring-primary`)
- Drag-and-drop overlay borders (`border-4 border-dashed border-primary`)
- The timeline vertical line (decorative, not sectioning)

### Typography

| Role      | Tailwind Class                                                                       | Font    | Weights            |
| --------- | ------------------------------------------------------------------------------------ | ------- | ------------------ |
| Headlines | `font-headline`                                                                      | Manrope | 400, 600, 700, 800 |
| Body      | `font-body`                                                                          | Inter   | 300, 400, 500, 600 |
| Labels    | `LABEL`: `text-[11px] font-bold uppercase tracking-[0.08em] text-on-surface-variant` | Inter   | —                  |

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

| Token                                           | Size          | Use                                                         |
| ----------------------------------------------- | ------------- | ----------------------------------------------------------- |
| `LABEL`, `LABEL_PRIMARY`                        | 11 px, caps   | Micro labels, tracking 0.08em                               |
| `SECTION_HEADING`                               | 11 px, caps   | Card titles ("DETAILS"), one step below body                |
| `FIELD_LABEL`                                   | 12 px         | The name above one value ("Location"), sentence case        |
| `META_LINE`                                     | 14 px         | Facts under a name, joined by a middle dot                  |
| `KBD_SM`, `MICRO_BADGE`, `STATUS_BADGE_SUCCESS` | 11 px         | Keyboard chips, inline badges                               |
| `TAG_PILL`, `SOURCE_BADGE`                      | 11 px         | Pills                                                       |
| `ICON_BTN`                                      | 32 px visual  | Dense toolbar icon buttons, with `hit-area` (44 px target)  |
| `SEARCH_INPUT`                                  | 44 px / 40 px | The list search box: 44 px tall on a phone, 40 px from `sm` |

### Radius System

| Token                       | Value                    | Usage                                       |
| --------------------------- | ------------------------ | ------------------------------------------- |
| Default                     | `1rem` (16px)            | Standard rounding                           |
| `lg`                        | `1.5rem` (24px)          | Cards, large containers                     |
| `xl`                        | `2rem` (32px)            | Prominent containers                        |
| Buttons (primary/secondary) | `0.75rem` (`rounded-xl`) | CSS `.btn-primary` / `.btn-secondary` class |
| Pills                       | `9999px`                 | Chips, filter pills and `Segmented` only    |

## 2. Component CSS Classes (defined in `src/index.css`)

These reusable atomic classes are the blessed patterns. Use them instead of ad-hoc utilities.

| Class                | Pattern                                                                                 | Usage                                                                    |
| -------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `glass-panel`        | `rgba(255,255,255,0.80)` + `blur(20px)`                                                 | Modals, dropdowns, Command Palette, floating nav                         |
| `signature-gradient` | `linear-gradient(135deg, primary-dim → primary-container)`                              | **Branding ONLY** (the tile behind the glyph). ⚠️ NEVER for buttons/CTAs |
| `card`               | `bg-surface-container-lowest rounded-2xl p-6 shadow-sm`                                 | Standard card container                                                  |
| `card-elevated`      | `bg-surface-container-low rounded-2xl p-6 shadow-md`                                    | Elevated card with more shadow                                           |
| `input`              | `bg-surface-container-low rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/40`    | Text inputs                                                              |
| `btn-primary`        | Solid `bg-primary text-on-primary`, `rounded-xl`, bold 14 px, 44 px tall (40 from `sm`) | Primary CTAs. One per view where possible                                |
| `btn-secondary`      | `bg-surface-container-high text-on-surface`, same shape                                 | Secondary actions (Cancel, Back)                                         |
| `hit-area`           | `::after` box of `max(100%, 44px)`, centred, draws nothing                              | A control that looks smaller than 44 px (see below)                      |
| `section-divider`    | `h-px bg-surface-container-high my-4`                                                   | Visual section break (background shift, NOT a border)                    |
| `icon-container`     | `w-10 h-10 rounded-xl bg-surface-container-low` centered                                | Icon wrapper                                                             |

### Buttons

- ✅ `.btn-primary` for the main action, `.btn-secondary` for the others. The
  call site adds layout only (`w-full`, `flex-1`, a margin). The class sets the
  fill, the shape, the type, the 44 px height and the disabled look.
- ✅ One disabled look for both: a `surface-container-high` fill with an
  `on-surface-variant` label. No `disabled:opacity-*` at the call site, because
  fading a filled button fades its label into its own fill.
- ❌ `rounded-full` on a filled `bg-primary` button. Pills are chips, filter
  pills and `Segmented`. `tests/unit/styles.floor.test.ts` fails on a class
  string with a solid `bg-primary`, `rounded-full` and `px-2` or more outside
  its allow-list.

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
- Active states: Add `active:bg-*` and `active:scale-[0.98]` for touch feedback.
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

- A 48 px icon tile on a `bg-primary/10` wash, a 16 px bold title, one
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

### Animation Standards

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
- ❌ Blind nested DOM interactivity inside the Command Palette without `onMouseDown` preventions.
- ❌ Utilizing `overflow-hidden` on parent wrappers when attempting to show `ring-2` effects without `ring-inset`.
- ❌ Invoking native `useEffect` fetch loops instead of `@tanstack/react-query` lifecycle managers.
- ❌ Relying on vec0 SQL cascades without explicit backend code deletion blocks.
- ❌ Using `violet-*`, `fuchsia-*`, `purple-*`, or `indigo-*` colors anywhere.
- ❌ Using `signature-gradient` for buttons or CTAs — gradients are for branding only.
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

| Surface                           | Variant       | Size       | Colour                           |
| --------------------------------- | ------------- | ---------- | -------------------------------- |
| Tab strip favicon                 | glyph on tile | 16 to 32   | white on gradient, eye `#47befd` |
| PWA and touch icons               | glyph on tile | 180 to 512 | same                             |
| Sidebar perch                     | mark          | 32         | `text-primary`, eye token        |
| Auth card                         | mark          | 40         | `text-primary`                   |
| Empty states                      | mark          | 64 to 96   | `text-primary/60`                |
| Crash screen footer               | mark          | 20         | `text-on-surface-variant`        |
| README header                     | PNG           | 96         | fixed brand colours              |
| Flight overlay                    | mark          | 48         | `text-primary`                   |
| Settings footer (phone, Prompt 3) | mark          | 20         | `text-on-surface-variant`        |
| Thinking indicator (Prompt 3)     | glyph         | 20         | `text-primary`                   |

The last two rows are reserved for the rest of the motion phase and have no
surface yet.

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
