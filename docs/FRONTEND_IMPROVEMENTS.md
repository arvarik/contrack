# Contrack Frontend Improvement Spec

**Version:** 3.0  
**Author:** Principal Frontend Engineering Review  
**Date:** April 9, 2026  
**Scope:** All files under `/src` — **113 files, ~17,200 LOC**  

---

## V2 → V3 Changelog

> [!NOTE]
> **V2** was written on April 9, 2026 against a ~16,300 LOC / 111-file codebase.  
> **V3** is a full re-audit against the current **~17,200 LOC / 113-file** codebase after continued feature work (Cluster-Based Dedupe, AI Search refinements, InteractionDetailModal, sort controls).

### Updated Items

| # | Item | What Changed |
|---|---|---|
| 1.3 | `as any` Type Assertions | Occurrence count updated from 23 → **19 confirmed `as any` casts**. V2 over-counted by including some that were `(item: any)` parameter types rather than `as any` casts. Separately, **75 loose `: any` parameter/variable types** were identified and tracked as new item 7.2. |
| 3.2 | Timeline `motion.div` | Updated: TimelineTab now has **4 `motion.div`** wrappers (outer container + drag overlay + per-entry + wrapper), confirmed still present. |
| 5.2 | Button Inconsistency | Updated: **10 files** use `btn-primary` correctly, and **10 files** use non-standard `bg-primary text-on-primary` pattern. Total non-standard instances updated to **16** (2 more discovered in `InteractionDetailModal.tsx` and `ErrorBoundary.tsx`). |
| 5.5 | Dashboard modal borders | Added `DashboardSkeleton.tsx` (3 more border violations) and `ActionItemSwimlane.tsx` (1 border + dark `border-white/5` violation). |
| 6.4 | DedupeView God Component | Updated line count from 673 → **702** lines (grew 29 lines since V2). |
| All | Line counts & file sizes | All file references updated to exact current line counts. |

### New Items Added in V3

| # | Item | Category | Priority |
|---|---|---|---|
| 5.9 | `CatchMeUpFab` has 4 border violations in custom modal | Visual Polish | 🟢 Medium |
| 5.10 | `InteractionDetailModal` has 5 border violations, bypasses `<Modal>` | Visual Polish | 🟡 High |
| 5.11 | `ContactDetail` close button has border | Visual Polish | ⚪ Low |
| 7.2 | 75 loose `: any` parameter/variable types across codebase | Architecture | 🟡 High |
| 7.3 | 6 one-off portal modals bypass the `<Modal>` component | Architecture | 🟡 High |
| 8.1 | `InteractionDetailModal` uses `dangerouslySetInnerHTML` without DOMPurify | Security | 🔴 Critical |
| 8.2 | Ghost mention button uses inline `style` for dashed border | Visual Polish | ⚪ Low |

### Resolved Items (from V2)

| V2 # | Item | Status |
|---|---|---|
| — | (none resolved since V2) | All V2 items remain open |

### V1 → V2 Changelog (Preserved)

<details>
<summary>Click to expand V1 → V2 changelog</summary>

#### Updated Items (V1 → V2)

| # | Item | What Changed |
|---|---|---|
| 1.1 | ContactList God Component | Line count updated from 991 → 1,063. |
| 1.3 | `as any` Type Assertions | Occurrence count expanded. Added newly discovered files. |
| 1.4 | Dark Dropdown Menu | Confirmed still present at `styles.ts:185-188`. |
| 3.2 | Timeline `motion.div` | Confirmed still present. |
| 5.2 | Button Inconsistency | Expanded from 4 to 14 confirmed instances. |
| 6.2 | Route-Level Error Boundaries | Updated to account for new routes. |
| 6.3 | Company Logo Hook | V1's "add blocklist" suggestion is now **DONE**. |

#### New Items Added in V2

| # | Item | Category | Priority |
|---|---|---|---|
| 2.7 | Toaster uses `theme="dark"` in light-only app | UX & Interaction | 🟡 High |
| 5.5 | Dashboard modals use raw `border` container patterns | Visual Polish | 🟢 Medium |
| 5.6 | `DailyInsightCard` has `border border-primary/10` | Visual Polish | 🟢 Medium |
| 5.7 | `RichInteractionComposer` has 3 border violations | Visual Polish | 🟢 Medium |
| 5.8 | `LinkPreviewExtension` has hard-coded border styling | Visual Polish | ⚪ Low |
| 6.4 | `DedupeView.tsx` is a 673-line emerging God Component | Architecture | 🟡 High |
| 6.5 | `App.tsx` Toaster border violates No-Line Rule | Visual Polish | 🟢 Medium |

#### Removed / Resolved Items (V1 → V2)

| V1 # | Item | Status |
|---|---|---|
| 6.3 (partial) | Company logo blocklist | ✅ **DONE** — blocklist implemented with 13 domains |

</details>

---

## Executive Summary

Contrack CRM has a strong design system foundation (Manrope + Inter typography, paper-stack surface hierarchy, no-line rule, signature gradient CTAs) and solid engineering patterns (TanStack Query, FSD-inspired structure, React.memo with structural comparators, CSS-based animations over Framer Motion where performance matters).

This document identifies **35 improvement items** across 8 categories, ranging from quick wins to larger refactors. Each item is written as a spec an engineer can directly implement from.

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

### 1.1 — ContactList.tsx is a 1,063-line God Component

**What currently exists:**  
`ContactList.tsx` is the single largest file in the codebase at **1,063 lines**. It manages: search state, URL-persisted filters + sort, multi-select mode, bulk actions (delete, archive, add-to-list, color change, CSV export, bulk field edit), context menus, drag-to-reorder lists, keyboard navigation, scroll restoration, pull-to-refresh, "recent contacts" strip, modal state for 5+ modals (new contact, smart paste, import, create list, bulk edit, bulk delete confirm, add-to-list picker), and the entire JSX render tree for all of these.

