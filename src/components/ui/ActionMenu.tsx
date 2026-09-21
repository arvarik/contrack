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
 * (Delete) sits last, under a hairline.
 *
 * The panel is solid (`.menu-panel`): the sort menu used to be glass over
 * the contact list, and rows showed through the items. It opens in the
 * browser's top layer through `usePanelPlacement`, so nothing later in the
 * page can paint over it: the same sort menu once opened under the selected
 * contact row, because the Network header and the row were both `z-10`. It
 * opens where it fits. It drops up when the space below runs out, and it
 * slides in from the window's edge when the trigger sits closer to that
 * edge than the menu is wide, so a menu on the last column of a page is
 * never cut off.
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
import { usePanelPlacement } from "../../hooks/usePanelPlacement";
import {
  MENU_HEADING,
  MENU_HINT,
  MENU_ICON,
  MENU_ITEM,
  MENU_ITEM_DANGER,
  MENU_PANEL,
  MENU_SEPARATOR,
} from "../../lib/styles";

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
  /** A hint at the end of the row: a shortcut ("L"), a count. */
  hint?: string;
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
  /** A tooltip for a pointer, for a trigger that shows a glyph and no text. */
  title?: string;
  /** A heading over the rows, for example "Snooze until". */
  heading?: string;
}

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
  title,
  heading,
}: ActionMenuProps) => {
  const [open, setOpen] = useState(false);
  /** Which item takes focus when the menu opens: the first or the last. */
  const [openAt, setOpenAt] = useState<"first" | "last">("first");
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
  const placement = usePanelPlacement({
    open,
    align,
    trigger,
    panel: menu,
    onClose: close,
  });
  useClickOutside(wrapper, close, open);

  /** The enabled items in the open menu, in order. */
  const enabledItems = () =>
    Array.from(
      menu.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([aria-disabled="true"]), [role="menuitemcheckbox"]:not([aria-disabled="true"])',
      ) ?? [],
    );

  // Opening moves focus into the menu. `usePanelPlacement` has already
  // measured it in its own layout effect, declared above this one.
  useLayoutEffect(() => {
    if (!open) return;
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
            className={cn(MENU_ICON, item.danger && "text-error")}
          />
        )}
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {item.hint && !isChecked && (
          <span aria-hidden="true" className={MENU_HINT}>
            {item.hint}
          </span>
        )}
        {isChecked && (
          <Check
            aria-hidden="true"
            className="w-4 h-4 shrink-0 text-primary ml-auto"
          />
        )}
      </>
    );
    const classes = cn(
      MENU_ITEM,
      item.danger && MENU_ITEM_DANGER,
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
        title={title}
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
          {...placement.panelProps}
          className={cn(placement.panelProps.className, MENU_PANEL)}
        >
          {heading && (
            <div role="presentation" className={MENU_HEADING}>
              {heading}
            </div>
          )}
          {regular.map(renderItem)}
          {danger.length > 0 && (
            // A hairline before the destructive items, so a thumb aimed at
            // the last safe item has a gap to miss into.
            <div role="none">
              {regular.length > 0 && (
                <div role="none" className={MENU_SEPARATOR} />
              )}
              {danger.map(renderItem)}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
