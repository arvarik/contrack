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

### Signature Gradient (CTAs & hero sections)
Use for: Primary action buttons, progress bars, hero highlights.

```css
.signature-gradient {
  background: linear-gradient(135deg, #00628a 0%, #47befd 100%);
}
```

## Component Patterns

### Buttons
- **Primary CTA**: `btn-primary` (signature gradient, white text, rounded-full)
- **Secondary/Ghost**: `btn-secondary` (bg-surface-container-low, rounded-full)
- **Icon Buttons**: `p-2 rounded-lg hover:bg-surface-container-low transition-colors`

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

## Off-Palette Colors (FORBIDDEN)

Do NOT use these colors anywhere in the app:
- `violet-*`, `fuchsia-*`, `purple-*` — replaced by `primary` tokens
- `indigo-*` — replaced by `primary-dim`

Allowed accent colors (for semantic meaning only):
- `emerald-500` — success, healthy, active
- `amber-500` — warning, nearing due
- `rose-500` — error, overdue, destructive
- `blue-500` — informational (phone match badge)