**Why it's a problem:**  
- **Cognitive load:** Developers must hold 1,063 lines of context to make any change
- **Re-render blast radius:** Any state change triggers a re-render of the entire tree including all modal JSX
- **Testing difficulty:** Untestable in isolation — can't test bulk actions without loading the filter system and keyboard handlers
- **5+ `useEffect` hooks** with different concerns (outside-click, keyboard, scroll) interleaved with business logic

**Proposed solution:**  
Extract into a composable hierarchy:

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
    useContactListFilters.ts   ← URL-persisted filter + search + sort state
    useContactListKeyboard.ts  ← Keyboard navigation handler
    useBulkActions.ts          ← Multi-select state + all bulk mutation handlers
    useListDragReorder.ts      ← Drag-to-reorder state machine
```

**Priority:** 🟡 High  
**Effort:** L (1–2 days)

---

### 1.2 — Inconsistent `useEffect` Patterns for Outside-Click Dismiss

**What currently exists:**  
`ContactList.tsx` has two nearly identical `useEffect` blocks (lines 379, 388) that register global `mousedown` listeners for closing dropdown menus on outside click.

**Why it's a problem:**  
- Copy-paste code — one bug fix must be applied N times
- Raw `addEventListener` is easy to leak if cleanup isn't perfect
- No accessibility handling (Escape key, focus trapping)

**Proposed solution:**  
Create a `useClickOutside(ref, callback, enabled)` hook in `src/hooks/`:

```ts
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

**Priority:** 🟢 Medium  
**Effort:** S (1–2 hours)

---

### 1.3 — Inline `as any` Type Assertions Throughout (19 Confirmed)

**What currently exists:**  
**19 confirmed `as any` casts** across 8 files:

| File | Count | Example |
|---|---|---|
| `DetailsCard.tsx` | 5 | `{ interests: updated } as any`, `{ addresses: ... } as any`, emails, phones |
| `importers.ts` | 5 | Contact creation payloads in CSV/LinkedIn/Apple importers |
| `ContactList.tsx` | 4 | `{ isArchived: true } as any`, `{ themeColor: vibeId } as any`, bulk field edit |
| `AISearchView.tsx` | 2 | `(c as any).socialLinkCount` property access |
| `MergePreview.tsx` | 2 | `{ ...e, _from: dup.name } as any` |
| `ListManagerView.tsx` | 2 | `(list as any).memberCount` |
| `ArchivedContactsView.tsx` | 1 | `{ isArchived: false } as any` on bulk restore |
| `DossierTab.tsx` | 1 | `{ aiBackground: dossierText } as any` |

> [!NOTE]
> V2 reported 23, which over-counted by including `(item: any)` parameter-type annotations. Those are tracked separately in item 7.2.

**Proposed solution:**  
1. Create a comprehensive `ContactUpdatePayload` type in `src/types.ts`
2. Widen the update contact mutation's `data` parameter to accept `ContactUpdatePayload`
3. Add `memberCount` to the `ContactList` type to fix `ListManagerView`
4. Add `socialLinkCount` to the `Contact` type for `AISearchView`
5. Remove all `as any` casts

**Priority:** 🟡 High  
**Effort:** M (3–5 hours)

---

### 1.4 — Dropdown Menu System Uses Dark Theme, Inconsistent with App

**What currently exists:**  
In `styles.ts` lines 185–188:
```ts
export const DROPDOWN_MENU = "... bg-[#242424] ... ring-1 ring-white/10 ...";
export const DROPDOWN_ITEM = "... text-gray-200 hover:bg-primary/20 ...";
```

Hard-coded dark-mode dropdown in an app with no dark mode. Only place using raw hex `#242424` and `gray-200`.

**Proposed solution:**  
Replace with glassmorphism tokens (already used by modals):
```ts
export const DROPDOWN_MENU = 
  "absolute z-50 mt-1 max-h-56 w-max min-w-full overflow-y-auto rounded-xl " +
  "glass-panel py-1.5 shadow-xl outline-none scrollbar-hide";

export const DROPDOWN_ITEM = 
  "cursor-pointer px-4 py-2 text-sm font-medium text-on-surface " +
  "hover:bg-primary/10 hover:text-primary transition-colors flex items-center";
```

**Priority:** 🟢 Medium  
**Effort:** XS (< 1 hour)

---

## Category 2: UX & Interaction Design

### 2.1 — No Loading Skeleton for Contact List

**What currently exists:**  
When the contact list is loading, the feedback is a single pulsing 24px circle. The Dashboard already has a bespoke `DashboardSkeleton` component (67 lines), but the main contact list — the most-visited view — does not.

**Proposed solution:**  
Create a `ContactListSkeleton` that renders 8–12 shimmer rows matching `ContactListItem`'s exact layout (avatar circle + two text lines), applying staggered `animationDelay` per row.

**Priority:** 🟡 High  
**Effort:** S (1–2 hours)

---

### 2.2 — "New Contact" Modal Form Uses Raw HTML Inputs, Not Design System

**What currently exists:**  
The "New Contact" form modal (ContactList.tsx lines ~900–980) uses inline 150+ character className strings copy-pasted across 6 input fields. None use the `.input` CSS class or design system tokens. AI-highlighted fields use `animate-pulse` on the entire input, making text hard to read.

**Proposed solution:**  
1. Create a `FormInput` component wrapping the `.input` CSS class
2. Replace AI-highlight with a subtle ring glow (`ring-2 ring-primary/50 bg-primary/5`)
3. Extract the entire modal into `NewContactModal.tsx` (aligns with item 1.1)

**Priority:** 🟡 High  
**Effort:** S (2–3 hours)

---

### 2.3 — `confirm()` Used for Destructive Actions Instead of Custom Modal

