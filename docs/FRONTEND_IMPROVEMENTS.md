# Contrack Frontend Improvement Spec

**Version:** 1.0  
**Author:** Principal Frontend Engineering Review  
**Date:** April 8, 2026  
**Scope:** All files under `/src` — ~90 files, ~10,000+ LOC  

---

## Executive Summary

Contrack CRM has a strong design system foundation (Manrope + Inter typography, paper-stack surface hierarchy, no-line rule, signature gradient CTAs) and solid engineering patterns (TanStack Query, FSD-inspired structure, React.memo with structural comparators, CSS-based animations over Framer Motion where performance matters).

This document identifies **21 improvement items** across 6 categories, ranging from quick wins to larger refactors. Each item is written as a spec an engineer can directly implement from.

### Priority Legend

| Priority | Meaning |
|---|---|
| 🔴 **Critical** | Blocks user success or creates visible broken experience |
| 🟡 **High** | Meaningfully improves perceived quality or developer velocity |
| 🟢 **Medium** | Polish that separates "good" from "premium" |
| ⚪ **Low** | Nice-to-have refinement |

### Effort Legend

| Effort | Meaning |
|---|---|
| **XS** | < 1 hour, single file |
| **S** | 1–3 hours, 1–3 files |
| **M** | 3–8 hours, 3–8 files |
| **L** | 1–2 days, system-wide |
| **XL** | 2–5 days, architectural change |

---

## Category 1: Architecture & Code Organization

### 1.1 — ContactList.tsx is a 991-line God Component

**What currently exists:**  
`ContactList.tsx` is the single largest file in the codebase at 991 lines. It manages: search state, URL-persisted filters, multi-select mode, bulk actions (delete, archive, add-to-list, color change, CSV export), context menus, drag-to-reorder lists, keyboard navigation, scroll restoration, pull-to-refresh, "recent contacts" strip, modal state for 5+ modals (new contact, smart paste, import, create list, bulk edit, bulk delete confirm, add-to-list picker), and the entire JSX render tree for all of these.

**Why it's a problem:**  
- **Cognitive load:** Developers must hold 991 lines of context to make any change to the contact list
- **Re-render blast radius:** Any state change (e.g. opening the add menu) triggers a re-render of the entire component tree, including all modal JSX
- **Testing difficulty:** The component is untestable in isolation — you can't test bulk actions without also loading the filter system and keyboard handlers
- **5+ `useEffect` hooks** with different concerns (outside-click, keyboard, scroll) are interleaved with business logic

**Proposed solution:**  
Extract the component into a composable hierarchy:

```
contact-list/
  ContactList.tsx          ← ~200 lines: orchestrator, URL state, contacts query
  ContactListHeader.tsx    ← Search bar, filter pills, add menu, select-all
  ContactListBody.tsx      ← Scroll container, recent strip, main list, empty states
  BulkActionToolbar.tsx    ← Already extracted ✓
  ContactListItem.tsx      ← Already extracted ✓
  CreateListModal.tsx      ← Already extracted ✓
  modals/
    NewContactModal.tsx    ← Extract from inline JSX
    SmartPasteModal.tsx    ← Extract from inline JSX
    BulkDeleteModal.tsx    ← Extract from inline JSX
    AddToListModal.tsx     ← Extract from inline JSX
  hooks/
    useContactListFilters.ts   ← URL-persisted filter + search state
    useContactListKeyboard.ts  ← Keyboard navigation handler
    useBulkActions.ts          ← Multi-select state + all bulk mutation handlers
    useListDragReorder.ts      ← Drag-to-reorder state machine
```

Each modal currently lives inline as 20–50 lines of JSX deep inside the return statement. Extracting them into their own files with clear `isOpen`/`onClose`/`onSuccess` props makes them independently testable and reusable.

**How it helps:**  
- Each file is under 200 lines
- Modal state lives next to the modal, not 500 lines away
- Custom hooks can be tested without rendering any DOM
- Changes to bulk actions can't accidentally break keyboard navigation

**Priority:** 🟡 High  
**Effort:** L (1–2 days)

---

### 1.2 — Inconsistent `useEffect` Patterns for Outside-Click Dismiss

**What currently exists:**  
`ContactList.tsx` has two nearly identical `useEffect` blocks (lines 317–333) for closing the "more lists" dropdown and the "add menu" dropdown on outside click. Each registers/removes a global `mousedown` listener manually via `useRef` + `document.addEventListener`.

The same pattern appears in `VibePickerPopover.tsx` and other components with custom dropdowns.

**Why it's a problem:**  
- Copy-paste code creates inconsistency — one bug fix has to be applied N times
- Raw `addEventListener` is easy to leak if cleanup isn't perfect
- No accessibility handling (Escape key, focus trapping)

**Proposed solution:**  
Create a `useClickOutside(ref, callback, enabled)` hook in `src/hooks/`:

```ts
/** useClickOutside — Close a dropdown/popover when clicking outside its container. */
export function useClickOutside(
  ref: React.RefObject<HTMLElement>,
  onOutsideClick: () => void,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onOutsideClick();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ref, onOutsideClick, enabled]);
}
```

