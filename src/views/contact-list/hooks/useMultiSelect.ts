/**
 * useMultiSelect — Multi-select state and bulk action handlers for the contact list.
 *
 * Manages the selection lifecycle (enter/exit mode, toggle individual, select all)
 * and all bulk mutation side-effects (delete, archive, add to list, color change,
 * CSV export). Returns a clean API surface that the UI shell wires to buttons.
 *
 * @param filteredContacts - The currently visible contacts (post-filter/search).
 *        Used by `selectAll` to select only what the user can see.
 */
import { useState, useCallback } from "react";
import { toast } from "sonner";
import {
  useBulkDeleteContacts,
  useBulkUpdateContacts,
  useBulkAddToList,
} from "../../../api";
import type { Contact, ContactUpdateData } from "../../../types";

export function useMultiSelect(filteredContacts: Contact[]) {
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const bulkDelete = useBulkDeleteContacts();
  const bulkUpdate = useBulkUpdateContacts();
  const bulkAddToList = useBulkAddToList();

  // ── Lifecycle ─────────────────────────────────────────────────────────
  const enterSelectMode = useCallback(() => {
    setIsSelectMode(true);
    setSelectedIds(new Set());
  }, []);

  const exitSelectMode = useCallback(() => {
    setIsSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const toggleSelect = useCallback((contactId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(contactId) ? next.delete(contactId) : next.add(contactId);
      return next;
    });
  }, []);

  /** Deselect everything while staying in select mode. */
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(filteredContacts.map((c) => c.id)));
  }, [filteredContacts]);

  // ── Bulk Actions ──────────────────────────────────────────────────────

  const handleBulkDelete = useCallback(() => {
    const ids = Array.from(selectedIds) as string[];
    bulkDelete.mutate(ids, {
      onSuccess: ({ count }) => {
        toast.success(`Deleted ${count} contact${count !== 1 ? "s" : ""}`);
        exitSelectMode();
      },
      onError: (err) =>
        toast.error(
          `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
    });
  }, [selectedIds, bulkDelete, exitSelectMode]);

  const handleBulkArchive = useCallback(() => {
    const ids = Array.from(selectedIds) as string[];
    bulkUpdate.mutate(
      { ids, data: { isArchived: true } },
      {
        onSuccess: ({ count }) => {
          toast.success(`Archived ${count} contact${count !== 1 ? "s" : ""}`);
          exitSelectMode();
        },
        onError: (err) =>
          toast.error(
            `Archive failed: ${err instanceof Error ? err.message : String(err)}`,
          ),
      },
    );
  }, [selectedIds, bulkUpdate, exitSelectMode]);

  const handleBulkAddToList = useCallback(
    (listId: string) => {
      const contactIds = Array.from(selectedIds) as string[];
      bulkAddToList.mutate(
        { listId, contactIds },
        {
          onSuccess: ({ count }) => {
            toast.success(
              `Added ${count} contact${count !== 1 ? "s" : ""} to list`,
            );
            exitSelectMode();
          },
          onError: (err) =>
            toast.error(
              `Failed: ${err instanceof Error ? err.message : String(err)}`,
            ),
        },
      );
    },
    [selectedIds, bulkAddToList, exitSelectMode],
  );

  const handleBulkColorChange = useCallback(
    (vibeId: string) => {
      const ids = Array.from(selectedIds) as string[];
      bulkUpdate.mutate(
        { ids, data: { themeColor: vibeId } },
        {
          onSuccess: ({ count }) => {
            toast.success(
              `Updated color for ${count} contact${count !== 1 ? "s" : ""}`,
            );
            exitSelectMode();
          },
          onError: (err) =>
            toast.error(
              `Color update failed: ${err instanceof Error ? err.message : String(err)}`,
            ),
        },
      );
    },
    [selectedIds, bulkUpdate, exitSelectMode],
  );

  /** Export selected contacts as CSV to clipboard. */
  const handleExportCSV = useCallback(() => {
    const selected = filteredContacts.filter((c) => selectedIds.has(c.id));
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

    const copyToClipboard = (text: string): Promise<void> => {
      // Try modern async Clipboard API first
      if (navigator.clipboard?.writeText) {
        return navigator.clipboard.writeText(text);
      }
      // Fallback: legacy execCommand approach (works in all browsers)
      return new Promise((resolve, reject) => {
        const el = document.createElement("textarea");
        el.value = text;
        el.style.cssText =
          "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
        document.body.appendChild(el);
        el.focus();
        el.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(el);
        ok ? resolve() : reject(new Error("execCommand copy failed"));
      });
    };

    copyToClipboard(csv)
      .then(() => {
        toast.success(
          `Copied ${selected.length} contact${selected.length !== 1 ? "s" : ""} as CSV`,
        );
        exitSelectMode();
      })
      .catch(() => {
        toast.error(
          "Clipboard access denied — please allow clipboard permissions and try again.",
        );
      });
  }, [filteredContacts, selectedIds, exitSelectMode]);

  const selectedCount = selectedIds.size;
  const isPending =
    bulkUpdate.isPending || bulkDelete.isPending || bulkAddToList.isPending;

  return {
    isSelectMode,
    selectedIds,
    selectedCount,
    isPending,
    isBulkDeletePending: bulkDelete.isPending,
    isBulkAddToListPending: bulkAddToList.isPending,
    enterSelectMode,
    exitSelectMode,
    toggleSelect,
    clearSelection,
    selectAll,
    handleBulkDelete,
    handleBulkArchive,
    handleBulkAddToList,
    handleBulkColorChange,
    handleExportCSV,
  };
}