**What currently exists:**  
`ContactProfile.tsx` line 117 uses `window.confirm()`:
```ts
if (!confirm(`Permanently delete ${contact.name}? This cannot be undone.`)) return;
```

This is the **only** place in the entire app using the native dialog. Every other destructive action (bulk delete, archived delete) uses the styled `<Modal>` component.

**Proposed solution:**  
Replace with a `ConfirmDeleteModal` using the existing `<Modal>` component.

**Priority:** 🔴 Critical  
**Effort:** XS (< 1 hour)

---

### 2.4 — About Section "Hover to Expand" Pattern is Not Mobile-Friendly

**What currently exists:**  
`DossierTab.tsx` lines 101–104 use CSS `:hover` to expand truncated text:
```tsx
className="... max-h-32 overflow-hidden ... hover:max-h-full hover:after:opacity-0 transition-all"
```
And displays: `"Hover to expand"` (line 104).

**Why it's a problem:**  
Mobile devices do not have hover. Touch users have no way to discover or use this interaction.

**Proposed solution:**  
Replace with a click-to-expand `Show more` / `Show less` toggle (standard pattern used by LinkedIn, Twitter).

**Priority:** 🟡 High  
**Effort:** XS (< 1 hour)

---

### 2.5 — Urgency Banner Violates the "No-Line Rule"

**What currently exists:**  
`ProfileHeader.tsx` line 183:
```tsx
className="w-full bg-error/10 border-b border-error/20 px-6 py-3 ..."
```

**Proposed solution:**  
Remove `border-b border-error/20`, use stronger background tint or `shadow-sm` for depth.

**Priority:** 🟢 Medium  
**Effort:** XS (< 30 minutes)

---

### 2.6 — AI Summary Border Also Violates the No-Line Rule

**What currently exists:**  
`ProfileHeader.tsx` line 297:
```tsx
className="... bg-primary/10 rounded-xl p-3 mb-3 border border-primary/20 max-w-fit"
```

**Proposed solution:**  
Remove `border border-primary/20`. The `bg-primary/10` already provides visual distinction.

**Priority:** 🟢 Medium  
**Effort:** XS (< 15 minutes)

---

### 2.7 — Toaster Uses `theme="dark"` in a Light-Only App

**What currently exists:**  
`App.tsx` line 176–180:
```tsx
<Toaster theme="dark" position="bottom-right" className="font-body" toastOptions={{
  style: {
    background: 'var(--color-surface-container-high)',
    border: '1px solid var(--color-surface-container-highest)',
    color: 'var(--color-on-surface)'
  }
}} />
```

**Why it's a problem:**  
- `theme="dark"` conflicts with the exclusively light-themed app
- The `border: '1px solid ...'` violates the No-Line Rule
- Hard-coded inline CSS overrides fight the library's internal theming

**Proposed solution:**  
```tsx
<Toaster theme="light" position="bottom-right" className="font-body" toastOptions={{
  className: 'glass-panel shadow-lg !border-none',
  style: { color: 'var(--color-on-surface)' }
}} />
```

**Priority:** 🟡 High  
**Effort:** XS (< 30 minutes)

---

## Category 3: Performance & Rendering

### 3.1 — Contact List Does Not Virtualize Long Lists

**What currently exists:**  
The contact list renders all contacts as DOM elements. For 500+ contacts, this creates 500+ DOM nodes even if only ~15 are visible.

**Proposed solution:**  
Integrate `@tanstack/react-virtual`:
```tsx
const virtualizer = useVirtualizer({
  count: filteredContacts.length,
  getScrollElement: () => scrollRef.current,
  estimateSize: () => 64,
  overscan: 8,
});
```

**Considerations:**  
- Pull-to-refresh and scroll restoration need virtualizer integration
- "Recent contacts" strip stays outside the virtualizer as a fixed header
- Keyboard navigation (ArrowUp/Down) calls `virtualizer.scrollToIndex()`

**Priority:** 🟡 High  
**Effort:** M (4–6 hours)

---

### 3.2 — Timeline Entries Each Have `motion.div` with `initial/animate`

**What currently exists:**  
`TimelineTab.tsx` has **4 `motion.div` wrappers** — the outer container (line 95) and each timeline entry (line 132):
```tsx
<motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
```

Every entry re-animates on data update, not just on initial mount.

**Why it's a problem:**  
- Adding a new interaction causes all existing entries to re-animate
- Each `motion.div` creates a separate animation instance with its own RAF loop
- Already fixed in `SearchView.tsx` using CSS-based animations, but not applied here

**Proposed solution:**  
Apply the same CSS-based animation strategy as `SearchView.tsx` (`.result-card-enter` class with staggered `animationDelay`), or remove entrance animations entirely.

**Priority:** 🟢 Medium  
**Effort:** S (1–2 hours)

---

### 3.3 — `useContacts()` Called in 5 Components Without Selector

**What currently exists:**  
`useContacts()` returns the full `Contact[]` array in:
- `ContactList.tsx` (primary consumer)
- `RichInteractionComposer.tsx` (only needs names for mentions)
- `CommandPalette.tsx` (only needs names + IDs)
- `AISearchView.tsx` (needs contacts for selection)
- `ContactPicker.tsx` in dedupe (needs names + IDs)

**Proposed solution:**  
Use TanStack Query's `select` for minimal projections:
```ts
export const useContactNames = () => useContacts({ 
  select: (contacts) => contacts.map(c => ({ id: c.id, name: c.name }))
});
```

**Priority:** 🟢 Medium  
**Effort:** S (2–3 hours)

---

## Category 4: Accessibility

### 4.1 — Modal Does Not Trap Focus (Tab Key Escapes)

**What currently exists:**  
`Modal.tsx` (93 lines) explicitly notes in its docstring (line 7):
```
Traps Escape to close (does not trap full Tab focus — acceptable for this app)
```

Tab key allows focus to escape behind the backdrop.

