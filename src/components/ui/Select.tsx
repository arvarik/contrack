/**
 * Select: the app's one control for choosing a value from a short list.
 *
 * It replaces the native `<select>`. A native select draws the operating
 * system's popup: a different surface, a different type, no icons, no
 * second line, and on a phone a wheel that hides the page. Every other list
 * that opens under a control in this app is a `.menu-panel`, so the select
 * is one too, and the label chip on a contact's email, the model picker in
 * AI settings and the field picker in the bulk edit dialog now open the same
 * panel with the same rows.
 *
 * It is the select-only combobox pattern, with focus on the rows:
 *
 * 1. The trigger is a button with `role="combobox"`, `aria-haspopup="listbox"`
 *    and `aria-expanded`. It shows the chosen option and a chevron, and it
 *    carries the control's name. Click, Enter or Space opens the list on the
 *    chosen option. ArrowDown and ArrowUp open it too.
 * 2. The list is `role="listbox"`, its rows `role="option"` with
 *    `aria-selected` on the chosen one. ArrowDown and ArrowUp move and wrap,
 *    Home and End jump, a letter moves to the next option that starts with
 *    it, Enter or Space chooses, Escape closes and returns focus to the
 *    trigger, Tab closes and lets focus move on, and a click outside closes.
 * 3. Choosing closes the list, returns focus to the trigger, and then calls
 *    `onChange` when the value changed.
 *
 * The list opens in the browser's top layer through `usePanelPlacement`, so
 * nothing on the page can paint over it and no scroller can clip it, and it
 * drops up or slides in from the window's edge when it would not fit.
 *
 * Three forms of the trigger, one panel:
 *
 *   field  a full-width box on the form surface, in a dialog or a settings row
 *   chip   the small uppercase label on a value ("WORK", "MOBILE")
 *   ghost  text and a chevron with no fill, for a toolbar
 *
 * Options may carry a `group`. Options of one group sit together under a
 * heading, in the order the group first appears. That is what a native
 * `<optgroup>` did for the model picker.
 *
 * @module components/ui/Select
 */
