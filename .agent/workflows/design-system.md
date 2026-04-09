---
description: Contrack CRM Design System — rules for consistent styling across all components
---

# Contrack CRM Design System

## Color Palette

Primary Blue: `#009EDB` — the vibrant, high-energy anchor.

- `--color-primary`: #009EDB
- `--color-primary-dim`: #00628a (dark end of gradient)
- `--color-primary-container`: #47befd (light end of gradient)

## The "No-Line" Rule

**Lines are a failure of hierarchy.** In this system, 1px solid borders are STRICTLY PROHIBITED for sectioning. Boundaries must be defined solely through background color shifts.

❌ NEVER: `border-b border-surface-container-high`
✅ ALWAYS: Use a different `bg-` level between adjacent sections.

### Exceptions (borders are ALLOWED for):
- Focus rings on inputs (`focus:ring-2 focus:ring-primary/30`)
- Active selection rings (`ring-2 ring-primary`)
- Drag-and-drop overlay borders (`border-4 border-dashed border-primary`)
- The timeline vertical line (decorative, not sectioning)

## Surface Hierarchy (Paper Stack)

Treat the UI as a physical stack of fine paper:

| Level | Token | Hex | Use |
|---|---|---|---|
| Base Layer | `surface` | #f5f6f9 | Page background |
| Sectional Layer | `surface-container-low` | #eff1f4 | Section backgrounds on surface |
| Interactive/Card | `surface-container-lowest` | #ffffff | Cards, inputs resting on sections |
| Elevated/Emphasis | `surface-container-high` | #e0e3e6 | Hovered states, kbd tags, inner dividers |

## Glass & Gradient Rule

### Glassmorphism (floating elements)
Use for: Modals, dropdowns, command palette, floating nav bars.

```css
.glass-panel {
  background: rgba(255, 255, 255, 0.80);
  backdrop-filter: blur(20px);
}
```

### Signature Gradient (BRANDING ONLY)
Use for: Sidebar logo text ONLY. **Do NOT use for buttons or CTAs.**

```css
.signature-gradient {
  background: linear-gradient(135deg, #00628a 0%, #47befd 100%);
}
```

### Primary Button Style
Use for: All primary action buttons.

Pattern: `bg-primary text-on-primary` — solid, clean, no gradients.

```tsx
<button className="bg-primary text-on-primary font-bold rounded-xl px-5 py-2.5 hover:bg-primary/90 transition-colors">
  Action
</button>
```

## Component Patterns

### Buttons
- **Primary CTA**: `bg-primary text-on-primary font-bold rounded-xl` (solid primary color, NO gradient)
- **Secondary/Ghost**: `bg-surface-container-low text-on-surface font-bold rounded-xl`
- **Icon Buttons**: `p-2 rounded-lg hover:bg-surface-container-low transition-colors`
- **⚠️ NEVER use `signature-gradient` for buttons** — gradients are for branding only

### Cards
- Background: `bg-surface-container-lowest`
- Border: NONE (use `shadow-sm` for depth)
- Radius: `rounded-2xl`
- Padding: `p-6`

### Inputs
- Background: `bg-surface-container-low`
- Border: NONE
- Focus: `focus:ring-2 focus:ring-primary/30`
- Radius: `rounded-xl`

### Section Headers
- Separate from body via `bg-surface-container-low` background shift
- NEVER use `border-b`

### Tabs
- Container: `bg-surface-container-low p-1 rounded-xl` (pill container)
- Active tab: `bg-surface-container-lowest shadow-sm text-primary`
- NOT underline-based

### Typography
- Headlines: `font-headline` (Manrope)
- Body: `font-body` (Inter)
- Labels: `text-[10px] font-bold uppercase tracking-widest text-on-surface-variant`

## Grid & Overflow Rules

### Preventing content overflow in grids/flexbox
Grid and flex children have `min-width: auto` by default, which allows content to push past column boundaries. Fix with `min-w-0` on direct children.

```tsx
// ✅ CORRECT — min-w-0 constrains content without clipping decorations
<div className="grid grid-cols-2 gap-3">
  <div className="min-w-0"><Card /></div>
  <div className="min-w-0"><Card /></div>
</div>
```

### ⚠️ NEVER use `overflow-hidden` on grid/flex containers that have children with outward decorations
`ring-*`, `shadow-*`, and `outline-*` render OUTSIDE the element's border box. `overflow-hidden` on the parent clips them.

```tsx
// ❌ WRONG — clips ring-2 on the card
<div className="grid grid-cols-2 overflow-hidden">
  <Card className="ring-2 ring-emerald-500" />
</div>

// ✅ CORRECT — use ring-inset so it renders inside the element's padding
<Card className="ring-2 ring-inset ring-emerald-500" />
```

### When `overflow-hidden` IS appropriate
- **Animate height transitions**: `motion.div` with `height: 0 → auto` needs `overflow-hidden`
- **Inside cards**: On card content that should clip (images, long text)

### The `ring-inset` Rule
When a component may be rendered inside an `overflow-hidden` ancestor (modals, animation wrappers, scrollable panels), **always use `ring-inset`** so the ring renders inside the element's padding area instead of outside. This is immune to any parent clipping.

```tsx
// ❌ ring-2 extends 2px OUTSIDE the element — clipped by overflow-hidden ancestors
"ring-2 ring-emerald-500"

// ✅ ring-inset renders INSIDE the element's padding — never clipped
"ring-2 ring-inset ring-emerald-500"
```

## Off-Palette Colors (FORBIDDEN)

Do NOT use these colors anywhere in the app:
- `violet-*`, `fuchsia-*`, `purple-*` — replaced by `primary` tokens
- `indigo-*` — replaced by `primary-dim`

Allowed accent colors (for semantic meaning only):
- `emerald-500` — success, healthy, active
- `amber-500` — warning, nearing due
- `rose-500` — error, overdue, destructive
- `blue-500` — informational (phone match badge)