**Proposed solution:**  
Add `focus-trap-react` or implement a manual Tab-cycling trap.

**Priority:** 🟡 High  
**Effort:** S (1–2 hours)

---

### 4.2 — Interactive Elements Missing `aria-label` / Accessible Names

**What currently exists:**  
The codebase has **20 `aria-label` instances** — most concentrated in the newer dedupe cluster components (`ClusterSwipeCard.tsx`, `ClusterList.tsx`) which were added with proper accessibility. But older components still have gaps:
- `VibePickerPopover.tsx` color dots — no `aria-label`
- Timeline delete buttons — only `title`, no `aria-label`
- `CatchMeUpFab.tsx` — only `title="Catch Me Up"`, no `aria-label`
- Filter pills in `ContactList.tsx` — no `aria-label` on active state
- `DossierTab.tsx` edit button — no `aria-label`

**Proposed solution:**  
Audit all icon-only buttons and add `aria-label`. For toggles, add `aria-pressed`.

**Priority:** 🟢 Medium  
**Effort:** S (2–3 hours)

---

### 4.3 — Keyboard Shortcut Collisions with Text Input

**What currently exists:**  
**5 separate implementations** of the same keyboard input guard, with inconsistent coverage:

| File | Guard Checks |
|---|---|
| `App.tsx` (lines 154–156) | `INPUT`, `TEXTAREA`, `isContentEditable` |
| `ContactList.tsx` (lines 396–398) | `INPUT`, `TEXTAREA`, `isContentEditable` |
| `DashboardView.tsx` (line 113) | `INPUT`, `TEXTAREA` only ❌ |
| `SearchView.tsx` (lines 193–194) | `INPUT`, `TEXTAREA` only ❌ |
| `DedupeView.tsx` (line 119) | `INPUT`, `TEXTAREA` only ❌ |

3 out of 5 are missing `isContentEditable`, and none check for `role="textbox"`, `role="combobox"`, or `<select>`.

**Proposed solution:**  
Create a shared `isTypingTarget()` utility:
```ts
export function isTypingTarget(e: KeyboardEvent): boolean {
  const el = (document.activeElement || e.target) as HTMLElement;
  return (
    el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' ||
    el.isContentEditable || el.getAttribute('role') === 'textbox' ||
    el.getAttribute('role') === 'combobox' || !!el.closest('[cmdk-input]')
  );
}
```

Replace all 5 inline guards with this shared utility.

**Priority:** 🟡 High  
**Effort:** S (1–2 hours)

---

## Category 5: Visual Polish & Design System Compliance

> [!IMPORTANT]
> The codebase has **46 border-pattern matches** across 18 `.tsx` files. While some are legitimate exceptions per the design system (focus rings, selection rings, timeline decorative line, drag-and-drop overlays), the majority are No-Line Rule violations.

### 5.1 — Map Popups Use Inline `style` Instead of Design System

**What currently exists:**  
`MapView.tsx` lines 121–135 uses raw inline styles with hard-coded hex colors (`#1a1a1a`, `#666`) instead of design system tokens.

**Proposed solution:**  
Use CSS variables: `color: 'var(--color-on-surface)'`, or create `.leaflet-popup-content` CSS classes.

**Priority:** ⚪ Low  
**Effort:** XS (< 1 hour)

---

### 5.2 — Inconsistent Button Styling (16 Non-Standard Instances)

**What currently exists:**  
**10 files** correctly use `.btn-primary`. **10 files** use non-standard `bg-primary text-on-primary` patterns (**16 confirmed instances**):

| File | Pattern | Issue |
|---|---|---|
| `ContactList.tsx` (×2) | `bg-primary text-on-primary rounded-lg` | Wrong radius, no gradient |
| `CreateListModal.tsx` | `bg-primary text-on-primary rounded-lg` | ❌ |
| `ProfileHeader.tsx` | `bg-primary text-white rounded-xl` | Uses `text-white` not token |
| `DossierTab.tsx` | `bg-primary text-on-primary rounded-full` | Missing gradient |
| `AvatarPickerModal.tsx` (×2) | `bg-primary text-on-primary rounded-xl` | ❌ |
| `BulkEditFieldModal.tsx` | `bg-primary text-on-primary rounded-xl` | ❌ |
| `ListDetailPanel.tsx` | `bg-primary text-on-primary rounded-xl` | ❌ |
| `ListManagerView.tsx` | `bg-primary text-on-primary rounded-xl` | ❌ |
| `InteractionDetailModal.tsx` | `bg-primary text-white rounded-xl` | ❌ |
| `ErrorBoundary.tsx` | `signature-gradient text-on-primary rounded-xl` | Partial — no `btn-primary` |
| Dedupe: `SuggestionList`, `ManualMerge`, `ClusterList` (×4) | `bg-primary text-white` | For toggle states — separate concern |

**Proposed solution:**  
Standardize all primary CTAs to `.btn-primary`. Add `.btn-primary-sm` for compact variants.

**Priority:** 🟡 High  
**Effort:** M (3–4 hours)

---

### 5.3 — Settings Card `border-b` Violates No-Line Rule

**What currently exists:**  
`SettingsView.tsx` line 136: `border-b border-surface-container-high`.

**Proposed solution:**  
Replace with spacing only.

**Priority:** 🟢 Medium  
**Effort:** XS (< 15 minutes)

---

### 5.4 — DossierTab and TimelineTab Use `border` for Visual Structure

**What currently exists:**  
- `DossierTab.tsx` line 88: `border border-surface-container-highest shadow-sm` on attribute cards
- `DossierTab.tsx` line 49: `border border-surface-container-highest` on edit button
- `DossierTab.tsx` line 59: `border border-surface-container-highest` on textarea
- `DossierTab.tsx` line 191: `border border-primary/20` on AI interest pills
- `TimelineTab.tsx` line 170: `border border-surface-container-highest/20` on filter pill
- `TimelineTab.tsx` line 263: `border-t border-surface-container/50` on action items section

