/**
 * ListManagerView — Settings sub-page for managing all contact lists.
 *
 * Responsive layout:
 *  - Mobile: shows list OR detail panel (never both), with slide transitions
 *  - Desktop (md+): side-by-side — narrow list panel + full detail panel
 */
import React, { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { GripVertical, Plus, List, Users, ArrowLeft } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useLists, useReorderLists, useCreateList } from "../../api";

import { ListIcon, CreateListModal } from "../contact-list/CreateListModal";
import { ListDetailPanel } from "./ListDetailPanel";
import { cn } from "../../lib/utils";
import { PAGE_X, SELECTED_ROW } from "../../lib/styles";
import { toast } from "sonner";
import { activateOnKey } from "../../lib/a11y";
import { EmptyState } from "../../components/ui/EmptyState";

export const ListManagerView = () => {
  const { data: lists = [], isLoading } = useLists();
  const reorderLists = useReorderLists();
  const createList = useCreateList();
  const navigate = useNavigate();

  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  // Drag-to-reorder state
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
  const handleDrop = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) {
      setDragIdx(null);
      setDragOverIdx(null);
      return;
    }
    const newOrder = [...lists];
    const [moved] = newOrder.splice(dragIdx, 1);
    newOrder.splice(idx, 0, moved);
    reorderLists.mutate(newOrder.map((l) => l.id));
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
        toast.error("Failed to create list");
      }
    },
    [createList],
  );

  const handleListDeleted = (id: string) => {
    if (selectedListId === id) setSelectedListId(null);
  };

  // -- List panel (shared between mobile and desktop) -------------------------
  const ListPanel = (
    <div className="h-full flex flex-col overflow-hidden">
      {/* The count and New list, on the pane's own surface. No band and no
          title of its own: the shell's header above already says "Lists".
          While the pane is the whole page it takes the page's gutters, so it
          lines up with the title. Beside an open list it is a narrow column
          with its own. With no list yet the empty state says it and offers
          New list, so this row said "0 lists" over a second New list. It
          shows while the lists load, without its count, so the rows arrive
          where the skeleton was instead of 68 px lower. */}
      {(isLoading || lists.length > 0) && (
        <div
          className={cn(
            "pt-5 pb-4 shrink-0 flex items-center gap-3",
            selectedListId ? "px-4" : PAGE_X,
          )}
        >
          <p className="flex-1 min-w-0 text-xs text-on-surface-variant">
            {!isLoading && (
              <>
                {lists.length} {lists.length === 1 ? "list" : "lists"}
                {lists.length > 1 && " · drag to reorder"}
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

      {/* List rows */}
      <div
        className={cn(
          "flex-1 overflow-y-auto py-3 space-y-1.5 nice-scrollbar",
          selectedListId ? "px-3" : PAGE_X,
        )}
      >
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
            body="A list groups people for a reason: a project, a city, a dinner."
            action={{
              label: "New list",
              icon: Plus,
              onClick: () => setIsCreateOpen(true),
            }}
          />
        ) : (
          lists.map((list, idx) => {
            const isDragging = dragIdx === idx;
            const isDragTarget = dragOverIdx === idx;
            const isSelected = selectedListId === list.id;

            return (
              <div
                tabIndex={0}
                role="button"
                key={list.id}
                draggable
                onDragStart={(e) => handleDragStart(e, idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDrop={(e) => handleDrop(e, idx)}
                onDragEnd={handleDragEnd}
                className={cn(
                  "group state-layer flex items-center gap-3 p-3 rounded-xl transition-all cursor-pointer select-none",
                  isSelected && SELECTED_ROW,
                  isDragging && "opacity-40",
                  // The row a drop lands on: a dashed outline, the drop
                  // target's line. The focus ring is a solid one, so a solid
                  // outline or a ring here read as keyboard focus. No fill
                  // either, because a `bg-*` utility would replace the
                  // selected row's tint.
                  isDragTarget && "outline-2 outline-dashed outline-primary/60",
                )}
                onClick={() => setSelectedListId(isSelected ? null : list.id)}
                onKeyDown={activateOnKey(() =>
                  setSelectedListId(isSelected ? null : list.id),
                )}
              >
                {/* Grip handle — visible on hover on desktop, always subtle on mobile */}
                <div
                  role="presentation"
                  className="text-on-surface-variant/25 group-hover:text-on-surface-variant transition-colors cursor-grab active:cursor-grabbing shrink-0 touch-none"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <GripVertical className="w-4 h-4" />
                </div>

                {/* Icon */}
                <div
                  className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors",
                    isSelected
                      ? "bg-primary/15 text-on-primary-wash"
                      : "bg-surface-container-low text-on-surface-variant",
                  )}
                >
                  <ListIcon icon={list.icon} className="w-5 h-5" />
                </div>

                {/* Name + count */}
                <div className="flex-1 min-w-0">
                  <p
                    className={cn(
                      "font-bold text-sm truncate",
                      isSelected && "text-on-primary-wash",
                    )}
                  >
                    {list.name}
                  </p>
                  <p className="text-xs text-on-surface-variant flex items-center gap-1 mt-0.5">
                    <Users className="w-3 h-3" />
                    {list.memberCount ?? 0}{" "}
                    {list.memberCount === 1 ? "contact" : "contacts"}
                  </p>
                </div>

                {/* Chevron */}
                <div
                  className={cn(
                    "transition-colors shrink-0",
                    isSelected
                      ? "text-on-primary-wash"
                      : "text-on-surface-variant/30 group-hover:text-on-surface-variant",
                  )}
                >
                  <svg
                    className={cn(
                      "w-4 h-4 transition-transform",
                      isSelected && "md:rotate-90",
                    )}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* ── DESKTOP layout: side-by-side ───────────────────────────────────── */}
      <div className="hidden md:flex h-full overflow-hidden">
        {/* Left panel — fixed width when detail open, full width otherwise */}
        <div
          className={cn(
            "h-full flex flex-col overflow-hidden transition-all duration-(--dur-slow) bg-surface-container-lowest",
            selectedListId ? "w-80 shrink-0" : "flex-1",
          )}
        >
          {ListPanel}
        </div>

        {/* Right detail panel */}
        <AnimatePresence>
          {selectedList && (
            <motion.div
              key={selectedList.id}
              initial={{ opacity: 0, x: 32 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 32 }}
              transition={{ type: "spring", stiffness: 380, damping: 32 }}
              className="flex-1 h-full overflow-hidden bg-surface"
            >
              <ListDetailPanel
                list={selectedList}
                onClose={() => setSelectedListId(null)}
                onDeleted={() => handleListDeleted(selectedList.id)}
                onViewInNetwork={() => navigate(`/?list=${selectedList.id}`)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── MOBILE layout: full-screen stack ──────────────────────────────── */}
      <div className="md:hidden h-full overflow-hidden relative">
        <AnimatePresence initial={false}>
          {!selectedList ? (
            /* Mobile: List view */
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
            /* Mobile: Detail view — slides in from right */
            <motion.div
              key={`mobile-detail-${selectedList.id}`}
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 38 }}
              className="absolute inset-0 bg-surface"
            >
              {/* Mobile back button row */}
              <div className="flex items-center gap-2 px-3 pt-3 pb-0 bg-surface-container-low shrink-0">
                <button
                  type="button"
                  onClick={() => setSelectedListId(null)}
                  className="hit-area state-layer flex items-center gap-1.5 py-2 px-3 rounded-xl text-sm font-bold text-on-surface-variant hover:text-on-surface transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  All lists
                </button>
              </div>
              <div className="h-[calc(100%-48px)] overflow-hidden">
                <ListDetailPanel
                  list={selectedList}
                  onClose={() => setSelectedListId(null)}
                  onDeleted={() => handleListDeleted(selectedList.id)}
                  onViewInNetwork={() => navigate(`/?list=${selectedList.id}`)}
                  hideMobileHeader
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <CreateListModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreate={handleCreate}
        isPending={createList.isPending}
      />
    </>
  );
};
