/**
 * ActionMenu: a kebab button that opens a short list of actions.
 *
 * The contact page had four hand-written menus: the header kebab, the social
 * link menu, the add-to-list dropdown and the context menu. Each closed on an
 * outside click, and none of them followed the menu pattern a screen reader
 * announces. `role="menu"` promises arrow keys, Home and End, Escape back to
 * the button, and focus inside the menu when it opens. A menu that carries
 * the role without that behaviour tells a keyboard user something false.
 *
 * So the behaviour lives here once:
 *
 * 1. The trigger is a button with `aria-haspopup="menu"` and
 *    `aria-expanded`. Click, Enter or Space opens the menu and focuses the
 *    first item. ArrowDown opens on the first item, ArrowUp on the last.
 * 2. Inside the menu, ArrowDown and ArrowUp move and wrap, Home and End jump,
 *    and a letter moves to the next item that starts with it.
 * 3. Escape closes the menu and returns focus to the trigger. Tab closes it
 *    and lets focus move on. A click outside closes it.
 * 4. Choosing an item closes the menu, returns focus to the trigger, and then
 *    runs the item. An item that opens a dialog therefore hands the dialog a
 *    trigger to return focus to.
 *
 * Items are 44 px tall on a phone and 36 px from `sm`. A `danger` item
 * (Delete) sits last, on its own surface tone, which is the design system's
 * separator: a surface shift, not a line.
 *
 * @module components/ui/ActionMenu
 */