**Proposed solution:**  
- Attribute cards / edit button: Remove `border`, keep `shadow-sm`
- Textarea: Replace `border` with `focus:ring-2` (focus rings are allowed)
- AI interests: Use `ring-1 ring-primary/20` or `bg-primary/10`
- Filter pill: Remove `border`, use `shadow-sm`
- Action items: Replace `border-t` with spacing

**Priority:** 🟢 Medium  
**Effort:** S (1–2 hours)

---

### 5.5 — Dashboard Components Use Raw `border` Patterns (8 Violations)

**What currently exists:**  

| File | Line(s) | Violation |
|---|---|---|
| `NetworkCompositionModal.tsx` | 89, 92 | `border border-surface-container`, `border-b border-surface-container` |
| `InteractionVelocityModal.tsx` | 45, 48, 111 | `border border-surface-container`, `border-b`, `border-t` |
| `NetworkGrowthModal.tsx` | 40, 43 | `border border-surface-container`, `border-b` |
| `DashboardSkeleton.tsx` | 21, 31, 44 | `border border-surface-container`, `border border-primary/20`, `border border-surface-container` |
| `ActionItemSwimlane.tsx` | 38 | `border-b border-white/5` (dark-theme color in light app!) |

**Proposed solution:**  
- Modal containers: Remove `border`, rely on `shadow-2xl`
- Modal headers: Replace `border-b` with `bg-surface-container-low`
- Skeleton cards: Remove `border`, keep `shadow-sm`
- Swimlane snooze header: Replace `border-b border-white/5` with `bg-surface-container-low` background shift

**Priority:** 🟢 Medium  
**Effort:** S (1–2 hours)

---

### 5.6 — `DailyInsightCard` Has Unnecessary `border border-primary/10`

**What currently exists:**  
`DailyInsightCard.tsx` line 20:
```tsx
className={cn(CARD_TINTED, "col-span-full group border border-primary/10")}
```

`CARD_TINTED` already provides visual distinction via `bg-primary/5 shadow-sm`. The added border is redundant.

**Proposed solution:**  
Remove `border border-primary/10`.

**Priority:** 🟢 Medium  
**Effort:** XS (< 5 minutes)

---

### 5.7 — `RichInteractionComposer` Has 4 Border Violations

**What currently exists:**  
`RichInteractionComposer.tsx` (184 lines):
- Line 134: `border border-surface-container-highest/20` on outer container
- Line 142: `border border-surface-container ... hover:border-primary/30 focus-within:border-primary/50` on inner input
- Line 160: `border-t border-surface-container` on footer toolbar
- Line 161: `border border-surface-container/30` on type-picker pill group

**Proposed solution:**  
- Outer container: Replace `border` with `shadow-sm`
- Inner input: Use `focus-within:ring-2 focus-within:ring-primary/20` (rings allowed)
- Footer: Replace `border-t` with background shift
- Type picker: Replace `border` with `shadow-sm`

**Priority:** 🟢 Medium  
**Effort:** S (1 hour)

---

### 5.8 — `LinkPreviewExtension` Has Hard-Coded Border Styling

**What currently exists:**  
`LinkPreviewExtension.tsx` lines 38, 41, 45, 99, 101: Card and image separators using `border border-surface-container-highest` and `sm:border-r`.

**Proposed solution:**  
Replace border with `shadow-sm`. Replace image separator with padding.

**Priority:** ⚪ Low  
**Effort:** S (1 hour)

---

### 5.9 — `CatchMeUpFab` Has 4 Border Violations in Custom Modal *(NEW in V3)*

**What currently exists:**  
`CatchMeUpFab.tsx` (112 lines):
- Line 61: `border border-surface-container` on modal container
- Line 92: `border-t border-surface-container` on footer separator
- Line 98: `border border-primary/20 hover:border-primary/40` on "Regenerate" button

**Why it's a problem:**  
The "Catch Me Up" briefing modal is a high-visibility feature — it's the AI-powered executive summary. It should exemplify the design system, not violate it.

**Proposed solution:**  
- Modal container: Remove `border`, keep `shadow-2xl`
- Footer: Replace `border-t` with `bg-surface-container-low` background shift
- Regenerate button: Use `bg-primary/10 hover:bg-primary/20` instead of border

**Priority:** 🟢 Medium  
**Effort:** XS (< 30 minutes)

---

### 5.10 — `InteractionDetailModal` Has 5 Border Violations, Bypasses `<Modal>` *(NEW in V3)*

**What currently exists:**  
`InteractionDetailModal.tsx` (199 lines):
- Line 62: `border border-surface-container` on modal container
- Line 65: `border-b border-surface-container` on header
- Line 75: `border border-primary/50` on title edit input
- Line 124: `border border-primary/50` on content edit textarea
- Line 154–155: `border` on action item cards (2 instances — completed vs active)
- Line 161: `border` on checkbox element

**Why it's a problem:**  
This is one of the highest-interaction modals in the app (users view/edit interaction details frequently). It also builds its own portal + backdrop + animation from scratch instead of using the shared `<Modal>` component, leading to inconsistent behavior.

**Proposed solution:**  
1. Modernize to use the shared `<Modal>` component for consistent animation, Escape handling, and focus management
2. Remove all sectioning borders; use background shifts for structure
3. For the edit inputs: `border` → `ring-2 ring-primary/30` (focus rings are allowed)
4. For action item cards: `border` → `shadow-sm` and background shift for completed state

**Priority:** 🟡 High  
**Effort:** S (2–3 hours)

---

### 5.11 — `ContactDetail` Close Button Has Border *(NEW in V3)*

**What currently exists:**  
`ContactDetail.tsx` line 23:
```tsx
className="... shadow-sm border border-surface-container-highest transition-colors"
```