Then replace all inline `useEffect` blocks with: `useClickOutside(moreRef, () => setShowMoreLists(false), showMoreLists)`.

**How it helps:**  
- Single source of truth for outside-click logic
- DRY across 4+ components
- Easier to add Escape-key support in one place

**Priority:** 🟢 Medium  
**Effort:** S (1–2 hours)

---

### 1.3 — Inline `as any` Type Assertions Throughout

**What currently exists:**  
Multiple files use `as any` to bypass TypeScript:
- `ContactList.tsx:237` — `} as any)` on create contact payload
- `ContactList.tsx:396` — `{ isArchived: true } as any`
- `ContactList.tsx:420` — `{ themeColor: vibeId } as any`
- `DetailsCard.tsx:49` — `{ interests: updated } as any`
- `DetailsCard.tsx:56` — `{ interests: updated } as any`
- `DossierTab.tsx:64` — `{ aiBackground: dossierText } as any`
- 8+ additional occurrences across the codebase

**Why it's a problem:**  
- Type safety is the #1 reason to use TypeScript. Each `as any` is a hole where bugs can silently enter
- The pattern suggests the `useUpdateContact` mutation's `data` parameter type is too narrow, forcing callers to cast
- Refactoring any field name will not produce a compile error at these sites

**Proposed solution:**  
1. Widen the update contact mutation's `data` type to accept `Partial<ContactUpdatePayload>` where `ContactUpdatePayload` includes all mutable fields (including `interests`, `themeColor`, `aiBackground`, `isArchived`, etc.)
2. Create a comprehensive `ContactUpdatePayload` type in `src/types.ts` that covers all update-able fields
3. Remove all `as any` casts and let TypeScript verify correctness

**How it helps:**  
- Compile-time safety for all contact mutations
- Refactoring becomes safe — rename a field and the compiler shows every callsite

**Priority:** 🟡 High  
**Effort:** M (3–5 hours)

---

### 1.4 — Dropdown Menu System Uses Dark Theme, Inconsistent with App

**What currently exists:**  
In `styles.ts`, the `DROPDOWN_MENU` token uses:
```ts
bg-[#242424] py-1.5 shadow-xl ring-1 ring-white/10 ... text-gray-200
```

This is a hard-coded dark-mode dropdown in an app that has no dark mode. It clashes with the light paper-stack surface hierarchy defined in the design system.

It's also the only place in the codebase using raw hex colors (`#242424`) and `gray-200` instead of surface tokens.

**Why it's a problem:**  
- Visual inconsistency — a dark dropdown appearing in a soft light UI feels jarring
- Violates the design system's color palette rules (no off-palette colors)
- If dark mode is ever added, this component won't adapt because it's hard-coded dark

**Proposed solution:**  
Replace with design-system tokens:
```ts
export const DROPDOWN_MENU = 
  "absolute z-50 mt-1 max-h-56 w-max min-w-full overflow-y-auto rounded-xl " +
  "glass-panel py-1.5 shadow-xl outline-none scrollbar-hide";

export const DROPDOWN_ITEM = 
  "cursor-pointer px-4 py-2 text-sm font-medium text-on-surface " +
  "hover:bg-primary/10 hover:text-primary transition-colors flex items-center";
```

**How it helps:**  
- Consistent visual language throughout the app
- Dark-mode-ready if that's ever added
- Follows the glassmorphism rule already used by modals and the add menu

**Priority:** 🟢 Medium  
**Effort:** XS (< 1 hour)

---

## Category 2: UX & Interaction Design

### 2.1 — No Loading Skeleton for Contact List

**What currently exists:**  
When the contact list is loading, the feedback is a single pulsing 24px circle:
```tsx
<div className="animate-pulse w-6 h-6 rounded-full bg-primary/20" />
```

This is displayed centered in the viewport, providing no layout scaffolding.

**Why it's a problem:**  
- **Layout shift:** When data arrives, the content jumps from a centered dot to a full list, causing a jarring visual shift
- **Perceived slowness:** Content-shaped skeletons reduce perceived loading time by ~35% (Google research). A dot spinner provides no content preview
- The Dashboard already has a bespoke `DashboardSkeleton` component but the main contact list — the most-visited view — does not

**Proposed solution:**  
Create a `ContactListSkeleton` that renders 8–12 shimmer rows matching `ContactListItem`'s exact layout (avatar circle + two text lines):

```tsx
const ContactListSkeleton = () => (
  <div className="space-y-2 p-4">
    {Array.from({ length: 10 }).map((_, i) => (
      <div key={i} className="flex items-center gap-3 p-3 rounded-xl" 
           style={{ animationDelay: `${i * 60}ms` }}>
        <div className="w-12 h-12 rounded-full bg-surface-container-high animate-pulse" />
        <div className="flex-1 space-y-2">
          <div className="h-3.5 bg-surface-container-high rounded-full animate-pulse w-2/5" />
          <div className="h-3 bg-surface-container rounded-full animate-pulse w-3/5" />
        </div>
      </div>
    ))}
  </div>
);
```

**How it helps:**  
- Zero layout shift on data arrival
- Communicates the shape of upcoming content
- Consistent with the shimmer pattern already used in SearchView and DashboardView

