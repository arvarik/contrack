/**
 * ListDetailPanel — one list: its icon and name, who is in it, and Delete.
 *
 *  - The icon saves when chosen. The name saves when the field is left or on
 *    Enter, and Escape puts the saved name back. It used to wait for a Save
 *    button, and a name typed before another list opened was lost.
 *  - "Add people" finds contacts by name and adds them (`AddPeople`).
 *  - Remove takes a member out at once, with Undo in its toast.
 *  - "View in Network" opens the Network page filtered to the list.
 *  - Delete asks first, in place.
 */
import { useMemo, useRef, useState } from "react";
import { X, ExternalLink, Trash2, UserMinus } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import {
  useAddToList,
  useUpdateList,
  useDeleteList,
  useListContacts,
  useRemoveFromList,
} from "../../api";
import { type ContactList } from "../../types";
import type { ListMember } from "../../../shared/contracts/lists";
import { ListIcon } from "../contact-list/CreateListModal";
import { cn } from "../../lib/utils";
import { withUndo } from "../../lib/undoToast";
import {
  ICON_BTN,
  SECTION_HEADING,
  SELECTED_TINT,
  SWATCH_SELECTED,
} from "../../lib/styles";
import { AddPeople } from "./AddPeople";

/** The icons a list can wear, by the names `ListIcon` draws. */
const ICON_OPTIONS = [
  "star",
  "heart",
  "crown",
  "flame",
  "rocket",
  "target",
  "gem",
  "award",
  "briefcase",
  "users",
  "globe",
  "zap",
  "shield",
  "coffee",
  "music",
  "camera",
  "book-open",
  "trending-up",
  "anchor",
  "flag",
  "sparkles",
  "sun",
];

interface ListDetailPanelProps {
  list: ContactList;
  onClose: () => void;
  onDeleted: () => void;
  onViewInNetwork: () => void;
  /** On mobile, the parent renders its own back button row — hide the panel header */
  hideMobileHeader?: boolean;
}

/**
 * The panel is keyed by the list it shows (`ListManagerView`), so a
 * different list is a new panel and its fields start from that list.
 */
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
  const addToList = useAddToList();
  const { data: members = [], isLoading: membersLoading } = useListContacts(
    list.id,
  );
  const memberIds = useMemo(() => new Set(members.map((m) => m.id)), [members]);

  const [name, setName] = useState(list.name);
  const [icon, setIcon] = useState(list.icon);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  // The name last sent, so Enter and the blur that follows save it once.
  const savedName = useRef(list.name);

  const save = (data: { name?: string; icon?: string }) =>
    updateList
      .mutateAsync({ id: list.id, data })
      .then(() => true)
      .catch(() => {
        toast.error("Could not save the list");
        return false;
      });

  const saveName = () => {
    const next = name.trim();
    if (!next) return setName(savedName.current);
    if (next === savedName.current) return;
    const before = savedName.current;
    savedName.current = next;
    void save({ name: next }).then((ok) => {
      if (!ok) savedName.current = before;
    });
  };

  const handleIconChange = (next: string) => {
    setIcon(next);
    void save({ icon: next });
  };

  const handleDelete = async () => {
    try {
      await deleteList.mutateAsync(list.id);
      toast.success(`Deleted "${list.name}"`);
      onDeleted();
    } catch {
      toast.error("Could not delete the list");
    }
  };

  // Undo puts the member back. `mutateAsync`, so the Undo still works once
  // this list is closed.
  const handleRemoveMember = async (member: ListMember) => {
    setRemovingId(member.id);
    try {
      await removeFromList.mutateAsync({
        listId: list.id,
        contactId: member.id,
      });
      toast.success(
        `${member.name} removed from ${list.name}`,
        withUndo(() =>
          addToList
            .mutateAsync({ listId: list.id, contactId: member.id })
            .catch(() => toast.error(`Could not add ${member.name} back`)),
        ),
      );
    } catch {
      toast.error(`Could not remove ${member.name}`);
    } finally {
      setRemovingId(null);
    }
  };

  return (
    // A size container: the panel is a card beside the lists, as narrow as
    // 360 px on a 1024 px window, so its header reads its own width.
    <div className="@container h-full flex flex-col overflow-hidden">
      {/* ── Panel Header ─────────────────────────────────────────────────── */}
      {!hideMobileHeader && (
        <div className="p-5 bg-surface-container-low shrink-0 flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className={ICON_BTN}
            aria-label="Close list"
            title="Close"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold font-headline text-base leading-tight truncate">
              {list.name}
            </h3>
            <p className="text-xs text-on-surface-variant mt-0.5 whitespace-nowrap">
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
            <span className="hidden @md:inline">View in Network</span>
            <span className="@md:hidden">Network</span>
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

      <div className="flex-1 overflow-y-auto">
        {/* ── Icon Picker ──────────────────────────────────────────────────── */}
        <section className="p-5 space-y-4">
          <h4 className={cn(SECTION_HEADING, "flex items-center gap-2")}>
            <ListIcon icon={icon} className="w-4 h-4 text-primary" />
            Icon & name
          </h4>

          <div className="grid grid-cols-8 gap-1.5">
            {ICON_OPTIONS.map((key) => {
              const active = icon === key;
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
                  aria-label={key}
                >
                  <ListIcon icon={key} className="w-4 h-4" />
                </button>
              );
            })}
          </div>

          <input
            aria-label="List name"
            type="text"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveName();
              else if (e.key === "Escape" && name !== savedName.current) {
                e.preventDefault();
                setName(savedName.current);
              }
            }}
            className="w-full min-h-[44px] sm:pointer-fine:min-h-0 bg-surface-container-low rounded-xl px-4 py-2.5 text-sm font-bold"
            placeholder="List name"
          />
        </section>

        {/* ── Members ──────────────────────────────────────────────────────── */}
        <section className="px-5 pb-5 space-y-3">
          <h4 className={cn(SECTION_HEADING)}>Members · {members.length}</h4>
          <AddPeople list={list} memberIds={memberIds} />

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
            <div className="text-center py-8 bg-surface-container-low rounded-2xl">
              <p className="font-bold text-sm text-on-surface">
                No members yet
              </p>
              <p className="text-xs text-on-surface-variant mt-1">
                Find people with Add people
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
                  // A row on the wash, on the panel's white surface, and not
                  // a card on a card.
                  className="flex items-center gap-3 p-3 rounded-xl bg-surface-container-low/70 group"
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
                  {/* Hidden until hover only for a mouse: a tablet has no hover. */}
                  <button
                    type="button"
                    onClick={() => handleRemoveMember(contact)}
                    disabled={removingId === contact.id}
                    aria-label={`Remove ${contact.name} from list`}
                    className="hit-area state-layer p-1.5 rounded-lg text-on-surface-variant hover:text-error pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:focus-visible:opacity-100 transition-all disabled:opacity-50"
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
                    ? Contacts kept
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
