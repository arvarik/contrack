/**
 * ListDetailPanel — Slide-in right panel for editing and managing a single list.
 *
 * Features:
 *  - Inline icon picker + editable name with auto-save
 *  - Member roster: avatar chips with one-click removal
 *  - "View in Network" deep-link: navigates to /?list=<id>
 *  - Danger zone: delete list with inline confirmation
 */
import React, { useState, useRef } from "react";
import { X, ExternalLink, Trash2, Check, UserMinus } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import {
  useUpdateList,
  useDeleteList,
  useListContacts,
  useRemoveFromList,
} from "../../api";
import { ContactList } from "../../types";
import { ListIcon } from "../contact-list/CreateListModal";
import { cn } from "../../lib/utils";
import {
  CARD,
  ICON_BTN,
  SECTION_HEADING,
  SELECTED_TINT,
  SWATCH_SELECTED,
} from "../../lib/styles";
import { DURATION, EASE } from "../../lib/motion";

// Icon options (same set as CreateListModal)
import {
  Star,
  Heart,
  Crown,
  Flame,
  Rocket,
  Target,
  Gem,
  Award,
  Briefcase,
  Users,
  Globe,
  Zap,
  Shield,
  Coffee,
  Music,
  Camera,
  BookOpen,
  TrendingUp,
  Anchor,
  Flag,
  Sparkles,
  Sun,
} from "lucide-react";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  star: Star,
  heart: Heart,
  crown: Crown,
  flame: Flame,
  rocket: Rocket,
  target: Target,
  gem: Gem,
  award: Award,
  briefcase: Briefcase,
  users: Users,
  globe: Globe,
  zap: Zap,
  shield: Shield,
  coffee: Coffee,
  music: Music,
  camera: Camera,
  "book-open": BookOpen,
  "trending-up": TrendingUp,
  anchor: Anchor,
  flag: Flag,
  sparkles: Sparkles,
  sun: Sun,
};
const ICON_OPTIONS = Object.keys(ICON_MAP);

interface ListDetailPanelProps {
  list: ContactList;
  onClose: () => void;
  onDeleted: () => void;
  onViewInNetwork: () => void;
  /** On mobile, the parent renders its own back button row — hide the panel header */
  hideMobileHeader?: boolean;
}

