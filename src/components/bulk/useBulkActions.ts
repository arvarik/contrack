/**
 * useBulkActions — shared bulk action handlers for Contact List and Map views.
 *
 * Manages all bulk mutation side-effects:
 * - Soft delete (with undo toast)
 * - Track and untrack (with undo toast), and the cadence, in the words
 *   `describeCadence` gives it ("3 contacts, quarterly")
 * - Archive (with undo toast)
 * - Add to list
 * - Color / vibe update
 * - Field edit (with undo toast)
 * - CSV export to clipboard
 * - Add-to-list and bulk-edit modal open/close states
 *
 * @module components/bulk/useBulkActions
 */
import { useState, useCallback, useMemo } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { describeCadence } from "../../../shared/cadence";
import { copyToClipboard, CLIPBOARD_DENIED } from "../../lib/clipboard";
import { toastUndoableDelete, withUndo } from "../../lib/undoToast";
import {
  useBulkDeleteContacts,
  useBulkRestoreContacts,
  useBulkUpdateContacts,
  useBulkAddToList,
} from "../../api";
import type { Contact, ContactUpdateData } from "../../types";
import { errorText } from "../../lib/utils";

interface ContactLike {
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

/** "1 contact", "3 contacts". */
const say = (count: number) => `${count} contact${count === 1 ? "" : "s"}`;

/** The list cache by id: what a write is about to replace. */
const cachedById = (client: QueryClient) =>
  new Map(
    (client.getQueryData<Contact[]>(["contacts"]) ?? []).map((c) => [c.id, c]),
  );

interface UseBulkActionsOptions {
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
      onSuccess: ({ count, retentionDays }) => {
        toastUndoableDelete({
          count,
          retentionDays,
          onUndo: () =>
            bulkRestore.mutate(ids, {
              onError: (err) =>
                toast.error(`Could not restore: ${errorText(err)}`),
            }),
        });
        onComplete?.();
      },
      onError: (err) => toast.error(`Could not delete: ${errorText(err)}`),
    });
  }, [getIds, bulkDelete, bulkRestore, onComplete]);

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
   * cadence alone, and Stop tracking leaves an untracked one untouched. The
   * toast names the count that changed, says how many already were, and
   * offers Undo, which flips the same ids back. An undone stop tracks them
   * again at the default cadence, and the toast says so, because the
   * cadence each one had is gone.
   */
  const handleBulkTrack = useCallback(
    (next: boolean) => {
      const selected = getIds();
      const ids = selected.filter((id) => trackedById.get(id) !== next);
      if (ids.length === 0) return;
      const already = selected.length - ids.length;
      bulkUpdate.mutate(
        { ids, data: { isTracked: next } },
        {
          onSuccess: ({ count }) => {
            toast.success(
              next
                ? `Tracking ${say(count)}`
                : `Stopped tracking ${say(count)}`,
              {
                description: already
                  ? `${already} ${already === 1 ? "was" : "were"} ${next ? "already tracked" : "not tracked"}`
                  : undefined,
                ...withUndo(() =>
                  bulkUpdate.mutate(
                    { ids, data: { isTracked: !next } },
                    {
                      onSuccess: ({ count: undone }) =>
                        toast.success(
                          next
                            ? `Stopped tracking ${say(undone)}`
                            : `Tracking ${say(undone)} again, at the default cadence`,
                        ),
                      onError: (err) =>
                        toast.error(`Could not undo: ${errorText(err)}`),
                    },
                  ),
                ),
              },
            );
            onComplete?.();
          },
          onError: (err) =>
            toast.error(
              `Could not ${next ? "track" : "stop tracking"}: ${errorText(err)}`,
            ),
        },
      );
    },
    [getIds, trackedById, bulkUpdate, onComplete],
  );

  /**
   * One cadence for every selected contact: "12 contacts, monthly", or
   * "12 contacts, every 2 months" for a value off the four words.
   */
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
            toast.error(`Could not change the cadence: ${errorText(err)}`),
        },
      );
    },
    [getIds, bulkUpdate, onComplete],
  );

  /** Archive the selection. Undo brings back the ones this archived. */
  const handleBulkArchive = useCallback(() => {
    const cached = cachedById(queryClient);
    const ids = getIds().filter((id) => !cached.get(id)?.isArchived);
    if (ids.length === 0) return;
    bulkUpdate.mutate(
      { ids, data: { isArchived: true } },
      {
        onSuccess: ({ count }) => {
          toast.success(
            `Archived ${say(count)}`,
            withUndo(() =>
              bulkUpdate.mutate(
                { ids, data: { isArchived: false } },
                {
                  onError: (err) =>
                    toast.error(`Could not undo: ${errorText(err)}`),
                },
              ),
            ),
          );
          onComplete?.();
        },
        onError: (err) => toast.error(`Could not archive: ${errorText(err)}`),
      },
    );
  }, [getIds, bulkUpdate, onComplete, queryClient]);

  const handleBulkAddToList = useCallback(
    (listId: string) => {
      const contactIds = getIds();
      if (contactIds.length === 0) return;
      bulkAddToList.mutate(
        { listId, contactIds },
        {
          onSuccess: ({ count }) => {
            toast.success(`Added ${say(count)} to the list`);
            setIsAddToListOpen(false);
            onComplete?.();
          },
          onError: (err) =>
            toast.error(`Could not add to the list: ${errorText(err)}`),
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
            toast.success(`Changed the color of ${say(count)}`);
            onComplete?.();
          },
          onError: (err) =>
            toast.error(`Could not change the color: ${errorText(err)}`),
        },
      );
    },
    [getIds, bulkUpdate, onComplete],
  );

  /**
   * One value for one field on every selected contact. Undo puts back each
   * contact's own value: the ids are grouped by the value the edit replaced,
   * one request a group. A contact the list cache does not hold keeps the
   * new value, rather than lose the old one to a guess.
   */
  const handleBulkEditApply = useCallback(
    (field: string, value: string | number) => {
      const ids = getIds();
      if (ids.length === 0) return;
      const cached = cachedById(queryClient);
      const before = new Map<unknown, string[]>();
      for (const id of ids) {
        const contact = cached.get(id);
        if (!contact) continue;
        const old = contact[field as keyof Contact] ?? null;
        before.set(old, [...(before.get(old) ?? []), id]);
      }
      const restore = () =>
        Promise.all(
          [...before].map(([old, group]) =>
            bulkUpdate.mutateAsync({
              ids: group,
              data: { [field]: old } as ContactUpdateData,
            }),
          ),
        ).catch((err) => toast.error(`Could not undo: ${errorText(err)}`));
      bulkUpdate.mutate(
        { ids, data: { [field]: value } as ContactUpdateData },
        {
          onSuccess: ({ count }) => {
            toast.success(`Updated ${say(count)}`, withUndo(restore));
            setIsBulkEditOpen(false);
            onComplete?.();
          },
          onError: (err) => toast.error(`Could not update: ${errorText(err)}`),
        },
      );
    },
    [getIds, bulkUpdate, onComplete, queryClient],
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
        toast.success(`Copied ${say(selected.length)} as CSV`);
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
