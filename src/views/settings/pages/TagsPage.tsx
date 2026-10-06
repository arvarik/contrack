/**
 * TagsPage — Manage, rename, merge, and delete contact tags.
 *
 * Lists all tags across the account's unarchived contacts with contact counts.
 * A tag's name is a link to the Network list filtered to it (`?tag=`), so a
 * person can see who has it. Supports inline renaming, merging tags into
 * another, and deleting tags across all contacts with confirmation.
 *
 * @module views/settings/pages/TagsPage
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Check,
  ChevronRight,
  Hash,
  Loader2,
  Merge,
  Pencil,
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
import { CARD, FORM_INPUT, FORM_LABEL } from "../../../lib/styles";
import { cn, errorText, plural } from "../../../lib/utils";
import { tagFilterPath } from "../../contact-list/hooks/useContactListFilters";
import { SETTINGS_INPUT, SETTINGS_PAGE } from "../layout";
import { LoadFailed } from "../../../components/ui/LoadFailed";
import { SearchField } from "../../../components/ui/SearchField";
import { NO_AUTOCORRECT } from "../../../components/ui/SearchField";

/** A tag row's icon buttons: flat, with the one hover layer. */
const ROW_ACTION =
  "hit-area state-layer p-2.5 rounded-xl text-on-surface-variant min-h-[44px] min-w-[44px] flex items-center justify-center transition-colors";

const contacts = (n: number) => plural(n, "contact", "contacts");

/**
 * Who a rename or a delete changes. It changes every contact with the tag,
 * and the list shows only the ones not archived and not in the Trash.
 */
function reach(t: TagSummary): string {
  const hidden = t.total - t.count;
  return hidden > 0
    ? `${contacts(t.total)}, ${hidden} of them archived or in the Trash`
    : contacts(t.total);
}