**Priority:** 🟡 High  
**Effort:** S (1–2 hours)

---

### 2.2 — "New Contact" Modal Form Uses Raw HTML Inputs, Not Design System

**What currently exists:**  
The "New Contact" form modal (ContactList.tsx lines 874–910) uses inline raw CSS classes:
```tsx
className={`w-full border-none rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-primary 
  ${parsedData?.name ? 'bg-primary/10 ring-2 ring-primary/50 shadow-[0_0_15px_...]' : 'bg-surface-container'}`}
```

Each of the 6 input fields has this 150+ character className string copy-pasted with slight variations. None use the `.input` CSS class or `SEARCH_INPUT`/`EDITABLE_INPUT` tokens from the design system.

**Why it's a problem:**  
- **Inconsistency:** Input styling differs from inputs elsewhere in the app (different border-radius, different focus ring, different background)
- **Maintenance:** Changing input styling requires updating 6+ copy-pasted strings
- **AI-highlighted fields** use `animate-pulse` on the entire input, which is visually distracting and makes the text hard to read while pulsing

**Proposed solution:**  
1. Create a `FormInput` component that wraps the `.input` CSS class with label support:
```tsx
const FormInput = ({ label, aiHighlighted, ...props }) => (
  <div>
    <label className={LABEL}>{label}</label>
    <input className={cn("input", aiHighlighted && "ring-2 ring-primary/50 bg-primary/5")} {...props} />
  </div>
);
```
2. Replace the AI-highlight with a subtle border glow instead of `animate-pulse` (which fights the user's ability to read/edit the field)
3. Extract the entire modal into a `NewContactModal.tsx` component

**How it helps:**  
- Single input styling source of truth
- AI-highlighted fields are visible but not disruptive
- Modal is testable in isolation

**Priority:** 🟡 High  
**Effort:** S (2–3 hours)

---

### 2.3 — `confirm()` Used for Destructive Actions Instead of Custom Modal

**What currently exists:**  
`ContactProfile.tsx` line 118 uses the browser's native `window.confirm()` dialog:
```ts
if (!confirm(`Permanently delete ${contact.name}? This cannot be undone.`)) return;
```

**Why it's a problem:**  
- `window.confirm()` is a synchronous browser dialog that:
  - Cannot be styled (breaks the design system entirely)
  - Blocks the JavaScript thread
  - Looks completely different across browsers and operating systems
  - Has no icon, no contextual information, no cancel/confirm distinction
- Every other destructive action in the app (bulk delete, archive) uses a proper styled `<Modal>` — this is the lone outlier

**Proposed solution:**  
Replace with a `ConfirmDeleteModal` using the existing `<Modal>` component, matching the pattern already established by the bulk delete confirmation dialog in `ContactList.tsx`:

```tsx
<Modal isOpen={isDeleteConfirm} onClose={() => setIsDeleteConfirm(false)} title="Delete Contact">
  <div className="space-y-4 pt-2">
    <p className="text-sm text-on-surface-variant leading-relaxed">
      Permanently delete <span className="font-bold text-on-surface">{contact.name}</span>?
      This will remove all their interactions and data.
      <span className="text-rose-500 font-bold"> This cannot be undone.</span>
    </p>
    <div className="flex gap-3 pt-2">
      <button className="flex-1 btn-secondary">Cancel</button>
      <button className="flex-1 ... bg-rose-500 text-white">Delete</button>
    </div>
  </div>
</Modal>
```

**How it helps:**  
- Consistent destructive-action UX throughout the app
- Styled to match the design system
- Non-blocking, properly animated

**Priority:** 🔴 Critical  
**Effort:** XS (< 1 hour)

---

### 2.4 — About Section "Hover to Expand" Pattern is Not Mobile-Friendly

**What currently exists:**  
In `DossierTab.tsx` (line 101–105), the "About" section uses a CSS `:hover` to expand truncated text:
```tsx
className="... max-h-32 overflow-hidden ... hover:max-h-full hover:after:opacity-0 transition-all"
```
And a label: `"Hover to expand"`.

**Why it's a problem:**  
- **Mobile devices do not have hover.** Touch users have no way to discover or use this interaction
- The fade-gradient mask (`after:bg-gradient-to-t`) obscures the last 2 lines of text, which may contain important information
- "Hover to expand" is a tooltip-tier micro-copy that many users will never notice

**Proposed solution:**  
Replace with a click-to-expand pattern using local state:

```tsx
const [expanded, setExpanded] = useState(false);

<p className={cn("...", !expanded && "max-h-32 overflow-hidden")}>
  {contact.about}
</p>
{!expanded && (
  <button onClick={() => setExpanded(true)} className="text-xs text-primary font-bold mt-1">
    Show more
  </button>
)}
```

This is consistent with how social platforms (LinkedIn, Twitter) handle long-form text — a clear "Show more" / "Show less" toggle.

**How it helps:**  
- Works on all devices (mobile, tablet, desktop)
- Clear affordance — users know they can expand
- No content is ever hidden by a gradient mask

**Priority:** 🟡 High  
**Effort:** XS (< 1 hour)

---

### 2.5 — Urgency Banner Violates the "No-Line Rule"

**What currently exists:**  
`ProfileHeader.tsx` line 91 renders an urgency banner:
```tsx
className="w-full bg-error/10 border-b border-error/20 px-6 py-3 ..."
```

This uses `border-b border-error/20` — a 1px solid border — which directly violates the design system's No-Line Rule: *"1px solid borders are STRICTLY PROHIBITED for sectioning."*

**Why it's a problem:**  
- Breaks the visual language that separates Contrack from generic apps
- The border is barely visible on most monitors (1px at 20% opacity) but introduces a subtle line that conflicts with the paper-stack aesthetic

**Proposed solution:**  
Replace the border with the design system's surface hierarchy approach — use a stronger background color shift:
```tsx
className="w-full bg-rose-500/12 px-6 py-3 ..." // no border, stronger bg tint
```

Or per the design system's glass panel rule, use a subtle shadow for depth:
```tsx
className="w-full bg-rose-500/10 shadow-sm px-6 py-3 ..."
```

**How it helps:**  
- Consistent with the No-Line Rule everywhere else
- Stronger visual presence through color rather than thin lines

**Priority:** 🟢 Medium  
**Effort:** XS (< 30 minutes)

---

### 2.6 — AI Summary Border Also Violates the No-Line Rule

**What currently exists:**  
`ProfileHeader.tsx` line 205:
```tsx
className="... border border-primary/20 ..."
```

The AI summary card has a full `border` with primary color at 20% opacity.

**Why it's a problem:**  
Same as 2.5 — violates the No-Line Rule. The design system explicitly states borders are not allowed for sectioning.

**Proposed solution:**  
Replace with the `CARD_TINTED` token which is already defined in `styles.ts` for exactly this purpose:
```tsx
className={cn(CARD_TINTED, "max-w-fit")}
```

`CARD_TINTED` = `"bg-primary/5 rounded-2xl p-6 shadow-sm relative overflow-hidden"` — no border.

**How it helps:**  
- Uses existing design system token
- No border, consistent visual language

**Priority:** 🟢 Medium  
**Effort:** XS (< 15 minutes)

---

## Category 3: Performance & Rendering

### 3.1 — Contact List Does Not Virtualize Long Lists

**What currently exists:**  
The contact list renders all contacts as DOM elements:
```tsx
{filteredContacts.map(contact => (
  <ContactRowWrapper key={contact.id}>
    <ContactListItem ... />
  </ContactRowWrapper>
))}
```

For a user with 500+ contacts, this creates 500+ DOM nodes even if only ~15 are visible on screen.

**Why it's a problem:**  
- **Initial render cost:** React must create 500+ component instances and DOM nodes on mount
- **Memory overhead:** Each `ContactRowWrapper` adds event listeners (context menu, long press) for every row
- **Scroll performance:** While the `React.memo` on `ContactListItem` prevents re-renders on state change, the initial mount and any filter change still processes the full list
- For users with 1000+ contacts (enterprise users), this will cause visible lag

**Proposed solution:**  
Integrate `@tanstack/react-virtual` (or `react-window`) to virtualize the contact list:

```tsx
import { useVirtualizer } from '@tanstack/react-virtual';

const virtualizer = useVirtualizer({
  count: filteredContacts.length,
  getScrollElement: () => scrollRef.current,
  estimateSize: () => 64, // approximate row height
  overscan: 8,
});
```

This only renders the ~15–20 visible rows plus 8 overscan rows, regardless of list size.

**Considerations:**  
- Pull-to-refresh and scroll restoration hooks need to work with the virtualizer's scroll container
- The "recent contacts" strip at the top should remain outside the virtualizer as a fixed header
- The keyboard navigation (ArrowUp/Down) needs to call `virtualizer.scrollToIndex()` instead of raw `scrollIntoView`

**How it helps:**  
- Constant O(1) DOM node count regardless of list size
- Sub-16ms render for any list size
- Memory usage scales with viewport, not data size

**Priority:** 🟡 High  
**Effort:** M (4–6 hours)

---

### 3.2 — Timeline Entries Each Have `motion.div` with `initial/animate`

**What currently exists:**  
Every timeline entry in `TimelineTab.tsx` (line 132) is wrapped in:
```tsx
<motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
```

This means every entry runs a Framer Motion animation on mount — even entries that were already visible and just re-rendered.

**Why it's a problem:**  
- **Unnecessary animations on re-render:** If a user adds a new interaction, all existing entries re-animate (fade in + slide up) even though they were already visible
- **Performance cost:** Each `motion.div` creates a separate animation instance with its own RAF loop
- This was already fixed in `SearchView.tsx` (see the detailed comment in that file) but the fix wasn't applied to the timeline

**Proposed solution:**  
Apply the same CSS-based animation strategy used in `SearchView.tsx`:
1. Use the existing `.result-card-enter` CSS animation class (or create a similar `.timeline-card-enter`)
2. Apply `animationDelay` per card index for staggered entrance
3. Remove the Framer Motion wrapper from individual timeline entries

Or, if entrance animation isn't needed (the timeline scrolls into view naturally), simply remove the animations entirely and let the timeline render statically.

**How it helps:**  
- Eliminates re-animation on data updates
- GPU-composited CSS animations instead of JS-driven Framer Motion
- Consistent animation strategy with SearchView

**Priority:** 🟢 Medium  
**Effort:** S (1–2 hours)

---

### 3.3 — `useContacts()` Called in 5+ Components Without Selector

**What currently exists:**  
`useContacts()` is called directly in:
- `ContactList.tsx` (expected — primary consumer)
- `RichInteractionComposer.tsx` (only needs names for mention autocomplete)
- `CommandPalette.tsx` (only needs names + IDs for search)
- `AISearchView.tsx` (needs all contacts for selection)
- `ContactPicker.tsx` in dedupe (needs names for picker)

Each call returns the full `Contact[]` array with all fields (emails, phones, tags, experience, education, social links, etc.)

**Why it's a problem:**  
- `RichInteractionComposer` only needs `{ id, name }` for mention autocomplete but receives full contact objects with 20+ fields
- When any contact's any field changes, all 5 components re-render because the `data` reference changes
- This doesn't cause visible bugs because of React.memo in child components, but it's wasted reconciliation work

**Proposed solution:**  
Use TanStack Query's `select` option to derive minimal projections:

```ts
// In RichInteractionComposer — only re-renders when names change
const { data: contactNames = [] } = useContacts({
  select: (contacts) => contacts.map(c => ({ id: c.id, name: c.name })),
});
```

Or create purpose-built hooks:
```ts
export const useContactNames = () => useContacts({ 
  select: (contacts) => contacts.map(c => ({ id: c.id, name: c.name }))
});
```

**How it helps:**  
- TanStack Query's `select` is memoized — components only re-render when their projected data actually changes
- Smaller data objects mean faster equality checks in React.memo comparators

**Priority:** 🟢 Medium  
**Effort:** S (2–3 hours)

---

## Category 4: Accessibility

### 4.1 — Modal Does Not Trap Focus (Tab Key Escapes)

**What currently exists:**  
The `Modal.tsx` component notes in its own docstring (line 8):
```
Traps Escape to close (does not trap full Tab focus — acceptable for this app)
```

While Escape works, pressing Tab allows focus to escape the modal and reach elements behind the backdrop.

**Why it's a problem:**  
- WCAG 2.1 Success Criterion 2.1.2 requires that keyboard focus stays within a modal dialog
- Screen reader users can Tab out of the modal and interact with content they can't see (because it's behind a backdrop blur)
- This is "acceptable for this app" only if the app is personal-use. For any team or enterprise context, it's a compliance gap

