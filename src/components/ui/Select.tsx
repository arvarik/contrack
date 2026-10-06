/**
 * The app's control for choosing a value from a short list, in place of the
 * native `<select>`, whose popup is the system's and on a phone a wheel. It
 * opens a `.menu-panel`, like every other list under a control.
 *
 * The select-only combobox pattern, with focus on the rows:
 *
 * 1. The trigger is a button with `role="combobox"`, `aria-haspopup="listbox"`
 *    and `aria-expanded`, showing the chosen option and carrying the name.
 *    Click, Enter, Space, ArrowDown or ArrowUp opens on the chosen option.
 * 2. The list is `role="listbox"`, its rows `role="option"`. The arrows move
 *    and wrap, Home and End jump, a letter moves to the next option with it,
 *    Enter or Space chooses, Escape closes back to the trigger, Tab closes
 *    and moves on, and a click outside closes.
 * 3. Choosing closes the list, returns focus to the trigger, then calls
 *    `onChange` when the value changed.
 *
 * The list opens in the top layer (`usePanelPlacement`), where it fits.
 *
 *   field  a full-width box on the form surface, in a dialog or a settings row
 *   chip   the small uppercase label on a value ("WORK", "MOBILE")
 *   ghost  text and a chevron with no fill, for a toolbar
 *
 * Options of one `group` sit together under a heading, in the order the
 * group first appears.
 */
import { useCloseRequest } from "../../hooks/useCloseRequest";
import React, {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Check, ChevronDown, type LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { focusOnPointer } from "../../lib/a11y";
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
  /** A 16 px glyph before the label. Decoration only. */
  icon?: LucideIcon;
  /** Options that share a group sit under one heading. */
  group?: string;
  disabled?: boolean;
}

type SelectVariant = "field" | "chip" | "ghost";

interface SelectProps<T extends string = string> {
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

/**
 * The three triggers hover with the one state layer. The `field` form draws
 * its focus ring inset, like the text fields it sits among in a form.
 */
const TRIGGER: Record<SelectVariant, string> = {
  field:
    "state-layer w-full min-h-[44px] sm:pointer-fine:min-h-[40px] justify-between gap-2 px-3.5 rounded-xl bg-surface-container-low text-sm font-medium text-on-surface focus-visible:-outline-offset-2",
  chip: "hit-area state-layer min-h-8 gap-1 rounded-lg px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] bg-surface-container text-on-surface-variant",
  ghost:
    "hit-area state-layer gap-1 rounded-xl px-2.5 py-1.5 text-sm font-medium text-on-surface-variant hover:text-on-surface",
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
  // Android's Back closes the open list instead of leaving the page, and
  // returns focus to the trigger, as Escape does.
  const closeByBack = useCallback(() => {
    close();
    trigger.current?.focus({ preventScroll: true });
  }, [close]);
  useCloseRequest(open, closeByBack);
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
                    onPointerMove={focusOnPointer}
                    onClick={() => choose(option)}
                    className={cn(
                      MENU_ITEM,
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