export const TagsPage = () => {
  const { data: tags = [], isLoading, isError, refetch } = useTagSummary();
  const renameMutation = useRenameTag();
  const deleteMutation = useDeleteTag();

  const [searchQuery, setSearchQuery] = useState("");
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [mergeSource, setMergeSource] = useState<TagSummary | null>(null);
  const [mergeTarget, setMergeTarget] = useState("");
  const [tagToDelete, setTagToDelete] = useState<TagSummary | null>(null);
  // The tag whose Rename button takes focus back once the list shows it, so
  // focus does not fall to the page after a rename or its Esc.
  const focusTag = useRef<string | null>(null);
  useEffect(() => {
    if (editingTag !== null || focusTag.current === null) return;
    const button = document.querySelector<HTMLElement>(
      `[data-rename-tag="${CSS.escape(focusTag.current)}"]`,
    );
    if (!button) return;
    button.focus();
    focusTag.current = null;
  }, [editingTag, tags]);

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
    focusTag.current = editingTag;
    setEditingTag(null);
    setEditValue("");
  };

  const handleRenameSubmit = async (item: TagSummary) => {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === item.tag) {
      cancelEditing();
      return;
    }
    // A name another tag has joins the two. That is a merge, so it asks
    // first, in the merge dialog that says so.
    const other = tags.find(
      (t) =>
        t.tag !== item.tag && t.tag.toLowerCase() === trimmed.toLowerCase(),
    );
    if (other) {
      cancelEditing();
      setMergeSource(item);
      setMergeTarget(other.tag);
      return;
    }
    try {
      const result = await renameMutation.mutateAsync({
        from: item.tag,
        to: trimmed,
      });
      toast(
        `Renamed "${item.tag}" to "${trimmed}" (${contacts(result.affected)} updated)`,
      );
      cancelEditing();
      focusTag.current = trimmed;
    } catch (err: unknown) {
      toast(errorText(err, "Could not rename the tag"));
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
        `Merged "${mergeSource.tag}" into "${trimmed}" (${contacts(result.affected)} updated)`,
      );
      focusTag.current = trimmed;
      setMergeSource(null);
      setMergeTarget("");
    } catch (err: unknown) {
      toast(errorText(err, "Could not merge the tags"));
    }
  };

  const handleConfirmDelete = async () => {
    if (!tagToDelete) return;
    try {
      const result = await deleteMutation.mutateAsync(tagToDelete.tag);
      toast(
        `Deleted tag "${tagToDelete.tag}" from ${contacts(result.affected)}`,
      );
      setTagToDelete(null);
    } catch (err: unknown) {
      toast(errorText(err, "Could not delete the tag"));
    }
  };

  return (
    <div className={SETTINGS_PAGE}>
      {isLoading ? (
        <div className="flex justify-center p-12">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : isError ? (
        <LoadFailed what="your tags" onRetry={() => void refetch()} />
      ) : tags.length === 0 ? (
        <EmptyState icon={Tag} title="No tags yet" />
      ) : (
        <div className="space-y-4">
          {tags.length > 5 && (
            <SearchField
              className="max-w-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter tags"
              aria-label="Filter tags"
              onClear={() => setSearchQuery("")}
              clearLabel="Clear filter text"
            />
          )}

          {/* One card, a row for each tag, spaced apart with no line. */}
          <div className={cn(CARD, "p-0 py-2")}>
            {filteredTags.length === 0 && (
              <p className="px-4 sm:px-6 py-4 text-sm text-on-surface-variant">
                No tag matches &ldquo;{searchQuery.trim()}&rdquo;
              </p>
            )}
            {filteredTags.map((item) => {
              const isEditing = editingTag === item.tag;

              return (
                <div
                  key={item.tag}
                  className="flex items-center justify-between gap-3 px-4 sm:px-6 py-2.5"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {/* The mark steps aside on a phone, where the three
                        buttons leave the name little room. */}
                    <span className="hidden sm:block p-2 rounded-lg bg-surface-container text-on-surface-variant shrink-0">
                      <Hash className="w-4 h-4" />
                    </span>

                    {isEditing ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void handleRenameSubmit(item);
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
                          className={cn(SETTINGS_INPUT, "flex-1 min-w-0")}
                          aria-label={`Rename tag ${item.tag}`}
                          // The Rename button that opened the field is gone,
                          // so the field takes the focus it had.
                          // eslint-disable-next-line jsx-a11y/no-autofocus
                          autoFocus
                        />
                        <button
                          type="submit"
                          disabled={renameMutation.isPending}
                          className="btn-primary btn-sm btn-icon"
                          aria-label="Save tag name"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={cancelEditing}
                          className="btn-secondary btn-sm btn-icon"
                          aria-label="Cancel rename"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </form>
                    ) : (
                      // The name and its count are one link, to the
                      // Network list showing the contacts with the tag.
                      <Link
                        to={tagFilterPath(item.tag)}
                        aria-label={`${item.tag}, ${contacts(item.count)}`}
                        title="See who has this tag"
                        className="hit-area group/tag flex items-center gap-3 min-w-0 rounded-md"
                      >
                        <span className="font-semibold text-sm text-on-surface break-words min-w-0 underline-offset-2 group-hover/tag:underline">
                          {item.tag}
                        </span>
                        <span className="px-2 py-0.5 rounded-md text-xs font-bold bg-primary/10 text-on-primary-wash shrink-0">
                          {item.count}
                        </span>
                        <ChevronRight
                          aria-hidden="true"
                          className="w-4 h-4 text-on-surface-variant shrink-0"
                        />
                      </Link>
                    )}
                  </div>

                  {!isEditing && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => startEditing(item)}
                        data-rename-tag={item.tag}
                        className={cn(ROW_ACTION, "hover:text-on-surface")}
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
                        className={cn(ROW_ACTION, "hover:text-on-surface")}
                        aria-label={`Merge ${item.tag} into another tag`}
                        title="Merge into…"
                      >
                        <Merge className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => setTagToDelete(item)}
                        className={cn(ROW_ACTION, "hover:text-error")}
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
              The {reach(mergeSource)} tagged <strong>{mergeSource.tag}</strong>{" "}
              get the tag below instead, and <strong>{mergeSource.tag}</strong>{" "}
              goes. A contact with both keeps one
            </p>

            <div>
              <label htmlFor="merge-target-input" className={FORM_LABEL}>
                Target tag
              </label>
              <input
                id="merge-target-input"
                type="text"
                list="existing-tags"
                value={mergeTarget}
                onChange={(e) => setMergeTarget(e.target.value)}
                placeholder="Choose or enter tag name…"
                className={FORM_INPUT}
                {...NO_AUTOCORRECT}
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
          description={`Removes "${tagToDelete.tag}" from ${reach(tagToDelete)}. The contacts stay`}
          confirmLabel="Delete tag"
          tone="danger"
          busy={deleteMutation.isPending}
        />
      )}
    </div>
  );
};

export default TagsPage;