export const ListDetailPanel = ({
  list,
  onClose,
  onDeleted,
  onViewInNetwork,
  hideMobileHeader = false,
}: ListDetailPanelProps) => {
  const updateList = useUpdateList();
  const deleteList = useDeleteList();
  const removeFromList = useRemoveFromList();
  const { data: members = [], isLoading: membersLoading } = useListContacts(
    list.id,
  );

  const [editName, setEditName] = useState(list.name);
  const [editIcon, setEditIcon] = useState(list.icon);
  const [isDirty, setIsDirty] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Reset the draft when a DIFFERENT list arrives — and only then. A refetch
  // of the same list must not clobber an in-progress edit, which is why the
  // trigger is the id and not the name/icon. Adjusting during render (the
  // documented pattern for prop-keyed state) replaces the old effect: same
  // semantics, one render earlier, no stale frame of the previous list.
  const [lastListId, setLastListId] = useState(list.id);
  if (lastListId !== list.id) {
    setLastListId(list.id);
    setEditName(list.name);
    setEditIcon(list.icon);
    setIsDirty(false);
    setShowDeleteConfirm(false);
  }

  const handleNameChange = (v: string) => {
    setEditName(v);
    setIsDirty(true);
  };
  const handleIconChange = (icon: string) => {
    setEditIcon(icon);
    setIsDirty(true);
  };

  const handleSave = async () => {
    if (!editName.trim()) return;
    try {
      await updateList.mutateAsync({
        id: list.id,
        data: { name: editName.trim(), icon: editIcon },
      });
      setIsDirty(false);
      toast.success("List updated");
    } catch {
      toast.error("Failed to update list");
    }
  };

  const handleDelete = async () => {
    try {
      await deleteList.mutateAsync(list.id);
      toast.success(`Deleted "${list.name}"`);
      onDeleted();
    } catch {
      toast.error("Failed to delete list");
    }
  };

  const handleRemoveMember = async (contactId: string) => {
    setRemovingId(contactId);
    try {
      await removeFromList.mutateAsync({ listId: list.id, contactId });
    } catch {
      toast.error("Failed to remove contact");
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ── Panel Header ─────────────────────────────────────────────────── */}
      {!hideMobileHeader && (
        <div className="p-5 bg-surface-container-low shrink-0 flex items-center gap-3">
          <button onClick={onClose} className={ICON_BTN} title="Close">
            <X className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold font-headline text-base leading-tight truncate">
              {list.name}
            </h3>
            <p className="text-xs text-on-surface-variant mt-0.5">
              {members.length} {members.length === 1 ? "contact" : "contacts"}
            </p>
          </div>
          <button
            type="button"
            onClick={onViewInNetwork}
            className="btn-secondary btn-sm shrink-0"
            title="View filtered in Network page"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">View in Network</span>
            <span className="sm:hidden">Network</span>
          </button>
        </div>
      )}

      {/* Mobile: show View in Network below the parent back button when header is hidden */}
      {hideMobileHeader && (
        <div className="px-4 pb-3 bg-surface-container-low shrink-0 flex items-center justify-between">
          <div className="min-w-0">
            <h3 className="font-bold font-headline text-sm truncate">
              {list.name}
            </h3>
            <p className="text-xs text-on-surface-variant">
              {members.length} {members.length === 1 ? "contact" : "contacts"}
            </p>
          </div>
          <button
            type="button"
            onClick={onViewInNetwork}
            className="btn-secondary btn-sm shrink-0"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Network
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto nice-scrollbar">
        {/* ── Icon Picker ──────────────────────────────────────────────────── */}
        <section className="p-5 space-y-4">
          <h4 className={cn(SECTION_HEADING, "flex items-center gap-2")}>
            <ListIcon icon={editIcon} className="w-4 h-4 text-primary" />
            Icon & name
          </h4>

          <div className="grid grid-cols-8 gap-1.5">
            {ICON_OPTIONS.map((key) => {
              const Icon = ICON_MAP[key];
              const active = editIcon === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleIconChange(key)}
                  aria-pressed={active}
                  className={cn(
                    "hit-area state-layer p-2 rounded-xl transition-colors flex items-center justify-center",
                    // The tint says "chosen" by hue alone, so the swatch
                    // ring is the second cue. The panel sits on the page
                    // surface, so the ring's gap takes that colour.
                    active
                      ? cn(
                          SELECTED_TINT,
                          SWATCH_SELECTED,
                          "ring-offset-surface",
                        )
                      : "text-on-surface-variant hover:text-on-surface",
                  )}
                  title={key}
                >
                  <Icon className="w-4 h-4" />
                </button>
              );
            })}
          </div>

          <div className="flex gap-2">
            <input
              aria-label="List name"
              ref={nameInputRef}
              type="text"
              value={editName}
              onChange={(e) => handleNameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
              className="flex-1 min-h-[44px] sm:min-h-0 bg-surface-container-low rounded-xl px-4 py-2.5 text-sm font-bold"
              placeholder="List name"
            />
            <AnimatePresence>
              {isDirty && (
                // Opacity only. A scale here would make Motion write an
                // inline transform, which cancels the button's own lift on
                // hover and its sink on press.
                <motion.button
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: DURATION.slow, ease: EASE }}
                  onClick={handleSave}
                  disabled={!editName.trim() || updateList.isPending}
                  className="btn-primary shrink-0"
                >
                  <Check className="w-3.5 h-3.5" />
                  Save
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </section>

        {/* ── Members ──────────────────────────────────────────────────────── */}
        <section className="px-5 pb-5 space-y-3">
          <h4 className={cn(SECTION_HEADING)}>Members · {members.length}</h4>

          {membersLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-12 bg-surface-container-low rounded-xl animate-pulse"
                />
              ))}
            </div>
          ) : members.length === 0 ? (
            <div className="text-center py-8 text-on-surface-variant text-sm bg-surface-container-low rounded-2xl">
              <p className="font-bold text-xs opacity-60">No members yet</p>
              <p className="text-xs opacity-40 mt-1">
                Add contacts from the Network page
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {members.map((contact) => (
                <motion.div
                  key={contact.id}
                  layout
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 20, height: 0 }}
                  className={cn(CARD, "flex items-center gap-3 p-3 group")}
                >
                  {/* Avatar */}
                  <div className="w-9 h-9 rounded-full overflow-hidden shrink-0 bg-surface-container-low">
                    {contact.avatarUrl ? (
                      <img
                        src={contact.avatarUrl}
                        alt={contact.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs font-bold text-primary bg-primary/10">
                        {contact.name.charAt(0)}
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm truncate">{contact.name}</p>
                    {(contact.role || contact.company) && (
                      <p className="text-xs text-on-surface-variant truncate">
                        {[contact.role, contact.company]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                  </div>

                  {/* Remove button */}
                  <button
                    onClick={() => handleRemoveMember(contact.id)}
                    disabled={removingId === contact.id}
                    aria-label={`Remove ${contact.name} from list`}
                    className="hit-area state-layer p-1.5 rounded-lg text-on-surface-variant hover:text-error sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 transition-all disabled:opacity-50"
                    title="Remove from list"
                  >
                    {removingId === contact.id ? (
                      <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <UserMinus className="w-3.5 h-3.5" />
                    )}
                  </button>
                </motion.div>
              ))}
            </div>
          )}
        </section>

        {/* ── Delete List ──────────────────────────────────────────────────── */}
        <section className="px-5 pb-8">
          <div className="bg-error/5 rounded-xl px-4 py-2.5 flex items-center gap-3 min-h-[44px]">
            <Trash2 className="w-3.5 h-3.5 text-error shrink-0" />
            <AnimatePresence mode="wait" initial={false}>
              {!showDeleteConfirm ? (
                <motion.div
                  key="delete-trigger"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center justify-between flex-1 gap-3"
                >
                  <span className="text-xs text-error font-medium">
                    Delete this list
                  </span>
                  {/* Not final yet: it asks first, so it is the quiet
                      destructive button. */}
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="btn-secondary btn-sm text-error shrink-0"
                  >
                    Delete
                  </button>
                </motion.div>
              ) : (
                <motion.div
                  key="delete-confirm"
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center justify-between flex-1 gap-3"
                >
                  <span className="text-xs text-on-surface-variant">
                    Remove{" "}
                    <span className="font-bold text-on-surface">
                      "{list.name}"
                    </span>
                    ? Contacts kept.
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(false)}
                      className="btn-secondary btn-sm"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleteList.isPending}
                      className="btn-danger btn-sm"
                    >
                      {deleteList.isPending ? "…" : "Delete"}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </section>
      </div>
    </div>
  );
};