**Proposed solution:**  
Add a focus trap using a small utility or library like `focus-trap-react`:

```tsx
import FocusTrap from 'focus-trap-react';

<FocusTrap active={isOpen} focusTrapOptions={{ allowOutsideClick: true }}>
  <motion.div role="dialog" aria-modal="true" ...>
    {/* modal content */}
  </motion.div>
</FocusTrap>
```

Or implement a lightweight manual trap:
```ts
const handleTab = (e: KeyboardEvent) => {
  if (e.key !== 'Tab') return;
  const focusable = modalRef.current?.querySelectorAll('button, input, a, textarea, select');
  // cycle focus within focusable elements
};
```

**How it helps:**  
- WCAG 2.1 AA compliance for modal dialogs
- Screen reader users stay within the modal context
- Professional-grade accessibility

**Priority:** 🟡 High  
**Effort:** S (1–2 hours)

---

### 4.2 — Interactive Elements Missing `aria-label` / Accessible Names

**What currently exists:**  
Several interactive elements rely solely on visual icons for meaning:
- The "×" clear-search button in ContactList has `aria-label="Clear search"` ✓
- But the VibePickerPopover color dots have no `aria-label`
- The timeline delete button (`<Trash2>`) has only a `title` attribute, no `aria-label`
- Filter pills pass no `aria-label` to indicate active state
- The CatchMeUpFab's sparkle icon button has only a `title`

