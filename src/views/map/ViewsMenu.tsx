import React, { useState, useRef, useEffect, useLayoutEffect } from "react";
import {
  Bookmark,
  ChevronDown,
  Check,
  Pencil,
  Trash2,
  BookmarkPlus,
  RefreshCw,
} from "lucide-react";
import type { MapView } from "../../api/mapViews";
import { cn } from "../../lib/utils";
import { focusOnPointer } from "../../lib/a11y";
import {
  MENU_HEADING,
  MENU_ICON,
  MENU_ITEM,
  MENU_ITEM_SELECTED,
  MENU_PANEL,
  MENU_SEPARATOR,
  SELECTED_TINT,
} from "../../lib/styles";

export interface ViewsMenuProps {
  views: MapView[];
  activeViewId: string | null;
  onSelectView: (view: MapView) => void;
  onOpenSaveModal: () => void;
  onStartRename: (view: MapView) => void;
  onDeleteView: (view: MapView) => void;
  /** The last view applied or saved, which Update writes this map into. */
  lastView?: MapView | null;
  onUpdateView?: (view: MapView) => void;
  /** Move a view to a place in the list, by a drag or Alt and an arrow. */
  onMoveView?: (view: MapView, to: number) => void;
  isMobile?: boolean;
}

/**
 * The saved-views menu. It is not an `ActionMenu` because each row holds
 * three buttons (select, rename, delete), and an `ActionMenu` row is one
 * item. It paints the same panel and rows, and it keeps the promise
 * `role="menu"` makes: it opens with the focus on the view shown (or the
 * first item), the arrows move between the items and wrap, and Escape goes
 * back to the button, as every action does. A drag, or Alt and an arrow,
 * moves a view.
 */
