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
      }
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
            "absolute mt-1.5 z-50 min-w-[220px] max-w-[320px] bg-surface-container-lowest rounded-xl shadow-xl border border-outline-variant/30 py-1.5 font-body flex flex-col",
            isMobile ? "left-0" : "right-0 lg:left-0",
          )}
        >
          <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant/70">
            Saved views
          </div>

          <div className="max-h-60 overflow-y-auto nice-scrollbar py-0.5">
            {views.length === 0 ? (
              <div className="px-3 py-2 text-xs text-on-surface-variant/70 italic">
                No saved views yet
              </div>
            ) : (
              views.map((view) => {
                const isActive = view.id === activeViewId;
                return (
                  <div
                    key={view.id}
                    className={cn(
                      "group flex items-center justify-between px-2 py-1.5 hover:bg-surface-container-high transition-colors",
                      isActive && "bg-surface-container-high/70",
                    )}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onSelectView(view);
                        setIsOpen(false);
                      }}
                      className="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer hit-area pr-2"
                    >
                      <span className="w-4 flex items-center justify-center shrink-0">
                        {isActive ? (
                          <Check className="w-3.5 h-3.5 text-primary" />
                        ) : null}
                      </span>
                      <span
                        className={cn(
                          "text-xs truncate",
                          isActive
                            ? "font-bold text-primary"
                            : "font-medium text-on-surface",
                        )}
                      >
                        {view.name}
                      </span>
                    </button>

                    <div className="flex items-center gap-0.5 opacity-80 group-hover:opacity-100 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsOpen(false);
                          onStartRename(view);
                        }}
                        aria-label={`Rename ${view.name}`}
                        title="Rename view"
                        className="hit-area p-1 text-on-surface-variant hover:text-primary rounded-lg cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsOpen(false);
                          onDeleteView(view);
                        }}
                        aria-label={`Delete ${view.name}`}
                        title="Delete view"
                        className="hit-area p-1 text-on-surface-variant hover:text-error rounded-lg cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="border-t border-outline-variant/20 mt-1 pt-1">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setIsOpen(false);
                onOpenSaveModal();
              }}
              className="w-full px-3 py-2 text-left text-xs font-semibold text-primary hover:bg-surface-container-high flex items-center gap-2 cursor-pointer hit-area"
            >
              <BookmarkPlus className="w-3.5 h-3.5" />
              <span>Save current view…</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