**Proposed solution:**  
Remove `border border-surface-container-highest`, keep `shadow-sm`.

**Priority:** ⚪ Low  
**Effort:** XS (< 5 minutes)

---

## Category 6: Error Handling & Resilience

### 6.1 — Mentions JSON Parsing Uses Bare `try/catch` With Silent Failure

**What currently exists:**  
`TimelineTab.tsx` lines 189–237 parse mentions with an inline IIFE and bare `try/catch { return null; }` with no logging.

**Proposed solution:**  
Extract into a named `parseMentions()` function with `console.warn` on failure, called outside JSX.

**Priority:** 🟢 Medium  
**Effort:** XS (< 1 hour)

---

### 6.2 — No Route-Level Error Boundaries

**What currently exists:**  
Single `ErrorBoundary` wrapping the entire React tree in `main.tsx` (line 41). A crash in any route takes down the entire app including sidebar and contact list.

The app now has **7 distinct route groups** (`/`, `/contact/:id`, `/pulse`, `/search`, `/map`, `/settings/*`, `/dedupe`).

**Proposed solution:**  
Add route-level `<ErrorBoundary>` wrappers in `App.tsx` per route. Add a "Go Home" navigation button to the error fallback.

**Priority:** 🟡 High  
**Effort:** S (1–2 hours)

---

### 6.3 — Company Logo `onError` Flash

**What currently exists:**  
The `GENERIC_DOMAINS` blocklist is **already implemented** (13 domains). However, `ContactListItem.tsx` still uses the `onError`→re-render pattern which creates a visible flash for domains without favicons.

**Proposed solution:**  
Add `decoding="async"` and CSS `object-fit: scale-down` with transparent background so the broken-image state is visually identical to the Building icon fallback.

**Priority:** 🟢 Medium  
**Effort:** XS (< 1 hour)

---

### 6.4 — `DedupeView.tsx` is a 702-Line Emerging God Component

**What currently exists:**  
`DedupeView.tsx` at **702 lines** is the second-largest component file (up from 673 in V2). It manages tab state, result views, scan modes, current suggestion index, dismissed/merged sets, undo history, keyboard shortcuts, and multiple UI phases. The `PhaseRow` sub-component is defined inline at lines 660–701.

**Why it's a problem:**  
Already at 702 lines and growing — same trajectory as `ContactList.tsx`. Keyboard shortcut registration is duplicated with the same pattern as 4 other views.

**Proposed solution:**  
Extract into:
```
dedupe/
  DedupeView.tsx           ← ~150 lines: tab switcher, shared context
  AutoScanTab.tsx          ← Pre-scan UI, scanning progress, results routing
  components/
    PhaseRow.tsx           ← Extract inline component (lines 660–701)
    ScanModeSelector.tsx   ← Extract from inline JSX
    ScanProgressCard.tsx   ← Extract scanning phase UI
  hooks/
    useSwipeReview.ts      ← currentIndex, dismissed, merged, undo, navigation
```

**Priority:** 🟡 High  
**Effort:** M (4–6 hours)

---

### 6.5 — `App.tsx` Toaster Border Violates No-Line Rule

**What currently exists:**  
`App.tsx` line 179: `border: '1px solid var(--color-surface-container-highest)'` — a `1px solid border` on the most frequently seen UI element.

**Proposed solution:**  
Addressed together with item 2.7.

**Priority:** 🟢 Medium  
**Effort:** XS (combined with 2.7)

---

## Category 7: Developer Experience & Code Quality

### 7.1 — No Storybook or Component Preview System

**What currently exists:**  
No component catalog. To see a component, developers must run the full dev server, navigate, and create specific data conditions.

**Proposed solution:**  
Add a dev-only `/dev` route with a `ComponentShowcase` rendering key components in all states, or integrate Storybook.

**Priority:** ⚪ Low  
**Effort:** L (1–2 days for Storybook, M for custom showcase)

---

### 7.2 — 75 Loose `: any` Parameter/Variable Types Across Codebase *(NEW in V3)*

**What currently exists:**  
Beyond the 19 `as any` casts (item 1.3), there are **75 instances** of `: any` used as parameter types, variable types, or generic type arguments across the codebase. The densest files:

| File | Count | Example Patterns |
|---|---|---|
| `MentionSuggestion.tsx` | 7 | `(props: any, ref)`, `({ event }: any)`, `(item: any)` |
| `importers.ts` | 8 | `emails: any[]`, `phones: any[]`, `(row: any)` |
| `TimelineTab.tsx` | 5 | `(item: any)`, `(action: any)`, `(mention: any)`, `opts?: any` |
| `InteractionDetailModal.tsx` | 3 | `data: any`, `Record<string, any>` |
| `RichInteractionComposer.tsx` | 2 | `payload: any`, `(err: any)` |
| `LinkPreviewExtension.tsx` | 1 | `({ node, updateAttributes }: any)` |
| `HealthRingAvatar.tsx` | 1 | `contact: any` |
| `CommandPalette.tsx` | 2 | `(e: any)` |
| Various others | ~46 | Scattered across remaining files |

**Why it's a problem:**  
These aren't just casts — they're structural type holes. `(item: any)` in `TimelineTab.tsx:128` means the entire timeline rendering pipeline has no type checking on the `Interaction` shape, allowing field name typos and schema drift to go unnoticed.

**Proposed solution:**  
1. Replace `(item: any)` in timeline/mentions rendering with `Interaction` type from `types.ts`
2. Replace `(props: any)` in `MentionSuggestion.tsx` with Tiptap's `SuggestionProps` type
3. Replace `data: any` in `InteractionDetailModal` with `Partial<Pick<Interaction, 'title' | 'content'>>`
4. Replace `contact: any` in `HealthRingAvatar` with `Contact`
5. Replace `(err: any)` with `unknown` (TypeScript best practice for catch blocks)
6. Type the importer arrays with proper interfaces