export const ViewsMenu: React.FC<ViewsMenuProps> = ({
  views,
  activeViewId,
  onSelectView,
  onOpenSaveModal,
  onStartRename,
  onDeleteView,
  lastView = null,
  onUpdateView,
  onMoveView,
  isMobile = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [dragged, setDragged] = useState<MapView | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // A moved row can lose the focus as the list reorders, so it takes it back.
  const moved = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!moved.current) return;
    containerRef.current
      ?.querySelector<HTMLElement>(`[data-view-id="${moved.current}"] button`)
      ?.focus();
    moved.current = null;
  });
  // An open menu holds the focus: on the view shown, or the first item.
  useLayoutEffect(() => {
    if (!isOpen) return;
    const items = containerRef.current?.querySelectorAll<HTMLElement>(
      '[role="menuitem"]:not([tabindex="-1"])',
    );
    const shown = containerRef.current?.querySelector<HTMLElement>(
      `[data-view-id="${CSS.escape(activeViewId ?? "")}"] button`,
    );
    (shown ?? items?.[0])?.focus();
    // Only as it opens: a view applied while it is open must not move it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  /**
   * Close and hand the focus back to the button, before the action runs. A
   * dialog the action opens then returns the focus there too.
   */
  const closeMenu = () => {
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setIsOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      // The arrows move between the items and wrap at the ends. From the
      // trigger (or a rename or delete button), ArrowDown starts at the
      // first item and ArrowUp at the last.
      const items = Array.from(
        containerRef.current?.querySelectorAll<HTMLElement>(
          '[role="menuitem"]',
        ) ?? [],
      );
      if (items.length === 0) return;
      e.preventDefault();
      const index = items.indexOf(document.activeElement as HTMLElement);
      const step = e.key === "ArrowDown" ? 1 : -1;
      const next =
        index === -1
          ? step === 1
            ? 0
            : items.length - 1
          : (index + step + items.length) % items.length;
      items[next]?.focus();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  const activeView = views.find((v) => v.id === activeViewId);

  return (
    <div className="relative shrink-0" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label="Saved views"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className={cn(
          "hit-area px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors border",
          // Selected is the tint and its ink. The border turns transparent
          // rather than going away, so the toggle keeps its size.
          isOpen || activeViewId
            ? cn(SELECTED_TINT, "border-transparent")
            : "state-layer bg-surface-container-high/60 text-on-surface border-outline-variant/30",
        )}
      >
        <Bookmark className="w-3.5 h-3.5" />
        <span className="truncate max-w-[120px]">
          {activeView ? activeView.name : "Views"}
        </span>
        <ChevronDown className="w-3.5 h-3.5 opacity-70" />
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label="Saved views"
          className={cn(
            MENU_PANEL,
            "absolute z-50 w-max min-w-[14rem] max-w-[20rem]",
            // On a phone the button ends the sheet's last row: open up and in.
            isMobile ? "right-0 bottom-full mb-1" : "mt-1 right-0 lg:left-0",
          )}
        >
          <div role="presentation" className={MENU_HEADING}>
            Saved views
            {onMoveView && views.length > 1 && (
              // A mouse drags. A finger cannot, so a touch screen is not told to.
              <span className="hidden pointer-fine:inline">
                {" "}
                · drag to reorder
              </span>
            )}
          </div>

          <div className="max-h-60 overflow-y-auto">
            {views.length === 0 ? (
              <div className="px-2.5 py-2 text-sm text-on-surface-variant">
                No saved views yet
              </div>
            ) : (
              views.map((view, index) => {
                const isActive = view.id === activeViewId;
                const move = (to: number) => {
                  if (!onMoveView || to < 0 || to >= views.length) return;
                  moved.current = view.id;
                  onMoveView(view, to);
                };
                return (
                  <div
                    key={view.id}
                    data-view-id={view.id}
                    draggable={!!onMoveView}
                    onDragStart={(e) => {
                      setDragged(view);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", view.name);
                    }}
                    onDragOver={(e) => dragged && e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragged && dragged.id !== view.id)
                        onMoveView?.(dragged, index);
                      setDragged(null);
                    }}
                    onDragEnd={() => setDragged(null)}
                    className={cn(
                      "group flex items-center rounded-md",
                      isActive && MENU_ITEM_SELECTED,
                      dragged?.id === view.id && "opacity-50",
                    )}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      aria-keyshortcuts={
                        onMoveView ? "Alt+ArrowUp Alt+ArrowDown" : undefined
                      }
                      onPointerMove={focusOnPointer}
                      onKeyDown={(e) => {
                        if (!e.altKey) return;
                        if (e.key !== "ArrowUp" && e.key !== "ArrowDown")
                          return;
                        e.preventDefault();
                        e.stopPropagation();
                        move(index + (e.key === "ArrowUp" ? -1 : 1));
                      }}
                      onClick={() => {
                        closeMenu();
                        onSelectView(view);
                      }}
                      className={cn(
                        MENU_ITEM,
                        "min-w-0 flex-1",
                        isActive && "text-on-primary-wash",
                      )}
                    >
                      <span className="w-4 flex items-center justify-center shrink-0">
                        {isActive ? (
                          <Check
                            aria-hidden="true"
                            className={cn(MENU_ICON, "text-on-primary-wash")}
                          />
                        ) : null}
                      </span>
                      <span className="truncate">{view.name}</span>
                    </button>

                    {/*
                      Rename and Delete are items of the menu too, so the
                      arrows reach them and a screen reader is not told of
                      a menu with a button it does not know. Each is a 24 px
                      target with a 44 px tap box.
                    */}
                    <div className="flex items-center gap-0.5 pr-1 opacity-80 group-hover:opacity-100 shrink-0">
                      <button
                        type="button"
                        role="menuitem"
                        onPointerMove={focusOnPointer}
                        tabIndex={-1}
                        onClick={(e) => {
                          e.stopPropagation();
                          closeMenu();
                          onStartRename(view);
                        }}
                        aria-label={`Rename ${view.name}`}
                        title="Rename view"
                        className="hit-area state-layer w-6 h-6 flex items-center justify-center text-on-surface-variant hover:text-on-surface rounded-lg cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onPointerMove={focusOnPointer}
                        tabIndex={-1}
                        onClick={(e) => {
                          e.stopPropagation();
                          closeMenu();
                          onDeleteView(view);
                        }}
                        aria-label={`Delete ${view.name}`}
                        title="Delete view"
                        className="hit-area state-layer w-6 h-6 flex items-center justify-center text-on-surface-variant hover:text-error rounded-lg cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div role="none" className={MENU_SEPARATOR} />
          <button
            type="button"
            role="menuitem"
            onPointerMove={focusOnPointer}
            onClick={() => {
              closeMenu();
              onOpenSaveModal();
            }}
            className={cn(MENU_ITEM, "text-primary")}
          >
            <BookmarkPlus
              aria-hidden="true"
              className={cn(MENU_ICON, "text-primary")}
            />
            <span>Save current view…</span>
          </button>
          {lastView && onUpdateView && (
            <button
              type="button"
              role="menuitem"
              onPointerMove={focusOnPointer}
              onClick={() => {
                closeMenu();
                onUpdateView(lastView);
              }}
              className={MENU_ITEM}
            >
              <RefreshCw aria-hidden="true" className={MENU_ICON} />
              <span className="truncate">
                Update “{lastView.name}” to this map
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
