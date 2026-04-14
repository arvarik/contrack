# Style Guide & Code Conventions

_This document enforces the visual identity and coding patterns of the project. It prevents context drift as multiple agents work on the codebase. Agents MUST follow these rules strictly._

## 1. Visual Language & Tokens

### CSS Framework
- **Tailwind CSS v4** is strictly enforced via `@tailwindcss/vite` plugin.
- All design tokens are defined in `src/index.css` under the `@theme` block.
- Custom component classes are defined in the `@layer components` block.

### Color System

#### Primary Palette
| Token | Value | Usage |
|-------|-------|-------|
| `primary` | `#009EDB` | Primary actions, active states, interactive highlights |
| `primary-dim` | `#00628a` | Signature gradient dark end, dimmed primary states |
| `primary-container` | `#47befd` | Signature gradient light end, primary containers |
| `on-primary` | `#ffffff` | Text/icons on primary-colored backgrounds |

#### Surface Hierarchy (Paper Stack — "No-Line" Rule)
| Level | Token | Hex | Use |
|-------|-------|-----|-----|
| Base Layer | `surface` | `#f5f6f9` | Page background |
| Sectional Layer | `surface-container-low` | `#eff1f4` | Section backgrounds, input backgrounds |
| Interactive/Card | `surface-container-lowest` | `#ffffff` | Cards, elevated inputs |
| Elevated/Emphasis | `surface-container-high` | `#e0e3e6` | Hovered states, kbd tags, dividers |
| Maximum Emphasis | `surface-container-highest` | `#d9e4e8` | Strong emphasis backgrounds |

#### Text Colors
| Token | Usage |
|-------|-------|
| `on-surface` (`#2a3437`) | Primary text on surface backgrounds |
| `on-surface-variant` (`#566164`) | Secondary/muted text, placeholders |

#### Semantic Accent Colors (Allowed)
| Color | Semantic Meaning |
|-------|-----------------|
| `emerald-500` | Success, healthy, active, merge approval |
| `amber-500` | Warning, nearing due, caution |
| `rose-500` | Error, overdue, destructive actions, rejection |
| `blue-500` | Informational (phone match badge) |

#### Off-Palette Colors (FORBIDDEN)
- ❌ `violet-*`, `fuchsia-*`, `purple-*` — replaced by `primary` tokens
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
| Role | Tailwind Class | Font | Weights |
|------|----------------|------|---------|
| Headlines | `font-headline` | Manrope | 400, 600, 700, 800 |
| Body | `font-body` | Inter | 300, 400, 500, 600 |
| Labels | `text-[10px] font-bold uppercase tracking-widest text-on-surface-variant` | Inter | — |

### Radius System
| Token | Value | Usage |
|-------|-------|-------|
| Default | `1rem` (16px) | Standard rounding |
| `lg` | `1.5rem` (24px) | Cards, large containers |
| `xl` | `2rem` (32px) | Prominent containers |
| Buttons (primary/secondary) | `9999px` (pill) | CSS `.btn-primary` / `.btn-secondary` class |

## 2. Component CSS Classes (defined in `src/index.css`)
These reusable atomic classes are the blessed patterns. Use them instead of ad-hoc utilities.

| Class | Pattern | Usage |
|-------|---------|-------|
| `glass-panel` | `rgba(255,255,255,0.80)` + `blur(20px)` | Modals, dropdowns, Command Palette, floating nav |
| `signature-gradient` | `linear-gradient(135deg, primary-dim → primary-container)` | **Branding ONLY** (sidebar logo text). ⚠️ NEVER use for buttons or CTAs |
| `card` | `bg-surface-container-lowest rounded-2xl p-6 shadow-sm` | Standard card container |
| `card-elevated` | `bg-surface-container-low rounded-2xl p-6 shadow-md` | Elevated card with more shadow |
| `input` | `bg-surface-container-low rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/40` | Text inputs |
| `btn-primary` | Solid `bg-primary text-on-primary` pill with hover scale | Primary CTAs |
| `btn-secondary` | `bg-surface-container-low text-on-surface` pill | Secondary/ghost actions |
| `section-divider` | `h-px bg-surface-container-high my-4` | Visual section break (background shift, NOT a border) |
| `icon-container` | `w-10 h-10 rounded-xl bg-surface-container-low` centered | Icon wrapper |

## 3. Component Patterns

### Grid & Overflow Restrictions
- When managing responsive layouts with `flex` or `grid`, always use `min-w-0` on immediate children holding distinct internal DOM components (like text truncation or images). This prevents Flexbox from violating column parameters and overflowing content.
- 🔴 **The `ring-inset` Rule:** Using `overflow-hidden` will aggressively clip any standard `ring-*` styling since rings render outside the box-model. Whenever elements sit within `overflow-hidden` containers (like Command Palette lists or Glass modals), you **MUST** use `ring-inset` to guarantee safe rendering inside paddings.

### When `overflow-hidden` IS Appropriate
- Animate height transitions: `motion.div` with `height: 0 → auto` needs `overflow-hidden`.
- Inside cards: On card content that should clip (images, long text).

### Command Palette (`src/components/command-palette/`)
This acts as an intricate state machine managing layered interactions (`cmdk`).
- **Focus-Stealing Prevention:** Any interactive DOM object (button, input) inside the Command Palette that is *not* a standard `Command.Item` must carry `onMouseDown={(e) => e.preventDefault()}`. Omitting this prompts `cmdk` to automatically perceive clicks as an "outside DOM click," instantly crashing/closing the palette.
- **Event Bubbling Safety:** Wrap internal components with `onMouseDown={(e) => e.stopPropagation()}` to prevent event bleeding into the overlay container.
- **Keyboard Architecture:** `useGlobalNavShortcuts` governs `Cmd+Shift+X`. Inside deeply nested components (`ActionSubMenu`, `FacetAutocomplete`), custom keyboard hooks must exclusively employ the `capture phase`: `window.addEventListener('keydown', handler, true)`. Always pair with `e.stopPropagation()` to prevent the event from reaching other listeners.

### Mobile Responsiveness
- Keybinding tags (`<kbd>`) must remain `hidden sm:inline-flex`.
- Footer navigation bars: `hidden sm:flex` on desktop-only hint bars.
- Touch targets: `p-2 sm:p-1` for buttons, `py-3 sm:py-2.5` for list items.
- Active states: Add `active:bg-*` and `active:scale-[0.98]` for touch feedback.
- Responsive text: Show "Cancel" on mobile, "ESC back" on desktop.
- Enlarged hit-areas via padded mobile rules.

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