**Why it's a problem:**  
- Screen readers announce icon buttons as "button" with no description
- `title` attributes are not reliably announced by all screen readers (WebAIM recommends `aria-label` instead)

**Proposed solution:**  
Audit all icon-only buttons and add `aria-label`:
```tsx
<button aria-label={`Set color to ${vibe.name}`}>...</button>
<button aria-label="Delete interaction">...</button>
<button aria-label="Generate AI briefing">...</button>
```

For toggle buttons, add `aria-pressed`:
```tsx
<button aria-pressed={isSelectMode} aria-label="Toggle multi-select mode">
```

**How it helps:**  
- Full screen reader support for all interactive elements
- Semantic state communication for toggles

**Priority:** 🟢 Medium  
**Effort:** S (2–3 hours)

---

### 4.3 — Keyboard Shortcut Collisions with Text Input

**What currently exists:**  
The contact list registers single-letter keyboard shortcuts:
- `n` → New contact
- `v` → Smart paste
- `/` → Focus search
- `j`/`k` → Navigate up/down

There's a guard that checks for active `INPUT`, `TEXTAREA`, or `contentEditable` elements (line 338–342). However:

**Why it's a problem:**  
- **Missing guard for `role="textbox"`:** Some Radix UI primitives use `div[role="textbox"]` instead of `<textarea>`. The guard doesn't catch these
- **Missing guard for `<select>`:** If the user is in a dropdown, pressing `n` would open the new contact modal instead of typing
- **No guard for `cmdk` input:** The Command Palette's input is a `cmdk` component that may not use standard `<input>` tags

