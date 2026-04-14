# Style Guide & Code Conventions

_This document enforces the visual identity and coding patterns of the project. It prevents context drift as multiple agents work on the codebase. Agents MUST follow these rules strictly._

## 1. Visual Language & Tokens
### Colors & Hierarchy
- **Tailwind CSS v4** is strictly enforced.
- **Surface Hierarchy**: Containment is expressed strictly through surface background color shifts, not borders. 
  - `bg-surface`: Base layer
  - `bg-surface-container`: Secondary containers
  - `bg-surface-container-lowest`: Cards and modals

## 2. Component Patterns
- **Command Palette (`src/components/command-palette/`)**: Acts as a state machine managing multiple layers (InlineNoteComposer, ActionSubMenu, Search Results).
- **Interactive Elements**: Use `onMouseDown={(e) => e.preventDefault()}` on ALL interactive elements inside the palette that are not `Command.Item` elements. Without this, `cmdk` interprets clicks as "outside" clicks and closes the dialog.
- **Keyboard Shortcuts**: Global shortcuts (`Cmd+Shift+*`) are managed in `useGlobalNavShortcuts`. Capture-phase keydown listeners are used inside sub-menus to intercept keys before global nav.
- **Mobile Design**: `<kbd>` hints are hidden on mobile (`hidden sm:inline-flex`). Touch targets are enlarged via `p-2 sm:p-1`.

## 3. Code Conventions
### Architecture Patterns
- **Local-First**: SQLite is the canonical data store.
- **Service Layer**: Express routes (`server/routes/`) must be thin controllers. Complex business logic (dedupe, advanced search) belongs in `server/services/`.
- **AI Adapter Pattern**: All AI calls route through `server/ai/aiService.ts` -> `SmartRouter` -> `AIProvider` interface. The implementation details of Gemini are isolated.

### Strict Typing
- **TypeScript**: The codebase maintains strict typing. Usage of `any` is prohibited outside of edge-case type narrowing. 
- Prefer `Record<string, unknown>` over arbitrary index signatures.

## 4. Anti-Patterns (FORBIDDEN)
- ❌ **NEVER** use standard border properties (e.g., `border-gray-200`) or 1px solid borders for sectioning. Boundaries must be defined solely through surface background color shifts.
- ❌ **NEVER** use `any` types outside of absolute necessity for type narrowing.
- ❌ **NEVER** write raw `useEffect` fetch loops. All frontend data fetching must go through `@tanstack/react-query` hooks.
- ❌ **NEVER** make network round-trips to managed external databases for core storage. The app is local-first.
- ❌ **NEVER** silently swallow Promise errors with an empty `.catch(() => {})`. Log defensively.
- ❌ **NEVER** assume vec0 tables (`search_embeddings`, `contact_embeddings`) support foreign key cascading. They do not.