import React, {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Check, ChevronDown, type LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { useClickOutside } from "../../hooks/useClickOutside";
import {
  usePanelPlacement,
  type PanelEdge,
} from "../../hooks/usePanelPlacement";
import {
  MENU_HEADING,
  MENU_ICON,
  MENU_ITEM,
  MENU_ITEM_SELECTED,
  MENU_PANEL,
} from "../../lib/styles";

export interface SelectOption<T extends string = string> {
  value: T;
  /** The visible text, which is also the option's accessible name. */
  label: string;
  /** A second, smaller line under the label. */
  description?: string;
  /** A 16 px glyph before the label. Decoration only. */
  icon?: LucideIcon;
  /** Options that share a group sit under one heading. */
  group?: string;
  disabled?: boolean;
}

export type SelectVariant = "field" | "chip" | "ghost";

export interface SelectProps<T extends string = string> {
  value: T;
  onChange: (value: T) => void;
  options: readonly SelectOption<T>[];
  /**
   * The control's accessible name, for example "Label for ada@example.com"
   * or "Kind of note". Required: the trigger shows the value, not a name.
   */
  label: string;
  /** The trigger's form. Default `field`. */
  variant?: SelectVariant;
  /** Extra classes for the trigger. */
  className?: string;
  /** Extra classes for the wrapper, which positions the panel. */
  wrapperClassName?: string;
  /** Which edge of the trigger the panel lines up with. Default `start`. */
  align?: PanelEdge;
  id?: string;
  disabled?: boolean;
  /** The trigger's text when no option has the value. */
  placeholder?: string;
  /** A tooltip for a pointer. */
  title?: string;
}

const TRIGGER: Record<SelectVariant, string> = {
  field:
    "w-full min-h-[44px] sm:min-h-[40px] justify-between gap-2 px-3.5 rounded-xl bg-surface-container-low text-sm font-medium text-on-surface hover:bg-surface-container-high",
  chip: "hit-area min-h-8 gap-1 rounded-lg px-2 py-0.5 text-[11px] font-bold uppercase tracking-widest bg-surface-container text-on-surface-variant hover:bg-surface-container-high",
  ghost:
    "hit-area gap-1 rounded-xl px-2.5 py-1.5 text-sm font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high",
};

/**
 * The panel's width floor. A field's list is as wide as the field, which
 * `usePanelPlacement` measures and sets inline.
 */
const PANEL: Record<SelectVariant, string> = {
  field: "",
  chip: "min-w-[10rem]",
  ghost: "min-w-[12rem]",
};

/** The chevron, smaller on a chip. */
const CHEVRON: Record<SelectVariant, string> = {
  field: "w-4 h-4",
  chip: "w-3 h-3",
  ghost: "w-3.5 h-3.5",
};

export function Select<T extends string = string>({
  value,
  onChange,
  options,
  label,
  variant = "field",
  className,
  wrapperClassName,
  align = "start",
  id,
  disabled = false,
  placeholder,
  title,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const generatedId = useId();
  const listId = `${id ?? generatedId}-listbox`;
  const close = useCallback(() => setOpen(false), []);
  const placement = usePanelPlacement({
    open,
    align,
    trigger,
    panel: list,
    matchWidth: variant === "field",
    onClose: close,
  });
  useClickOutside(wrapper, close, open);

  const selected = options.find((option) => option.value === value);

  /** The enabled rows in the open list, in order. */
  const rows = () =>
    Array.from(
      list.current?.querySelectorAll<HTMLElement>(
        '[role="option"]:not([aria-disabled="true"])',
      ) ?? [],
    );

  // Opening puts focus on the chosen row, so the arrows start from it and
  // Enter with nothing pressed keeps it.
  useLayoutEffect(() => {
    if (!open) return;
    const all = rows();
    const current = all.find((row) => row.dataset.value === value);
    (current ?? all[0] ?? list.current)?.focus({ preventScroll: true });
    // Once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const choose = (option: SelectOption<T>) => {
    if (option.disabled) return;
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
    if (option.value !== value) onChange(option.value);
  };

  const onTriggerKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
    }
  };

  const onListKeyDown = (event: React.KeyboardEvent) => {
    const all = rows();
    if (all.length === 0) return;
    const index = all.indexOf(document.activeElement as HTMLElement);
    const focusAt = (i: number) => all[(i + all.length) % all.length]?.focus();

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusAt(index + 1);
        return;
      case "ArrowUp":
        event.preventDefault();
        focusAt(index - 1);
        return;
      case "Home":
        event.preventDefault();
        focusAt(0);
        return;
      case "End":
        event.preventDefault();
        focusAt(all.length - 1);
        return;
      case "Escape":
        // Handled here: a dialog or a page-level Escape must not also run.
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
        return;
      case "Tab":
        setOpen(false);
        return;
      default:
        if (event.key.length === 1 && /\S/.test(event.key)) {
          const letter = event.key.toLowerCase();
          const order = [...all.slice(index + 1), ...all.slice(0, index + 1)];
          const hit = order.find((row) =>
            row.textContent?.trim().toLowerCase().startsWith(letter),
          );
          if (hit) {
            event.preventDefault();
            hit.focus();
          }
        }
    }
  };

  // Groups in the order they first appear. Options with no group come first.
  const groups: { name: string | undefined; options: SelectOption<T>[] }[] = [];
  for (const option of options) {
    const group = groups.find((g) => g.name === option.group);
    if (group) group.options.push(option);
    else groups.push({ name: option.group, options: [option] });
  }
  groups.sort((a, b) =>
    a.name === undefined ? -1 : b.name === undefined ? 1 : 0,
  );

  const SelectedIcon = selected?.icon;

  return (
    <div
      ref={wrapper}
      className={cn(
        "relative",
        variant === "field" ? "block w-full" : "inline-flex",
        wrapperClassName,
      )}
    >
      <button
        ref={trigger}
        type="button"
        id={id}
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        title={title}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          "inline-flex items-center transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60",
          TRIGGER[variant],
          open && variant !== "field" && "bg-surface-container-high",
          open && variant === "ghost" && "text-on-surface",
          className,
        )}
      >
        <span className="inline-flex items-center gap-2 min-w-0">
          {SelectedIcon && (
            <SelectedIcon aria-hidden="true" className={MENU_ICON} />
          )}
          <span className="truncate">
            {selected ? selected.label : (placeholder ?? "")}
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn("shrink-0 opacity-70", CHEVRON[variant])}
        />
      </button>

      {open && (
        <div
          ref={list}
          id={listId}
          role="listbox"
          aria-label={label}
          // Focusable by script only: focus lives on the rows.
          tabIndex={-1}
          onKeyDown={onListKeyDown}
          {...placement.panelProps}
          className={cn(
            placement.panelProps.className,
            "outline-none",
            MENU_PANEL,
            PANEL[variant],
          )}
        >
          {groups.map((group) => (
            <React.Fragment key={group.name ?? ""}>
              {group.name && (
                <div role="presentation" className={MENU_HEADING}>
                  {group.name}
                </div>
              )}
              {group.options.map((option) => {
                const isSelected = option.value === value;
                const Icon = option.icon;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={option.disabled || undefined}
                    tabIndex={-1}
                    data-value={option.value}
                    onClick={() => choose(option)}
                    className={cn(
                      MENU_ITEM,
                      // A second line makes a taller row. The padding keeps
                      // the two lines off the row's edges.
                      option.description && "py-2",
                      isSelected && MENU_ITEM_SELECTED,
                      option.disabled && "opacity-50 cursor-not-allowed",
                    )}
                  >
                    {Icon && (
                      <Icon
                        aria-hidden="true"
                        className={cn(MENU_ICON, isSelected && "text-primary")}
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{option.label}</span>
                      {option.description && (
                        <span className="block text-xs font-normal text-on-surface-variant text-pretty">
                          {option.description}
                        </span>
                      )}
                    </span>
                    {isSelected && (
                      <Check
                        aria-hidden="true"
                        className="w-4 h-4 shrink-0 text-primary"
                      />
                    )}
                  </button>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