import React, {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { MoreVertical, Check, type LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { useClickOutside } from "../../hooks/useClickOutside";

export interface ActionMenuItem {
  /** Stable key for the item. */
  id: string;
  /** The item's visible text, which is also its accessible name. */
  label: string;
  /** A 16 px glyph before the label. Decoration only. */
  icon?: LucideIcon;
  /** Whether the item is currently selected/checked. */
  checked?: boolean;
  /** What the item does. Runs after the menu closes. */
  onSelect?: () => void;
  /** An in-app route. The item renders as a link to it. */
  to?: string;
  /** Destructive: drawn in the error colour on its own surface tone. */
  danger?: boolean;
  disabled?: boolean;
}

export interface ActionMenuProps {
  /** The trigger's accessible name, for example "Contact actions". */
  label: string;
  items: readonly ActionMenuItem[];
  /** Which edge of the trigger the menu lines up with. Default `end`. */
  align?: "start" | "end";
  /** Extra classes for the trigger button. */
  triggerClassName?: string;
  /** The trigger's glyph. Default a vertical ellipsis. */
  icon?: LucideIcon;
  /** Glyph size classes. Default `w-5 h-5`. */
  iconClassName?: string;
  /** Called when the menu opens or closes. */
  onOpenChange?: (open: boolean) => void;
  /** Receives the trigger element, for a popover that anchors to it. */
  triggerRef?: React.Ref<HTMLButtonElement>;
  /** Extra classes for the wrapper, which positions the menu. */
  className?: string;
  /** Custom trigger content replacing the default icon-only trigger. */
  triggerContent?: React.ReactNode;
}

/**
 * Row height: 44 px on a phone, where a thumb taps it, 36 px from `sm`.
 *
 * The keyboard ring is drawn inside the row. The app's ring sits 2 px
 * outside a control, and here the rows touch and the panel clips its edges,
 * so an outside ring would be cut off.
 */
const ITEM =
  "w-full min-h-[44px] sm:min-h-[36px] flex items-center gap-2.5 px-3.5 text-sm font-medium text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary";

const assignRef = <T,>(ref: React.Ref<T> | undefined, value: T | null) => {
  if (!ref) return;
  if (typeof ref === "function") ref(value);
  else (ref as React.MutableRefObject<T | null>).current = value;
};

export const ActionMenu = ({
  label,
  items,
  align = "end",
  triggerClassName,
  icon: Icon = MoreVertical,
  iconClassName = "w-5 h-5",
  onOpenChange,
  triggerRef,
  className,
  triggerContent,
}: ActionMenuProps) => {
  const [open, setOpen] = useState(false);
  /** Which item takes focus when the menu opens: the first or the last. */
  const [openAt, setOpenAt] = useState<"first" | "last">("first");
  /** True when the menu opens upwards because the space below is too small. */
  const [dropUp, setDropUp] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const setTrigger = useCallback(
    (el: HTMLButtonElement | null) => {
      trigger.current = el;
      assignRef(triggerRef, el);
    },
    [triggerRef],
  );

  const change = useCallback(
    (next: boolean) => {
      setOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  const close = useCallback(() => change(false), [change]);
  useClickOutside(wrapper, close, open);

  /** The enabled items in the open menu, in order. */
  const enabledItems = () =>
    Array.from(
      menu.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([aria-disabled="true"]), [role="menuitemcheckbox"]:not([aria-disabled="true"])',
      ) ?? [],
    );

  // Opening moves focus into the menu. Before the browser paints, the menu
  // is measured: when it would run past the bottom of the window and there is
  // room above the trigger, it opens upwards instead.
  useLayoutEffect(() => {
    if (!open) {
      setDropUp(false);
      return;
    }
    const box = menu.current?.getBoundingClientRect();
    const anchor = trigger.current?.getBoundingClientRect();
    if (box && anchor && box.bottom > window.innerHeight) {
      setDropUp(anchor.top > box.height + 8);
    }
    const list = enabledItems();
    const target = openAt === "last" ? list[list.length - 1] : list[0];
    (target ?? menu.current)?.focus({ preventScroll: true });
    // Once per opening. `openAt` is set in the same batch as `open`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const openMenu = (at: "first" | "last") => {
    setOpenAt(at);
    change(true);
  };

  const onTriggerKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openMenu("first");
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openMenu("last");
    }
  };

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    const list = enabledItems();
    if (list.length === 0) return;
    const index = list.indexOf(document.activeElement as HTMLElement);
    const focusAt = (i: number) =>
      list[(i + list.length) % list.length]?.focus();

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
        focusAt(list.length - 1);
        return;
      case "Escape":
        // Handled: a page-level Escape (the contact over the map closes on
        // Escape) must not also run for this press.
        event.preventDefault();
        event.stopPropagation();
        close();
        trigger.current?.focus();
        return;
      case "Tab":
        close();
        return;
      default:
        if (event.key.length === 1 && /\S/.test(event.key)) {
          const letter = event.key.toLowerCase();
          const order = [...list.slice(index + 1), ...list.slice(0, index + 1)];
          const hit = order.find((el) =>
            el.textContent?.trim().toLowerCase().startsWith(letter),
          );
          if (hit) {
            event.preventDefault();
            hit.focus();
          }
        }
    }
  };

  const choose = (item: ActionMenuItem) => {
    if (item.disabled) return;
    close();
    trigger.current?.focus({ preventScroll: true });
    item.onSelect?.();
  };

  const regular = items.filter((item) => !item.danger);
  const danger = items.filter((item) => item.danger);

  const renderItem = (item: ActionMenuItem) => {
    const ItemIcon = item.icon;
    const isChecked = item.checked === true;
    const isCheckable = item.checked !== undefined;
    const role = isCheckable ? "menuitemcheckbox" : "menuitem";

    const content = (
      <>
        {ItemIcon && (
          <ItemIcon
            aria-hidden="true"
            className={cn(
              "w-4 h-4 shrink-0",
              item.danger ? "text-error" : "text-on-surface-variant",
            )}
          />
        )}
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {isChecked && (
          <Check
            aria-hidden="true"
            className="w-4 h-4 shrink-0 text-primary ml-auto"
          />
        )}
      </>
    );
    // The item with focus is tinted on any focus, not only a keyboard one. A
    // menu opened by a click puts focus on its first item, and the browser
    // draws no focus ring after a click, so the tint is what shows where the
    // arrow keys start.
    const classes = cn(
      ITEM,
      item.danger
        ? "text-error hover:bg-error/10 focus:bg-error/10"
        : "text-on-surface hover:bg-primary/10 focus:bg-primary/10",
      item.disabled && "opacity-50 cursor-not-allowed",
    );
    if (item.to && !item.disabled) {
      return (
        <Link
          key={item.id}
          to={item.to}
          role={role}
          aria-checked={isCheckable ? isChecked : undefined}
          tabIndex={-1}
          className={classes}
          onClick={() => {
            close();
            item.onSelect?.();
          }}
        >
          {content}
        </Link>
      );
    }
    return (
      <button
        key={item.id}
        type="button"
        role={role}
        aria-checked={isCheckable ? isChecked : undefined}
        tabIndex={-1}
        aria-disabled={item.disabled || undefined}
        className={classes}
        onClick={() => choose(item)}
      >
        {content}
      </button>
    );
  };

  return (
    <div ref={wrapper} className={cn("relative inline-flex", className)}>
      <button
        ref={setTrigger}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close() : openMenu("first"))}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          "hit-area p-2 rounded-xl text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-colors flex items-center justify-center",
          open && "bg-surface-container-high text-on-surface",
          triggerClassName,
        )}
      >
        {triggerContent ?? (
          <Icon aria-hidden="true" className={iconClassName} />
        )}
      </button>
      {open && (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={label}
          // Focusable by script only: focus lives on the items, and the
          // container takes it only if every item is disabled.
          tabIndex={-1}
          onKeyDown={onMenuKeyDown}
          className={cn(
            "absolute z-50 min-w-[13rem] max-w-[min(20rem,calc(100vw-2rem))] py-1.5 glass-panel rounded-xl shadow-xl overflow-hidden",
            align === "end" ? "right-0" : "left-0",
            dropUp ? "bottom-full mb-1" : "top-full mt-1",
          )}
        >
          {regular.map(renderItem)}
          {danger.length > 0 && (
            // The separator is a surface shift, not a rule: the destructive
            // items sit on their own tone at the end of the menu.
            <div
              role="none"
              className={cn(
                "bg-surface-container-low",
                regular.length > 0 && "mt-1.5 -mb-1.5 pb-1.5 pt-1",
              )}
            >
              {danger.map(renderItem)}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