**Proposed solution:**  
Create a shared `isTypingTarget()` utility:

```ts
export function isTypingTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable ||
    el.getAttribute('role') === 'textbox' ||
    el.getAttribute('role') === 'combobox' ||
    !!el.closest('[cmdk-input]')
  );
}
```

Replace all inline guards (in ContactList, DashboardView, DedupeView, SearchView) with this shared utility.

**How it helps:**  
- Eliminates accidental shortcut triggers in all editable contexts
- Single source of truth for the typing guard
- No more hunt-the-bug when a new input type is added

**Priority:** 🟡 High  
**Effort:** S (1–2 hours)

---

## Category 5: Visual Polish & Design System Compliance

### 5.1 — Map Popups Use Inline `style` Instead of Design System

**What currently exists:**  
`MapView.tsx` line 121–135 uses raw inline `style` objects for Leaflet popup content:
```tsx
style={{ fontFamily: 'Inter, sans-serif', padding: '4px 8px', cursor: 'pointer' }}
style={{ fontWeight: 800, fontSize: '14px', color: '#1a1a1a', margin: '0 0 2px' }}
style={{ fontSize: '12px', color: '#666', ... }}
style={{ fontSize: '11px', color: PRIMARY_COLOR, fontWeight: 600, ... }}
```

Hard-coded hex colors `#1a1a1a`, `#666` are used instead of surface tokens.

**Why it's a problem:**  
- These colors are off-palette (the design system uses `--color-on-surface: #2a3437` instead of `#1a1a1a`)
- If the brand colors change, popups won't update
- Inline styles can't leverage Tailwind's responsive/hover utilities

**Proposed solution:**  
Use CSS variables in the inline styles so they stay connected to the design system:
```tsx
style={{ 
  fontFamily: 'var(--font-body)', 
  color: 'var(--color-on-surface)',
  fontWeight: 800,
  fontSize: '14px',
}}
```

Or better, create a small CSS class in `index.css` for Leaflet popup styling:
```css
.leaflet-popup-content .contact-popup-name {
  font-weight: 800;
  font-size: 14px;
  color: var(--color-on-surface);
  font-family: var(--font-headline);
}
```

**How it helps:**  
- Popups use the same tokens as the rest of the app
- Theme changes propagate everywhere

**Priority:** ⚪ Low  
**Effort:** XS (< 1 hour)

---

### 5.2 — Inconsistent Button Styling: `bg-primary` vs `btn-primary` vs `signature-gradient`

**What currently exists:**  
There are 3+ distinct button styles used for primary CTAs:
1. **`.btn-primary`** — signature gradient, rounded-full (design system standard)
2. **`bg-primary text-on-primary`** — flat primary background (used in NewContactModal submit, ProfileHeader promote ghost button)  
3. **`signature-gradient text-white`** — inline gradient (used in SearchView)
4. **`bg-primary text-white`** — another flat variant (used in DossierTab "Save Dossier")

**Why it's a problem:**  
- Four visual variants for the same semantic concept ("primary action")
- Some use `text-on-primary`, others use `text-white` — these are the same value now but will diverge in dark mode
- Some use `rounded-full` (pill), others use `rounded-lg` (card-radius)

**Proposed solution:**  
Standardize all primary CTAs to use `.btn-primary` (the design system standard):
- Full-width submit buttons: `btn-primary w-full`
- Inline CTAs: `btn-primary`
- Compact CTAs: Add a `btn-primary-sm` variant:
  ```css
  .btn-primary-sm {
    @extend .btn-primary;
    padding: 0.375rem 1rem;
    font-size: 0.75rem;
  }
  ```

Create an audit script to find non-conforming buttons:
```bash
grep -rn "bg-primary text-" src/ --include="*.tsx" | grep -v "bg-primary/"
```

**How it helps:**  
- Consistent CTA appearance app-wide
- Dark-mode-ready through token usage
- Faster development — devs use one class, not guess

**Priority:** 🟡 High  
**Effort:** M (3–4 hours)

---

### 5.3 — Settings Card `border-b` Violates No-Line Rule

**What currently exists:**  
`SettingsView.tsx` line 136:
```tsx
className="flex items-center justify-between py-3 border-b border-surface-container-high"
```

This uses a 1px border between the "Temperature Unit" and "Recent Contacts" preference cards.

**Why it's a problem:**  
Direct violation of the No-Line Rule in the design system: *"1px solid borders are STRICTLY PROHIBITED for sectioning."*

**Proposed solution:**  
Replace with a spacing + background shift:
```tsx
{/* Temperature Unit */}
<div className="flex items-center justify-between py-3">...</div>

{/* Visual separator via spacing, not line */}
<div className="my-3" />

{/* Recent Contacts */}
<div className="flex items-center justify-between py-3">...</div>
```

