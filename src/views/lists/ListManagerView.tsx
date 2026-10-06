/**
 * The Settings page for contact lists. From a 672 px page (`@2xl`) the lists
 * sit beside the open list. Narrower, one pane shows at a time.
 *
 * A mouse reorders by drag. Each row's menu has Move up and Move down for a
 * finger and the keyboard.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  List,
  Plus,
  Users,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useLists, useReorderLists, useCreateList } from "../../api";

import { ListIcon, CreateListModal } from "../contact-list/CreateListModal";
import { ListDetailPanel } from "./ListDetailPanel";
import { cn } from "../../lib/utils";
import { CARD, SELECTED_ROW } from "../../lib/styles";
import { SETTINGS_BOX } from "../settings/layout";
import { toast } from "sonner";
import { EmptyState } from "../../components/ui/EmptyState";
import { ActionMenu } from "../../components/ui/ActionMenu";

export const ListManagerView = () => {
  const { data: lists = [], isLoading } = useLists();
  const reorderLists = useReorderLists();
  const createList = useCreateList();
  const navigate = useNavigate();

  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const selectedList = lists.find((l) => l.id === selectedListId) ?? null;

  const handleDragStart = (e: React.DragEvent, idx: number) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = "move";
  };
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    setDragOverIdx(idx);
  };
  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= lists.length) return;
    const newOrder = [...lists];
    const [moved] = newOrder.splice(from, 1);
    newOrder.splice(to, 0, moved);
    reorderLists.mutate(newOrder.map((l) => l.id));
  };
  const handleDrop = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx !== null) move(dragIdx, idx);
    setDragIdx(null);
    setDragOverIdx(null);
  };
  const handleDragEnd = () => {
    setDragIdx(null);
    setDragOverIdx(null);
  };

  const handleCreate = useCallback(
    async (name: string, icon: string) => {
      try {
        await createList.mutateAsync({ name, icon });
        setIsCreateOpen(false);
        toast.success(`List "${name}" created`);
      } catch {
        toast.error("Could not create the list");
      }
    },
    [createList],
  );

  // When the open list closes, its panel takes focus with it. Focus goes to
  // the list's row, or the first row after a delete, or New list. After a
  // delete it waits for the refetch, and for the Delete dialog to leave,
  // since the dialog holds focus until then.
  const pendingFocus = useRef<{ id?: string; gone?: string } | null>(null);
  useEffect(() => {
    const want = pendingFocus.current;
    if (!want || selectedListId) return;
    if (want.gone && lists.some((list) => list.id === want.gone)) return;
    pendingFocus.current = null;
    let frames = 60;
    const attempt = () => {
      if (document.querySelector('[role="dialog"]') && frames-- > 0) {
        requestAnimationFrame(attempt);
        return;
      }
      // Both layouts draw the rows: take the visible ones.
      const shown = (el: HTMLElement) => el.offsetParent !== null;
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>("[data-list-row]"),
      ).filter(shown);
      const pane = Array.from(
        document.querySelectorAll<HTMLElement>("[data-list-pane]"),
      ).find(shown);
      (
        rows.find((row) => row.dataset.listRow === want.id) ??
        rows[0] ??
        pane?.querySelector<HTMLElement>("button")
      )?.focus();
    };
    requestAnimationFrame(attempt);
  }, [lists, selectedListId]);

  const closeList = (focusId?: string, goneId?: string) => {
    pendingFocus.current = { id: focusId, gone: goneId };
    setSelectedListId(null);
  };

  const handleListDeleted = (id: string) => {
    if (selectedListId === id) closeList(undefined, id);
  };

  // Shared by both layouts.
  const ListPanel = (
    <div data-list-pane className="h-full flex flex-col overflow-hidden">
      {/* The count and New list. Hidden with no lists, where the empty state
          offers New list. Shown while loading, so the rows do not jump. */}
      {(isLoading || lists.length > 0) && (
        <div className="pt-5 pb-4 px-4 @2xl:px-5 shrink-0 flex items-center gap-3">
          <p className="flex-1 min-w-0 text-xs text-on-surface-variant">
            {!isLoading && (
              <>
                {lists.length} {lists.length === 1 ? "list" : "lists"}
                {/* Not beside an open list, where the column is narrow and
                    the grips say it. A finger uses the menu. */}
                {lists.length > 1 && !selectedListId && (
                  <span className="hidden pointer-fine:inline">
                    {" "}
                    · drag to reorder
                  </span>
                )}
              </>
            )}
          </p>
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="btn-secondary btn-sm shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">New list</span>
            <span className="sm:hidden">New</span>
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-3 px-4 @2xl:px-2">
        {isLoading ? (
          <div className="space-y-2 p-1">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-16 bg-surface-container-low rounded-xl animate-pulse"
              />
            ))}
          </div>
        ) : lists.length === 0 ? (
          <EmptyState
            icon={List}
            title="No lists yet"
            action={{
              label: "New list",
              icon: Plus,
              onClick: () => setIsCreateOpen(true),
            }}
          />
        ) : (
          <ul aria-label="Lists" className="space-y-1.5">
            {lists.map((list, idx) => {
              const isDragging = dragIdx === idx;
              const isDragTarget = dragOverIdx === idx;
              const isSelected = selectedListId === list.id;

              return (
                <li
                  key={list.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDrop={(e) => handleDrop(e, idx)}
                  onDragEnd={handleDragEnd}
                  className={cn(
                    "group flex items-center rounded-xl transition-all select-none",
                    isSelected && SELECTED_ROW,
                    isDragging && "opacity-40",
                    // Dashed, since a solid ring reads as keyboard focus. No
                    // fill, which would replace the selected row's tint.
                    isDragTarget &&
                      "outline-2 outline-dashed outline-primary/60",
                  )}
                >
                  <button
                    type="button"
                    data-list-row={list.id}
                    aria-pressed={isSelected}
                    onClick={() =>
                      setSelectedListId(isSelected ? null : list.id)
                    }
                    className="state-layer flex-1 min-w-0 flex items-center gap-3 p-3 rounded-xl text-left cursor-pointer"
                  >
                    {/* For a mouse only: a finger cannot drag. */}
                    <GripVertical
                      aria-hidden="true"
                      className="hidden pointer-fine:block w-4 h-4 shrink-0 text-on-surface-variant/25 group-hover:text-on-surface-variant transition-colors cursor-grab"
                    />

                    <span
                      className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors",
                        isSelected
                          ? "bg-primary/15 text-on-primary-wash"
                          : "bg-surface-container-low text-on-surface-variant",
                      )}
                    >
                      <ListIcon icon={list.icon} className="w-5 h-5" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span
                        className={cn(
                          "block font-bold text-sm break-words",
                          isSelected && "text-on-primary-wash",
                        )}
                      >
                        {list.name}
                      </span>
                      <span className="text-xs text-on-surface-variant flex items-center gap-1 mt-0.5">
                        <Users className="w-3 h-3" aria-hidden="true" />
                        {list.memberCount ?? 0}{" "}
                        {list.memberCount === 1 ? "contact" : "contacts"}
                      </span>
                    </span>

                    <ChevronRight
                      aria-hidden="true"
                      className={cn(
                        "w-4 h-4 shrink-0 transition-[color,rotate]",
                        isSelected
                          ? "text-on-primary-wash @2xl:rotate-90"
                          : "text-on-surface-variant/30 group-hover:text-on-surface-variant",
                      )}
                    />
                  </button>
                  <ActionMenu
                    label={`${list.name} actions`}
                    className="shrink-0 mr-1"
                    items={[
                      {
                        id: "up",
                        label: "Move up",
                        icon: ArrowUp,
                        disabled: idx === 0,
                        onSelect: () => move(idx, idx - 1),
                      },
                      {
                        id: "down",
                        label: "Move down",
                        icon: ArrowDown,
                        disabled: idx === lists.length - 1,
                        onSelect: () => move(idx, idx + 1),
                      },
                    ]}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );

  return (
    // A container query: at 1024 px the Settings rail leaves the page about
    // 520 px, too narrow for two panes.
    <div className="@container h-full">
      {/* From @2xl: two cards side by side. The scrollbar gutter lines their
          edges up with the title's. */}
      <div className="hidden @2xl:block h-full overflow-hidden [scrollbar-gutter:stable]">
        <div className={cn(SETTINGS_BOX, "flex gap-4 h-full pt-4 pb-10")}>
          <div
            className={cn(
              CARD,
              "p-0 h-full flex flex-col overflow-hidden transition-all duration-(--dur-slow)",
              selectedListId ? "w-64 @4xl:w-80 shrink-0" : "flex-1 min-w-0",
            )}
          >
            {ListPanel}
          </div>

          <AnimatePresence>
            {selectedList && (
              <motion.div
                key={selectedList.id}
                initial={{ opacity: 0, x: 32 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 32 }}
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
                className={cn(
                  CARD,
                  "p-0 flex-1 min-w-0 h-full overflow-hidden",
                )}
              >
                <ListDetailPanel
                  list={selectedList}
                  onClose={() => closeList(selectedList.id)}
                  onDeleted={() => handleListDeleted(selectedList.id)}
                  onViewInNetwork={() => navigate(`/?list=${selectedList.id}`)}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Narrower: one pane at a time. From `sm` it is a card in the page's
          gutter. */}
      <div className="@2xl:hidden h-full sm:px-6 lg:px-10 sm:pt-4 sm:pb-10">
        <div className="h-full overflow-hidden relative sm:rounded-2xl sm:shadow-sm">
          <AnimatePresence initial={false}>
            {!selectedList ? (
              <motion.div
                key="mobile-list"
                initial={{ x: "-100%" }}
                animate={{ x: 0 }}
                exit={{ x: "-100%" }}
                transition={{ type: "spring", stiffness: 380, damping: 38 }}
                className="absolute inset-0 bg-surface-container-lowest"
              >
                {ListPanel}
              </motion.div>
            ) : (
              <motion.div
                key={`mobile-detail-${selectedList.id}`}
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                exit={{ x: "100%" }}
                transition={{ type: "spring", stiffness: 380, damping: 38 }}
                className="absolute inset-0 bg-surface-container-lowest"
              >
                <div className="flex items-center gap-2 px-3 pt-3 pb-0 bg-surface-container-low shrink-0">
                  <button
                    type="button"
                    onClick={() => closeList(selectedList.id)}
                    aria-label="Back to all lists"
                    className="hit-area state-layer flex items-center gap-1.5 py-2 px-3 rounded-xl text-sm font-bold text-on-surface-variant hover:text-on-surface transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                    All lists
                  </button>
                </div>
                <div className="h-[calc(100%-48px)] overflow-hidden">
                  <ListDetailPanel
                    list={selectedList}
                    onClose={() => closeList(selectedList.id)}
                    onDeleted={() => handleListDeleted(selectedList.id)}
                    onViewInNetwork={() =>
                      navigate(`/?list=${selectedList.id}`)
                    }
                    hideMobileHeader
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <CreateListModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreate={handleCreate}
        isPending={createList.isPending}
      />
    </div>
  );
};