**Priority:** 🟡 High  
**Effort:** L (1–2 days — systematic, but non-breaking refactor)

---

### 7.3 — 6 One-Off Portal Modals Bypass the `<Modal>` Component *(NEW in V3)*

**What currently exists:**  
The app has a well-built `<Modal>` component (93 lines) in `src/components/ui/Modal.tsx` that handles:
- Portal to `document.body`
- Escape key dismiss
- Previous focus save/restore
- Backdrop blur + scale animation
- `aria-modal`, `aria-labelledby`

However, **6 modals** build their own portal + backdrop + animation from scratch:

| Modal | Lines | Uses `<Modal>`? | Has Escape? | Has Focus Restore? |
|---|---|---|---|---|
| `InteractionDetailModal.tsx` | 199 | ❌ custom portal | ❌ | ❌ |
| `CatchMeUpFab.tsx` | 112 | ❌ custom portal | ❌ | ❌ |
| `NetworkCompositionModal.tsx` | 122 | ❌ custom portal | ❌ | ❌ |
| `InteractionVelocityModal.tsx` | 127 | ❌ custom portal | ❌ | ❌ |
| `NetworkGrowthModal.tsx` | 151 | ❌ custom portal | ❌ | ❌ |
| `ActionItemSwimlane.tsx` (snooze) | 191 | ❌ custom portal | ❌ | ❌ |

**Why it's a problem:**  
- **Inconsistent UX:** Some modals close on Escape, others don't. Some restore focus, others don't.
- **Duplicated code:** Each reimplements backdrop click, animation, portal — averaging ~30 lines of boilerplate per modal
- **Accessibility gap:** None of the custom modals have `role="dialog"` or `aria-modal="true"`
- **Maintenance burden:** Any improvement to modal behavior (e.g., focus trapping from item 4.1) must be applied to 7 separate implementations

**Proposed solution:**  
Refactor the 6 custom modals to use `<Modal>` (or create a `<FullScreenModal>` variant for the wider dashboard modals). This eliminates ~180 lines of duplicated boilerplate and ensures consistent behavior.

For modals needing custom width (e.g., `NetworkCompositionModal` at `max-w-5xl`), add a `size` prop to `<Modal>`:
```tsx
<Modal isOpen={isOpen} onClose={onClose} title="Network Composition" size="xl">
```

**Priority:** 🟡 High  
**Effort:** M (3–4 hours)

---

## Category 8: Security *(NEW in V3)*

### 8.1 — `InteractionDetailModal` Uses `dangerouslySetInnerHTML` Without DOMPurify *(NEW in V3)*

**What currently exists:**  
`InteractionDetailModal.tsx` line 131:
```tsx
dangerouslySetInnerHTML={{ __html: interaction.content }}
```

Meanwhile, `TimelineTab.tsx` line 184 renders the **exact same content** but properly sanitizes it:
```tsx
dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(item.content) }}
```

**Why it's a problem:**  
- **XSS vulnerability:** If `interaction.content` contains malicious HTML/JS (e.g., from an imported note, pasted HTML, or a compromised API response), it will execute in the user's browser
- The fix is trivially simple — `DOMPurify` is already imported and used in the same feature area
- This is a regression from the pattern established in `TimelineTab.tsx`

**Proposed solution:**  
```tsx
// Before
dangerouslySetInnerHTML={{ __html: interaction.content }}

// After
dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(interaction.content || '') }}
```

Add `import DOMPurify from 'dompurify'` to `InteractionDetailModal.tsx`.

**Priority:** 🔴 Critical  
**Effort:** XS (< 10 minutes)

---

### 8.2 — Ghost Mention Button Uses Inline `style` for Dashed Border *(NEW in V3)*

**What currently exists:**  
`TimelineTab.tsx` line 209:
```tsx
style={{ borderStyle: 'dashed', borderWidth: '1px', borderColor: 'var(--color-primary)' }}
```

This is a semantic border (distinguishing "ghost" contacts from real ones via a dashed outline) — arguably a valid design choice. But it uses inline `style` instead of Tailwind classes.

**Proposed solution:**  
Replace with Tailwind: `border border-dashed border-primary` (dashed borders for ghost/draft semantics are an allowed exception per the design system, similar to drag-and-drop overlays).

**Priority:** ⚪ Low  
**Effort:** XS (< 5 minutes)

---

## Implementation Roadmap

### Phase 1: Critical & Quick Wins (1 day)

Items that can each be completed in under 1 hour with a single file change.

| # | Item | Effort | Priority | Notes |
|---|---|---|---|---|
| 8.1 | DOMPurify in InteractionDetailModal | XS | 🔴 | **Security — do first** |
| 2.3 | Replace `confirm()` with Modal | XS | 🔴 | |
| 2.7 | Fix Toaster `theme="dark"` + border | XS | 🟡 | Also fixes 6.5 |
| 2.4 | About section click-to-expand | XS | 🟡 | |
| 2.5 | Urgency banner no-line fix | XS | 🟢 | |
| 2.6 | AI summary no-line fix | XS | 🟢 | |
| 5.3 | Settings border-b fix | XS | 🟢 | |
| 5.6 | DailyInsightCard border fix | XS | 🟢 | |
| 5.9 | CatchMeUpFab border fixes | XS | 🟢 | |
| 5.11 | ContactDetail close button border | XS | ⚪ | |
| 1.4 | Dropdown dark-to-light fix | XS | 🟢 | |
| 6.1 | Mentions JSON parsing | XS | 🟢 | |
| 6.3 | Company logo flash fix | XS | 🟢 | |
| 8.2 | Ghost mention inline style | XS | ⚪ | |

### Phase 2: Core Quality (2–3 days)

Items requiring 1–4 hours across 1–3 files.

