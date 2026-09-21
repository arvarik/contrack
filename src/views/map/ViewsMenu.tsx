import React, { useState, useRef, useEffect } from "react";
import {
  Bookmark,
  ChevronDown,
  Check,
  Pencil,
  Trash2,
  BookmarkPlus,
} from "lucide-react";
import type { MapView } from "../../api/mapViews";
import { cn } from "../../lib/utils";
import {
  MENU_HEADING,
  MENU_ICON,
  MENU_ITEM,
  MENU_ITEM_SELECTED,
  MENU_PANEL,
  MENU_SEPARATOR,
} from "../../lib/styles";

export interface ViewsMenuProps {
  views: MapView[];
  activeViewId: string | null;
  onSelectView: (view: MapView) => void;
  onOpenSaveModal: () => void;
  onStartRename: (view: MapView) => void;
  onDeleteView: (view: MapView) => void;
  className?: string;
  isMobile?: boolean;
}

/**
 * The saved-views menu. It is not an `ActionMenu` because each row holds
 * three buttons (select, rename, delete), and an `ActionMenu` row is one
 * item. It paints the same panel and rows, and it keeps the promise
 * `role="menu"` makes: the arrows move between the items and wrap, and
 * Escape goes back to the button.
 */
export const ViewsMenu: React.FC<ViewsMenuProps> = ({
  views,
  activeViewId,
  onSelectView,
  onOpenSaveModal,
  onStartRename,
  onDeleteView,
  className,
  isMobile = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

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
    <div className={cn("relative shrink-0", className)} ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label="Saved views"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className={cn(
          "hit-area px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all border",
          isOpen || activeViewId
            ? "bg-primary text-on-primary border-primary shadow-sm"
            : "bg-surface-container-high/60 hover:bg-surface-container-high text-on-surface border-outline-variant/30",
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
            "absolute mt-1 z-50 min-w-[14rem] max-w-[20rem]",
            isMobile ? "left-0" : "right-0 lg:left-0",
          )}
        >
          <div role="presentation" className={MENU_HEADING}>
            Saved views
          </div>

          <div className="max-h-60 overflow-y-auto nice-scrollbar">
            {views.length === 0 ? (
              <div className="px-2.5 py-2 text-sm text-on-surface-variant">
                No saved views yet
              </div>
            ) : (
              views.map((view) => {
                const isActive = view.id === activeViewId;
                return (
                  <div
                    key={view.id}
                    className={cn(
                      "group flex items-center rounded-md",
                      isActive && MENU_ITEM_SELECTED,
                    )}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onSelectView(view);
                        setIsOpen(false);
                      }}
                      className={cn(
                        MENU_ITEM,
                        "min-w-0 flex-1",
                        isActive && "text-primary",
                      )}
                    >
                      <span className="w-4 flex items-center justify-center shrink-0">
                        {isActive ? (
                          <Check
                            aria-hidden="true"
                            className={cn(MENU_ICON, "text-primary")}
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
                        tabIndex={-1}
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsOpen(false);
                          onStartRename(view);
                        }}
                        aria-label={`Rename ${view.name}`}
                        title="Rename view"
                        className="hit-area w-6 h-6 flex items-center justify-center text-on-surface-variant hover:text-primary focus-visible:text-primary rounded-lg cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        tabIndex={-1}
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsOpen(false);
                          onDeleteView(view);
                        }}
                        aria-label={`Delete ${view.name}`}
                        title="Delete view"
                        className="hit-area w-6 h-6 flex items-center justify-center text-on-surface-variant hover:text-error focus-visible:text-error rounded-lg cursor-pointer"
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
            onClick={() => {
              setIsOpen(false);
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
        </div>
      )}
    </div>
  );
};
