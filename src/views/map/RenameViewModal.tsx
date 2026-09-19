import React, { useState, useEffect, useRef } from "react";
import { Modal } from "../../components/ui/Modal";
import type { MapView } from "../../api/mapViews";

export interface RenameViewModalProps {
  view: MapView | null;
  isOpen: boolean;
  onClose: () => void;
  onRename: (id: string, newName: string) => Promise<void>;
}

export const RenameViewModal: React.FC<RenameViewModalProps> = ({
  view,
  isOpen,
  onClose,
  onRename,
}) => {
  const [name, setName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && view) {
      setName(view.name);
      setError(null);
      setIsSaving(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen, view]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!view) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Please enter a name for the view");
      return;
    }
    if (trimmed.length > 60) {
      setError("Name must be 60 characters or less");
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await onRename(view.id, trimmed);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to rename view");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm" ariaLabel="Rename view">
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div>
          <h2 className="text-lg font-headline font-bold text-on-surface">
            Rename view
          </h2>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="rename-view-name"
            className="block text-xs font-semibold text-on-surface"
          >
            View name
          </label>
          <input
            ref={inputRef}
            id="rename-view-name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
            maxLength={60}
            className="w-full px-3 py-2 bg-surface-container-high/60 border border-outline-variant/40 rounded-xl text-sm text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
            required
          />
          {error && (
            <p role="alert" className="text-xs text-error font-medium">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="hit-area px-4 py-2 rounded-xl text-xs font-semibold text-on-surface hover:bg-surface-container-high transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving || !name.trim() || name.trim() === view?.name}
            className="hit-area px-4 py-2 rounded-xl text-xs font-semibold bg-primary text-on-primary hover:bg-primary-dim disabled:opacity-50 transition-colors shadow-sm cursor-pointer"
          >
            {isSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
};