| # | Item | Effort | Priority |
|---|---|---|---|
| 2.1 | Contact list loading skeleton | S | 🟡 |
| 2.2 | New Contact form inputs | S | 🟡 |
| 4.3 | Keyboard shortcut guards | S | 🟡 |
| 5.2 | Button styling standardization | M | 🟡 |
| 5.10 | InteractionDetailModal border fixes + Modal migration | S | 🟡 |
| 6.2 | Route-level error boundaries | S | 🟡 |
| 7.3 | Consolidate one-off portal modals to `<Modal>` | M | 🟡 |
| 1.2 | useClickOutside hook | S | 🟢 |
| 5.4 | Dossier/timeline no-line fix | S | 🟢 |
| 5.5 | Dashboard modal + skeleton border fixes | S | 🟢 |
| 5.7 | RichInteractionComposer borders | S | 🟢 |

### Phase 3: Architecture (3–5 days)

Larger refactors requiring careful decomposition and testing.

| # | Item | Effort | Priority |
|---|---|---|---|
| 1.1 | ContactList decomposition | L | 🟡 |
| 6.4 | DedupeView decomposition | M | 🟡 |
| 1.3 | Remove `as any` assertions | M | 🟡 |
| 7.2 | Remove loose `: any` types | L | 🟡 |
| 3.1 | List virtualization | M | 🟡 |
| 3.2 | Timeline animation fix | S | 🟢 |
| 3.3 | useContacts select projections | S | 🟢 |

### Phase 4: Polish & Accessibility (2–3 days)

Accessibility improvements and final design system compliance.

| # | Item | Effort | Priority |
|---|---|---|---|
| 4.1 | Modal focus trapping | S | 🟡 |
| 4.2 | aria-label audit | S | 🟢 |
| 5.1 | Map popup design system | XS | ⚪ |
| 5.8 | LinkPreviewExtension borders | S | ⚪ |
| 7.1 | Component showcase / Storybook | L | ⚪ |

---

## Appendix: Files by Improvement Density

| File | Lines | Issues Found | Top Issue |
|---|---|---|---|
| `ContactList.tsx` | 1,063 | 5 | God component (#1.1) |
| `DedupeView.tsx` | 702 | 2 | Emerging God component (#6.4) |
| `ProfileHeader.tsx` | 411 | 3 | No-line violations (#2.5, #2.6), button (#5.2) |
| `SearchView.tsx` | 412 | 1 | Button inconsistency (#5.2) |
| `TimelineTab.tsx` | 305 | 4 | Animation perf (#3.2), mentions (#6.1), border (#5.4), ghost style (#8.2) |
| `DetailsCard.tsx` | 230 | 2 | `as any` casts (#1.3), borders (#5.4) |
| `AISearchView.tsx` | 234 | 2 | `as any` (#1.3), border (#5.5) |
| `InteractionDetailModal.tsx` | 199 | 4 | **XSS** (#8.1), borders (#5.10), `: any` types (#7.2), bypasses Modal (#7.3) |
| `ContactListItem.tsx` | 197 | 1 | Logo flash (#6.3) |
| `ActionItemSwimlane.tsx` | 191 | 2 | Dark border-white (#5.5), bypasses Modal (#7.3) |
| `RichInteractionComposer.tsx` | 184 | 2 | Borders (#5.7), `: any` (#7.2) |
| `DossierTab.tsx` | 167 | 3 | Hover-to-expand (#2.4), borders (#5.4), `as any` (#1.3) |
| `LinkPreviewExtension.tsx` | 153 | 2 | Borders (#5.8), `: any` (#7.2) |
| `NetworkGrowthModal.tsx` | 151 | 2 | Borders (#5.5), bypasses Modal (#7.3) |
| `BulkEditFieldModal.tsx` | 143 | 1 | Button (#5.2) |
| `MapView.tsx` | 144 | 1 | Inline styles (#5.1) |
| `InteractionVelocityModal.tsx` | 127 | 2 | Borders (#5.5), bypasses Modal (#7.3) |
| `NetworkCompositionModal.tsx` | 122 | 2 | Borders (#5.5), bypasses Modal (#7.3) |
| `CatchMeUpFab.tsx` | 112 | 2 | Borders (#5.9), bypasses Modal (#7.3) |
| `MentionSuggestion.tsx` | 102 | 1 | `: any` types (#7.2) |
| `Modal.tsx` | 93 | 1 | No focus trap (#4.1) |
| `DailyInsightCard.tsx` | 71 | 1 | Border (#5.6) |
| `DashboardSkeleton.tsx` | 67 | 1 | Borders (#5.5) |
| `ContactProfile.tsx` | 237 | 2 | `confirm()` (#2.3), border (#5.4) |
| `App.tsx` | 186 | 2 | Toaster theme (#2.7), border (#6.5) |
| `SettingsView.tsx` | 246 | 1 | border-b (#5.3) |
| `styles.ts` | 188 | 1 | Dark dropdown (#1.4) |
| `ContactDetail.tsx` | 36 | 1 | Close button border (#5.11) |

---

## Summary Statistics

| Metric | V1 | V2 | V3 |
|---|---|---|---|
| Total improvement items | 21 | 28 | **35** |
| 🔴 Critical | 1 | 1 | **2** |
| 🟡 High | 11 | 14 | **16** |
| 🟢 Medium | 7 | 10 | **12** |
| ⚪ Low | 2 | 3 | **5** |
| Categories | 7 | 7 | **8** (added Security) |
| Files referenced | 12 | 22 | **27** |
| Codebase size | ~10,000 LOC | ~16,300 LOC | **~17,200 LOC** |
| File count | ~90 | 111 | **113** |
| `as any` cast count | 8+ | 23 | **19** (corrected) |
| `: any` parameter count | — | — | **75** (new metric) |
| No-Line Rule violations | 4 | 13 | **46** (full grep audit) |
| Estimated total effort | ~11 days | ~13 days | **~15 days** |
