/**
 * ListDetailPanel — Slide-in right panel for editing and managing a single list.
 *
 * Features:
 *  - Inline icon picker + editable name with auto-save
 *  - Member roster: avatar chips with one-click removal
 *  - "View in Network" deep-link: navigates to /?list=<id>
 *  - Danger zone: delete list with inline confirmation
 */
import React, { useState, useEffect, useRef } from "react";
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
import { SECTION_HEADING, ICON_BTN } from "../../lib/styles";

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

  // Keep local state in sync when the list prop changes (e.g. after save)
  useEffect(() => {
    setEditName(list.name);
    setEditIcon(list.icon);
    setIsDirty(false);
    setShowDeleteConfirm(false);
  }, [list.id]);

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
            onClick={onViewInNetwork}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-primary bg-primary/10 rounded-xl hover:bg-primary/15 transition-colors shrink-0"
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
            onClick={onViewInNetwork}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-primary bg-primary/10 rounded-xl hover:bg-primary/15 transition-colors shrink-0"
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
            Icon & Name
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
                  className={cn(
                    "p-2 rounded-xl transition-all flex items-center justify-center",
                    active
                      ? "bg-primary/15 text-primary ring-2 ring-primary/30 shadow-sm scale-110"
                      : "text-on-surface-variant hover:text-primary hover:bg-surface-container-low",
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
              className="flex-1 bg-surface-container-low rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/30 focus:outline-none font-bold"
              placeholder="List name"
            />
            <AnimatePresence>
              {isDirty && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  onClick={handleSave}
                  disabled={!editName.trim() || updateList.isPending}
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-primary text-on-primary text-xs font-bold rounded-xl hover:opacity-90 transition-opacity shrink-0 disabled:bg-surface-container-high disabled:text-on-surface-variant disabled:shadow-none disabled:cursor-not-allowed"
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
                  className="flex items-center gap-3 p-3 rounded-xl bg-surface-container-lowest shadow-sm group"
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
                    className="p-1.5 rounded-lg text-on-surface-variant hover:text-error hover:bg-rose-500/10 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50"
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
          <div className="bg-rose-500/6 rounded-xl px-4 py-2.5 flex items-center gap-3 min-h-[44px]">
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
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="px-2.5 py-1 rounded-lg text-xs font-bold text-error bg-rose-500/10 hover:bg-rose-500/20 transition-colors shrink-0"
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
                      onClick={() => setShowDeleteConfirm(false)}
                      className="px-2.5 py-1 rounded-lg text-xs font-bold text-on-surface-variant hover:bg-surface-container-high transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleDelete}
                      disabled={deleteList.isPending}
                      className="px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-500 text-white hover:bg-rose-600 transition-colors disabled:opacity-50"
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
