/**
 * useBulkActions — shared bulk action handlers for Contact List and Map views.
 *
 * Manages all bulk mutation side-effects:
 * - Soft delete (with undo toast)
 * - Track and untrack (with undo toast), and the cadence
 * - Archive
 * - Add to list
 * - Color / vibe update
 * - Field edit
 * - CSV export to clipboard
 * - Add-to-list and bulk-edit modal open/close states
 *
 * @module components/bulk/useBulkActions
 */
import { useState, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { describeCadence } from "../../../shared/cadence";
import { copyToClipboard, CLIPBOARD_DENIED } from "../../lib/clipboard";
import { toastUndoableDelete, UNDO_DURATION_MS } from "../../lib/undoToast";
import {
  useBulkDeleteContacts,
  useBulkRestoreContacts,
  useBulkUpdateContacts,
  useBulkAddToList,
} from "../../api";
import type { Contact, ContactUpdateData } from "../../types";

export interface ContactLike {
  id: string;
  name: string;
  role?: string | null;
  company?: string | null;
  location?: string | null;
  emails?: Array<{ email: string }>;
  phones?: Array<{ phone: string }>;
  /** A person keeps up with this contact. Absent when the caller cannot say. */
  isTracked?: boolean;
}

/**
 * Whether the selection is tracked: every one, none, or some. The bulk bar
 * reads Untrack when it is `all` and Track otherwise. With nothing selected
 * yet, the answer is about the rows on screen, so the bar under the Tracked
 * chip reads Untrack before the first row is chosen.
 */
export type SelectionTracked = "all" | "none" | "mixed";

export interface UseBulkActionsOptions {
  selectedIds: Set<string> | string[];
  onComplete?: () => void;
  contacts?: ContactLike[];
}

export function useBulkActions({
  selectedIds,
  onComplete,
  contacts = [],
}: UseBulkActionsOptions) {
  const [isAddToListOpen, setIsAddToListOpen] = useState(false);
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);

  const queryClient = useQueryClient();
  const bulkDelete = useBulkDeleteContacts();
  const bulkRestore = useBulkRestoreContacts();
  const bulkUpdate = useBulkUpdateContacts();
  const bulkAddToList = useBulkAddToList();

  const getIds = useCallback((): string[] => {
    return selectedIds instanceof Set
      ? Array.from(selectedIds)
      : Array.from(new Set(selectedIds));
  }, [selectedIds]);

  const handleBulkDelete = useCallback(() => {
    const ids = getIds();
    if (ids.length === 0) return;
    bulkDelete.mutate(ids, {
      onSuccess: ({ count }) => {
        toastUndoableDelete({
          count,
          onUndo: () =>
            bulkRestore.mutate(ids, {
              onError: (err) =>
                toast.error(
                  `Could not restore: ${err instanceof Error ? err.message : String(err)}`,
                ),
            }),
        });
        onComplete?.();
      },
      onError: (err) =>
        toast.error(
          `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
    });
  }, [getIds, bulkDelete, bulkRestore, onComplete]);

  const say = (count: number) => `${count} contact${count === 1 ? "" : "s"}`;
  const reason = (err: unknown) =>
    err instanceof Error ? err.message : String(err);

  /**
   * The tracked flag by id: from the contacts the caller passed, else from
   * the contact cache for an id the caller did not describe. The list and
   * the map both pass the rows on screen, which is where the selection is.
   */
  const trackedById = useMemo(() => {
    const flags = new Map<string, boolean>();
    for (const c of queryClient.getQueryData<Contact[]>(["contacts"]) ?? []) {
      flags.set(c.id, c.isTracked);
    }
    for (const c of contacts) {
      if (c.isTracked !== undefined) flags.set(c.id, c.isTracked);
    }
    return flags;
  }, [contacts, queryClient]);

  const selectionTracked = useMemo((): SelectionTracked => {
    const ids = getIds();
    const pool = ids.length > 0 ? ids : contacts.map((c) => c.id);
    let known = 0;
    let tracked = 0;
    for (const id of pool) {
      const flag = trackedById.get(id);
      if (flag === undefined) continue;
      known += 1;
      if (flag) tracked += 1;
    }
    if (known === 0 || tracked === 0) return "none";
    return tracked === known ? "all" : "mixed";
  }, [getIds, contacts, trackedById]);

  /**
   * Track (`next: true`) or untrack the selection.
   *
   * Only the ids that differ are sent: Track leaves a tracked contact's
   * cadence alone, and Untrack leaves an untracked one untouched. The toast
   * names the count that changed and offers Undo, which flips the same ids
   * back. An undone untrack tracks them again at the default cadence, and
   * the toast says so, because the cadence each one had is gone.
   */
  const handleBulkTrack = useCallback(
    (next: boolean) => {
      const ids = getIds().filter((id) => trackedById.get(id) !== next);
      if (ids.length === 0) return;
      bulkUpdate.mutate(
        { ids, data: { isTracked: next } },
        {
          onSuccess: ({ count }) => {
            toast.success(
              next
                ? `Tracking ${say(count)}`
                : `Stopped tracking ${say(count)}`,
              {
                duration: UNDO_DURATION_MS,
                action: {
                  label: "Undo",
                  onClick: () =>
                    bulkUpdate.mutate(
                      { ids, data: { isTracked: !next } },
                      {
                        onSuccess: ({ count: undone }) =>
                          toast.success(
                            next
                              ? `Stopped tracking ${say(undone)}`
                              : `Tracking ${say(undone)} again, at the default cadence.`,
                          ),
                        onError: (err) =>
                          toast.error(`Could not undo: ${reason(err)}`),
                      },
                    ),
                },
              },
            );
            onComplete?.();
          },
          onError: (err) =>
            toast.error(
              `${next ? "Tracking" : "Untracking"} failed: ${reason(err)}`,
            ),
        },
      );
    },
    [getIds, trackedById, bulkUpdate, onComplete],
  );

  /** One cadence for every selected contact: "12 contacts, every month". */
  const handleBulkCadence = useCallback(
    (days: number) => {
      const ids = getIds();
      if (ids.length === 0) return;
      bulkUpdate.mutate(
        { ids, data: { cadenceDays: days } },
        {
          onSuccess: ({ count }) => {
            toast.success(
              `${say(count)}, ${describeCadence(days, { sentence: true })}`,
            );
            onComplete?.();
          },
          onError: (err) =>
            toast.error(`Cadence update failed: ${reason(err)}`),
        },
      );
    },
    [getIds, bulkUpdate, onComplete],
  );

  const handleBulkArchive = useCallback(() => {
    const ids = getIds();
    if (ids.length === 0) return;
    bulkUpdate.mutate(
      { ids, data: { isArchived: true } },
      {
        onSuccess: ({ count }) => {
          toast.success(`Archived ${count} contact${count !== 1 ? "s" : ""}`);
          onComplete?.();
        },
        onError: (err) =>
          toast.error(
            `Archive failed: ${err instanceof Error ? err.message : String(err)}`,
          ),
      },
    );
  }, [getIds, bulkUpdate, onComplete]);

  const handleBulkAddToList = useCallback(
    (listId: string) => {
      const contactIds = getIds();
      if (contactIds.length === 0) return;
      bulkAddToList.mutate(
        { listId, contactIds },
        {
          onSuccess: ({ count }) => {
            toast.success(
              `Added ${count} contact${count !== 1 ? "s" : ""} to list`,
            );
            setIsAddToListOpen(false);
            onComplete?.();
          },
          onError: (err) =>
            toast.error(
              `Failed: ${err instanceof Error ? err.message : String(err)}`,
            ),
        },
      );
    },
    [getIds, bulkAddToList, onComplete],
  );

  const handleBulkColorChange = useCallback(
    (vibeId: string) => {
      const ids = getIds();
      if (ids.length === 0) return;
      bulkUpdate.mutate(
        { ids, data: { themeColor: vibeId } },
        {
          onSuccess: ({ count }) => {
            toast.success(
              `Updated color for ${count} contact${count !== 1 ? "s" : ""}`,
            );
            onComplete?.();
          },
          onError: (err) =>
            toast.error(
              `Color update failed: ${err instanceof Error ? err.message : String(err)}`,
            ),
        },
      );
    },
    [getIds, bulkUpdate, onComplete],
  );

  const handleBulkEditApply = useCallback(
    (field: string, value: string | number) => {
      const ids = getIds();
      if (ids.length === 0) return;
      bulkUpdate.mutate(
        { ids, data: { [field]: value } as ContactUpdateData },
        {
          onSuccess: ({ count }) => {
            toast.success(`Updated ${count} contact${count !== 1 ? "s" : ""}`);
            setIsBulkEditOpen(false);
            onComplete?.();
          },
          onError: (err) =>
            toast.error(
              `Update failed: ${err instanceof Error ? err.message : String(err)}`,
            ),
        },
      );
    },
    [getIds, bulkUpdate, onComplete],
  );

  const handleExportCSV = useCallback(() => {
    const idSet = new Set(getIds());
    if (idSet.size === 0) return;

    // Fall back to query cache if contact list is empty or missing details
    const cacheContacts =
      queryClient.getQueryData<Contact[]>(["contacts"]) || [];
    const contactMap = new Map<string, ContactLike>();

    for (const c of cacheContacts) {
      contactMap.set(c.id, c);
    }
    for (const c of contacts) {
      const existing = contactMap.get(c.id);
      contactMap.set(c.id, {
        ...existing,
        ...c,
        emails: c.emails || existing?.emails,
        phones: c.phones || existing?.phones,
      });
    }

    const selected = Array.from(idSet)
      .map((id) => contactMap.get(id))
      .filter((c): c is ContactLike => Boolean(c));

    const header = "Name,Role,Company,Location,Email,Phone";
    const rows = selected.map((c) =>
      [
        c.name,
        c.role || "",
        c.company || "",
        c.location || "",
        c.emails?.[0]?.email || "",
        c.phones?.[0]?.phone || "",
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    const csv = [header, ...rows].join("\n");

    copyToClipboard(csv)
      .then(() => {
        toast.success(
          `Copied ${selected.length} contact${selected.length !== 1 ? "s" : ""} as CSV`,
        );
        onComplete?.();
      })
      .catch(() => {
        toast.error(CLIPBOARD_DENIED);
      });
  }, [getIds, contacts, queryClient, onComplete]);

  const isPending =
    bulkUpdate.isPending || bulkDelete.isPending || bulkAddToList.isPending;

  return {
    isAddToListOpen,
    setIsAddToListOpen,
    openAddToList: () => setIsAddToListOpen(true),
    closeAddToList: () => setIsAddToListOpen(false),

    isBulkEditOpen,
    setIsBulkEditOpen,
    openBulkEdit: () => setIsBulkEditOpen(true),
    closeBulkEdit: () => setIsBulkEditOpen(false),

    isPending,
    isBulkDeletePending: bulkDelete.isPending,
    isBulkAddToListPending: bulkAddToList.isPending,
    isBulkEditPending: bulkUpdate.isPending,

    selectionTracked,
    handleBulkTrack,
    handleBulkCadence,
    handleBulkDelete,
    handleBulkArchive,
    handleBulkAddToList,
    handleBulkColorChange,
    handleBulkEditApply,
    handleExportCSV,
  };
}
