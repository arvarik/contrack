# Style Guide & Code Conventions

_This document enforces the visual identity and coding patterns of the project. It prevents context drift as multiple agents work on the codebase. Agents MUST follow these rules strictly._

## 1. Visual Language & Tokens
- **Tailwind CSS v4** is strictly enforced.
- **Surface Hierarchy (No-Line Principle)**: Containment is strictly enforced by surface color shifts (`surface` → `surface-container-low` → `surface-container-lowest`). 
- ❌ **NEVER** use 1px solid borders (`border-gray-200`) for sectioning. The only exceptions are explicit interactivity rings (inputs via `focus:ring-2`, active interactions).

## 2. Component Patterns
### Grid & Overflow Restrictions
- When managing responsive layouts with `flex` or `grid`, always use `min-w-0` on immediate children holding distinct internal DOM components (like text truncation or images). This prevents Flexbox from violating column parameters and overflowing content.
- 🔴 **The `ring-inset` Rule:** Using `overflow-hidden` will aggressively clip any standard `ring-*` styling since rings render outside the box-model. Whenever elements sit within `overflow-hidden` containers (like Command Palette lists or Glass modals), you **MUST** use `ring-inset` to guarantee safe rendering inside paddings.

### Command Palette (`src/components/command-palette/`)
This acts as an intricate state machine managing layered interactions (`cmdk`).
- **Focus-Stealing Prevention:** Any interactive DOM object (button, input) inside the Command Palette that is *not* a standard `Command.Item` must carry `onMouseDown={(e) => e.preventDefault()}`. Omitting this prompts `cmdk` to automatically perceive clicks as an "outside DOM click," instantly crashing/closing the palette.
- **Event Bubbling Safety:** Wrap internal components with `onMouseDown={(e) => e.stopPropagation()}` to prevent event bleeding into the overlay container.
- **Keyboard Architecture:** `useGlobalNavShortcuts` governs `Cmd+Shift+X`. Inside deeply nested components (`ActionSubMenu`, `FacetAutocomplete`), custom keyboard hooks must exclusively employ the `capture phase`: `window.addEventListener('keydown', handler, true)`.

### Mobile Responsiveness
- Keybinding tags (`<kbd>`) must remain `hidden sm:inline-flex`.
- Enlarged hit-areas via padded mobile rules (`py-3 sm:py-2.5`).

## 3. Code Conventions
### Architecture Patterns
- **Local-First Boundary**: Exclusively use the SQLite database.
- **Thin Routes / Heavy Services**: Express routes live in `server/routes/` and simply parse incoming properties. Advanced AI filtering, deduping, and SQL writes exist exclusively within `server/services/`.
- **AI Abstraction**: The `SmartRouter` encapsulates vendor specifics. Do not invoke `@google/genai` arbitrarily in a route.

### Strict Typing
- Utilize `Record<string, unknown>` for object placeholders instead of implicit indexing. No `any` logic outside strict type narrowing clauses.

## 4. Anti-Patterns (FORBIDDEN)
- ❌ 1px solid borders for visual segmentation.
- ❌ Blind nested DOM interactivity inside the Command Palette without `onMouseDown` preventions.
- ❌ Utilizing `overflow-hidden` on parent wrappers when attempting to show `ring-2` effects without `ring-inset`.
- ❌ Invoking native `useEffect` fetch loops instead of `@tanstack/react-query` lifecycle managers.
- ❌ Relying on vec0 SQL cascades without explicit backend code deletion blocks.