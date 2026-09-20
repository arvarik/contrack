/**
 * TagsPage — Manage, rename, merge, and delete contact tags.
 *
 * Lists all tags across the account's unarchived contacts with contact counts.
 * Supports inline renaming, merging tags into another, and deleting tags
 * across all contacts with confirmation.
 *
 * @module views/settings/pages/TagsPage
 */
import React, { useState, useMemo } from "react";
import {
  AlertCircle,
  Check,
  FolderGit2,
  Hash,
  Loader2,
  Pencil,
  Search,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  useTagSummary,
  useRenameTag,
  useDeleteTag,
  type TagSummary,
} from "../../../api/tags";
import { EmptyState } from "../../../components/ui/EmptyState";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { Modal } from "../../../components/ui/Modal";
import { CARD, SEARCH_INPUT } from "../../../lib/styles";
import { cn } from "../../../lib/utils";

export const TagsPage = () => {
  const { data: tags = [], isLoading, isError } = useTagSummary();
  const renameMutation = useRenameTag();
  const deleteMutation = useDeleteTag();

  const [searchQuery, setSearchQuery] = useState("");
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [mergeSource, setMergeSource] = useState<TagSummary | null>(null);
  const [mergeTarget, setMergeTarget] = useState("");
  const [tagToDelete, setTagToDelete] = useState<TagSummary | null>(null);

  // Filter and sort alphabetically
  const filteredTags = useMemo(
    () =>
      [...tags]
        .filter((t) =>
          t.tag.toLowerCase().includes(searchQuery.trim().toLowerCase()),
        )
        .sort((a, b) => a.tag.localeCompare(b.tag)),
    [tags, searchQuery],
  );

  const startEditing = (t: TagSummary) => {
    setEditingTag(t.tag);
    setEditValue(t.tag);
  };

  const cancelEditing = () => {
    setEditingTag(null);
    setEditValue("");
  };

  const handleRenameSubmit = async (fromTag: string) => {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === fromTag) {
      cancelEditing();
      return;
    }
    try {
      const result = await renameMutation.mutateAsync({
        from: fromTag,
        to: trimmed,
      });
      toast(
        `Renamed "${fromTag}" to "${trimmed}" (${result.affected} contact${result.affected === 1 ? "" : "s"} updated)`,
      );
      cancelEditing();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Failed to rename tag");
    }
  };

  const handleMergeSubmit = async () => {
    if (!mergeSource) return;
    const trimmed = mergeTarget.trim();
    if (!trimmed || trimmed === mergeSource.tag) {
      toast("Select or type a different tag to merge into");
      return;
    }
    try {
      const result = await renameMutation.mutateAsync({
        from: mergeSource.tag,
        to: trimmed,
      });
      toast(
        `Merged "${mergeSource.tag}" into "${trimmed}" (${result.affected} contact${result.affected === 1 ? "" : "s"} updated)`,
      );
      setMergeSource(null);
      setMergeTarget("");
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Failed to merge tags");
    }
  };

  const handleConfirmDelete = async () => {
    if (!tagToDelete) return;
    try {
      const result = await deleteMutation.mutateAsync(tagToDelete.tag);
      toast(
        `Deleted tag "${tagToDelete.tag}" from ${result.affected} contact${result.affected === 1 ? "" : "s"}`,
      );
      setTagToDelete(null);
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Failed to delete tag");
    }
  };

  return (
    <div className="p-4 sm:p-6 md:p-10 max-w-4xl mx-auto space-y-8 pb-28 md:pb-10">
      <div className="space-y-1">
        <p className="text-sm text-on-surface-variant">
          Organise contacts with labels. Rename, merge, or delete tags across
          your network.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center p-12">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : isError ? (
        <div className="p-4 bg-red-500/10 text-error rounded-xl flex items-center gap-3 text-sm font-medium">
          <AlertCircle className="w-5 h-5 shrink-0" />
          Failed to load tags.
        </div>
      ) : tags.length === 0 ? (
        <EmptyState
          icon={Tag}
          title="No tags yet"
          body="Tags you add to your contacts will appear here so you can rename, merge, or remove them."
        />
      ) : (
        <div className="space-y-4">
          {tags.length > 5 && (
            <div className="relative max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter tags…"
                className={cn(SEARCH_INPUT, "pl-9 text-sm")}
                aria-label="Filter tags"
              />
            </div>
          )}

          <div
            className={cn(
              CARD,
              "divide-y divide-surface-container-high overflow-hidden p-0",
            )}
          >
            {filteredTags.map((item) => {
              const isEditing = editingTag === item.tag;

              return (
                <div
                  key={item.tag}
                  className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 hover:bg-surface-container-high/40 transition-colors"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className="p-2 rounded-lg bg-surface-container text-on-surface-variant shrink-0">
                      <Hash className="w-4 h-4" />
                    </span>

                    {isEditing ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void handleRenameSubmit(item.tag);
                        }}
                        className="flex items-center gap-2 flex-1 max-w-md"
                      >
                        <input
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") cancelEditing();
                          }}
                          className="flex-1 px-3 py-1.5 rounded-lg text-sm bg-surface-container border border-primary/50 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary min-h-[38px]"
                          aria-label={`Rename tag ${item.tag}`}
                        />
                        <button
                          type="submit"
                          disabled={renameMutation.isPending}
                          className="btn-primary text-xs px-2.5 py-1.5 min-h-[38px] min-w-[38px] flex items-center justify-center hit-area"
                          aria-label="Save tag name"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={cancelEditing}
                          className="btn-secondary text-xs px-2.5 py-1.5 min-h-[38px] min-w-[38px] flex items-center justify-center hit-area"
                          aria-label="Cancel rename"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </form>
                    ) : (
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className="font-semibold text-sm text-on-surface truncate">
                          {item.tag}
                        </span>
                        <span
                          className="px-2 py-0.5 rounded-md text-xs font-bold bg-primary/10 text-on-primary-wash shrink-0"
                          aria-label={`${item.count} ${item.count === 1 ? "contact" : "contacts"}`}
                        >
                          {item.count}
                        </span>
                      </div>
                    )}
                  </div>

                  {!isEditing && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => startEditing(item)}
                        className="p-2.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container min-h-[44px] min-w-[44px] flex items-center justify-center hit-area transition-colors"
                        aria-label={`Rename ${item.tag}`}
                        title="Rename"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setMergeSource(item);
                          setMergeTarget("");
                        }}
                        className="p-2.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container min-h-[44px] min-w-[44px] flex items-center justify-center hit-area transition-colors"
                        aria-label={`Merge ${item.tag} into another tag`}
                        title="Merge into…"
                      >
                        <FolderGit2 className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => setTagToDelete(item)}
                        className="p-2.5 rounded-xl text-on-surface-variant hover:text-error hover:bg-red-500/10 min-h-[44px] min-w-[44px] flex items-center justify-center hit-area transition-colors"
                        aria-label={`Delete tag ${item.tag}`}
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Merge Modal */}
      {mergeSource && (
        <Modal
          isOpen={true}
          onClose={() => setMergeSource(null)}
          title={`Merge "${mergeSource.tag}" into…`}
          size="sm"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleMergeSubmit();
            }}
            className="space-y-4"
          >
            <p className="text-sm text-on-surface-variant">
              All {mergeSource.count}{" "}
              {mergeSource.count === 1 ? "contact" : "contacts"} tagged with{" "}
              <strong>{mergeSource.tag}</strong> will be updated to the target
              tag, and <strong>{mergeSource.tag}</strong> will be removed.
            </p>

            <div className="space-y-2">
              <label
                htmlFor="merge-target-input"
                className="block text-xs font-bold uppercase tracking-wider text-on-surface-variant"
              >
                Target tag
              </label>
              <input
                id="merge-target-input"
                type="text"
                list="existing-tags"
                value={mergeTarget}
                onChange={(e) => setMergeTarget(e.target.value)}
                placeholder="Choose or enter tag name…"
                className="w-full px-3 py-2 rounded-xl text-sm bg-surface-container border border-surface-container-high text-on-surface focus:outline-none focus:ring-2 focus:ring-primary min-h-[44px]"
              />
              <datalist id="existing-tags">
                {tags
                  .filter((t) => t.tag !== mergeSource.tag)
                  .map((t) => (
                    <option key={t.tag} value={t.tag}>
                      {t.tag} ({t.count})
                    </option>
                  ))}
              </datalist>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setMergeSource(null)}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  !mergeTarget.trim() ||
                  mergeTarget.trim() === mergeSource.tag ||
                  renameMutation.isPending
                }
                className="btn-primary"
              >
                {renameMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : null}
                Merge tags
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Delete Confirmation */}
      {tagToDelete && (
        <ConfirmDialog
          isOpen={true}
          onClose={() => setTagToDelete(null)}
          onConfirm={handleConfirmDelete}
          title={`Delete tag "${tagToDelete.tag}"?`}
          description={`Removes "${tagToDelete.tag}" from ${tagToDelete.count} ${tagToDelete.count === 1 ? "contact" : "contacts"}. The contacts themselves will not be deleted.`}
          confirmLabel="Delete tag"
          tone="danger"
          busy={deleteMutation.isPending}
        />
      )}
    </div>
  );
};

export default TagsPage;