Or use the existing `section-divider` class which uses a `bg` color shift instead of a border.

**How it helps:**  
- Compliance with the No-Line Rule
- Cleaner visual hierarchy through whitespace

**Priority:** 🟢 Medium  
**Effort:** XS (< 15 minutes)

---

### 5.4 — DossierTab Uses `border` for Attribute Cards and Timeline Actions

**What currently exists:**  
`DossierTab.tsx` line 88:
```tsx
className="... border border-surface-container-highest shadow-sm"
```

`TimelineTab.tsx` line 263:
```tsx
className="... border-t border-surface-container/50"
```

`DossierTab.tsx` line 190 (interests):
```tsx
className="... border border-primary/20" // AI-generated interests
className="... border border-transparent"  // user interests
```

**Why it's a problem:**  
- Multiple border violations of the No-Line Rule
- The AI interest `border` is used to visually differentiate AI-generated content — a valid semantic intent, but achieved through the wrong tool

**Proposed solution:**  
- Attribute cards: Remove `border`, keep `shadow-sm` (already provides depth)
- Timeline action items: Replace `border-t` with spacing (`pt-3 mt-3`) only
- AI interests: Replace `border border-primary/20` with `ring-1 ring-primary/20` (rings are allowed for selection/emphasis per the design system) OR use background differentiation (`bg-primary/10`)

**How it helps:**  
- Consistent application of the No-Line Rule
- Cleaner cards that rely on shadow and background for depth

**Priority:** 🟢 Medium  
**Effort:** S (1–2 hours)

---

## Category 6: Error Handling & Resilience

### 6.1 — Mentions JSON Parsing Uses Bare `try/catch` With Silent Failure

**What currently exists:**  
`TimelineTab.tsx` lines 189–237 parse the `mentions` field:
```tsx
{item.mentions && (() => {
  try {
    const parsed = JSON.parse(item.mentions);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    // ...render mentions...
  } catch { return null; }
})()}
```

**Why it's a problem:**  
- If `mentions` contains malformed JSON, the mentions section silently disappears with zero user feedback or error logging
- The inline IIFE pattern `(() => { ... })()` is difficult to read and creates a new closure on every render
- If this silent failure happens, there's no breadcrumb for debugging — the data exists in the DB but the UI shows nothing

**Proposed solution:**  
1. Extract into a named function:
```ts
function parseMentions(raw: string | null): ParsedMention[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn('[TimelineTab] Failed to parse mentions:', e);
    return [];
  }
}
```

2. Call it outside the JSX: `const mentions = parseMentions(item.mentions);`

3. Render conditionally: `{mentions.length > 0 && <MentionsList mentions={mentions} />}`

**How it helps:**  
- `console.warn` provides debugging breadcrumbs
- No inline IIFE = cleaner JSX
- Named function is self-documenting and reusable

**Priority:** 🟢 Medium  
**Effort:** XS (< 1 hour)

---

### 6.2 — No Global Error Boundary for Route-Level Crashes

**What currently exists:**  
The app has an `ErrorBoundary` wrapping the entire React tree in `main.tsx`. If a component throws during render, the entire app shows the fallback.

**Why it's a problem:**  
- A crash in the contact detail view takes down the entire app — including the sidebar and contact list
- There's no way to recover (navigate away) without a full page refresh
- The error boundary catches everything at the top level but individual routes aren't isolated

**Proposed solution:**  
Add route-level error boundaries in `App.tsx`:

```tsx
import { ErrorBoundary } from './components/layout/ErrorBoundary';

<Route path="/contact/:id" element={
  <ErrorBoundary>
    <ContactDetail />
  </ErrorBoundary>
} />

<Route path="/pulse" element={
  <ErrorBoundary>
    <DashboardView />
  </ErrorBoundary>
} />
```

The existing `ErrorBoundary` component already supports re-rendering on retry. Adding a "Go Home" button to the fallback UI would let users navigate away from a crashed route without a page refresh.

**How it helps:**  
- A crash in the detail view doesn't take down the sidebar or contact list
- Users can navigate to a working route without refreshing
- Errors are scoped to the failing feature area

**Priority:** 🟡 High  
**Effort:** S (1–2 hours)

---

### 6.3 — No User Feedback When `useCompanyLogo` Silently Returns `null`

**What currently exists:**  
`useCompanyLogo.ts` extracts the domain from a contact's primary email and builds a Clearbit logo URL. If the email is missing or the domain extraction fails, it returns `null`. The `ContactListItem` then falls back to a `<Building>` icon.

However, there's an `onError` handler on the `<img>` that sets `imgError = true` when Clearbit returns a 404. This triggers a re-render that switches to the Building icon.

**Why it's a problem:**  
- The `onError` approach means: first render shows a broken image placeholder → error fires → re-render shows Building icon. This creates a visible flash of broken image for domains without Clearbit logos
- For a list of 100 contacts, this could cause 50+ image error events and re-renders on mount

**Proposed solution:**  
Two-pronged fix:
1. **Preemptive guard:** Add common non-company email domains to a blocklist in `useCompanyLogo`:
```ts
const BLOCKLIST = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com', 'protonmail.com']);
if (BLOCKLIST.has(domain)) return null;
```

2. **CSS fallback:** Use the `object-fit: scale-down` trick with a transparent background so the broken image state is visually identical to the fallback:
```tsx
<img 
  src={logoUrl} 
  className="... bg-transparent" 
  style={{ objectFit: 'scale-down' }}
  onError={() => setImgError(true)} 
/>
```

**How it helps:**  
- Eliminates ~80% of useless Clearbit requests (most personal emails)
- No visible flash of broken image content
- Fewer DOM re-renders on list mount

**Priority:** 🟢 Medium  
**Effort:** XS (< 1 hour)

---

## Category 7: Developer Experience

### 7.1 — No Storybook or Component Preview System

**What currently exists:**  
The app has no component catalog or preview system. To see how a component looks, developers must:
1. Run the full dev server
2. Navigate to a route that uses the component
3. Create the right data conditions (e.g., to see the "All Clean" dedupe state, they must scan and dismiss all suggestions)

**Why it's a problem:**  
- Testing visual states (loading, error, empty, overflowing text) requires manual data manipulation
- Design review requires running the full app
- New developers can't browse available components

**Proposed solution:**  
Add a `/dev` route (dev-only) that renders each component in its various states:

```tsx
// Only included in development builds
if (import.meta.env.DEV) {
  routes.push(
    <Route path="/dev" element={<ComponentShowcase />} />
  );
}
```

The showcase would render key components (MetricCard, EmptyState, Modal, FilterPill, etc.) with mock data in all their states.

Alternatively, integrate Storybook for a more comprehensive solution.

**How it helps:**  
- Visual regression testing without full app context
- Faster design iteration
- Onboarding resource for new developers

**Priority:** ⚪ Low  
**Effort:** L (1–2 days for Storybook, M for custom showcase)

---

## Implementation Roadmap

### Phase 1: Quick Wins (1 day)
| # | Item | Effort | Priority |
|---|---|---|---|
| 2.3 | Replace `confirm()` with Modal | XS | 🔴 |
| 2.4 | About section click-to-expand | XS | 🟡 |
| 2.5 | Urgency banner no-line fix | XS | 🟢 |
| 2.6 | AI summary no-line fix | XS | 🟢 |
| 5.3 | Settings border-b fix | XS | 🟢 |
| 1.4 | Dropdown dark-to-light fix | XS | 🟢 |
| 6.1 | Mentions JSON parsing | XS | 🟢 |
| 6.3 | Company logo blocklist | XS | 🟢 |

### Phase 2: Core Quality (2–3 days)
| # | Item | Effort | Priority |
|---|---|---|---|
| 2.1 | Contact list loading skeleton | S | 🟡 |
| 2.2 | New Contact form inputs | S | 🟡 |
| 1.2 | useClickOutside hook | S | 🟢 |
| 4.3 | Keyboard shortcut guards | S | 🟡 |
| 5.2 | Button styling standardization | M | 🟡 |
| 6.2 | Route-level error boundaries | S | 🟡 |
| 5.4 | Dossier/timeline no-line fix | S | 🟢 |

### Phase 3: Architecture (3–5 days)
| # | Item | Effort | Priority |
|---|---|---|---|
| 1.1 | ContactList decomposition | L | 🟡 |
| 1.3 | Remove `as any` assertions | M | 🟡 |
| 3.1 | List virtualization | M | 🟡 |
| 3.2 | Timeline animation fix | S | 🟢 |
| 3.3 | useContacts select projections | S | 🟢 |

### Phase 4: Polish & Accessibility (2–3 days)
| # | Item | Effort | Priority |
|---|---|---|---|
| 4.1 | Modal focus trapping | S | 🟡 |
| 4.2 | aria-label audit | S | 🟢 |
| 5.1 | Map popup design system | XS | ⚪ |
| 7.1 | Component showcase / Storybook | L | ⚪ |

---

## Appendix: Files by Improvement Density

| File | Lines | Issues Found | Top Issue |
|---|---|---|---|
| `ContactList.tsx` | 991 | 5 | God component (#1.1) |
| `ProfileHeader.tsx` | 274 | 3 | No-line violations (#2.5, #2.6) |
| `DetailsCard.tsx` | 230 | 2 | `as any` casts (#1.3) |
| `TimelineTab.tsx` | 306 | 3 | Animation perf (#3.2), mentions parsing (#6.1) |
| `DossierTab.tsx` | 168 | 2 | Hover-to-expand (#2.4), borders (#5.4) |
| `SearchView.tsx` | 412 | 1 | Button inconsistency (#5.2) |
| `Modal.tsx` | 94 | 1 | No focus trap (#4.1) |
| `styles.ts` | 189 | 1 | Dark dropdown (#1.4) |
| `SettingsView.tsx` | 247 | 1 | border-b (#5.3) |
| `MapView.tsx` | 144 | 1 | Inline styles (#5.1) |
| `ContactProfile.tsx` | 241 | 1 | `confirm()` (#2.3) |
| `ContactListItem.tsx` | 198 | 1 | Logo flash (#6.3) |
