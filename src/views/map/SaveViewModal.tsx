import React, { useState, useEffect, useRef } from "react";
import { Modal } from "../../components/ui/Modal";
import type { MapLayer } from "../../api/mapViews";

export interface SaveViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
  currentQuery?: string;
  currentLayer: MapLayer;
}

export const SaveViewModal: React.FC<SaveViewModalProps> = ({
  isOpen,
  onClose,
  onSave,
  currentQuery = "",
  currentLayer,
}) => {
  const [name, setName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setName("");
      setError(null);
      setIsSaving(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
      await onSave(trimmed);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save view");
    } finally {
      setIsSaving(false);
    }
  };

  const layerLabel =
    currentLayer === "heat"
      ? "Heat"
      : currentLayer === "health"
        ? "Health"
        : "Pins";

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="sm"
      ariaLabel="Save current view"
    >
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div>
          <h2 className="text-lg font-headline font-bold text-on-surface">
            Save current view
          </h2>
          <p className="text-xs text-on-surface-variant mt-1">
            Save current map position, zoom, filters, and active layer to come
            back to it anytime.
          </p>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="save-view-name"
            className="block text-xs font-semibold text-on-surface"
          >
            View name
          </label>
          <input
            ref={inputRef}
            id="save-view-name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
            maxLength={60}
            placeholder="e.g. Virginia, London Tech, At risk"
            className="w-full px-3 py-2 bg-surface-container-high/60 border border-outline-variant/40 rounded-xl text-sm text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
            required
          />
          {error && <p className="text-xs text-error font-medium">{error}</p>}
        </div>

        <div className="bg-surface-container-high/40 rounded-xl p-3 text-xs text-on-surface-variant space-y-1 border border-outline-variant/20">
          <div className="flex justify-between">
            <span className="text-on-surface-variant/80">Filter:</span>
            <span className="font-mono text-on-surface truncate max-w-[200px]">
              {currentQuery.trim() || "All contacts"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-on-surface-variant/80">Layer:</span>
            <span className="font-medium text-on-surface">{layerLabel}</span>
          </div>
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
            disabled={isSaving || !name.trim()}
            className="hit-area px-4 py-2 rounded-xl text-xs font-semibold bg-primary text-on-primary hover:bg-primary-dim disabled:opacity-50 transition-colors shadow-sm cursor-pointer"
          >
            {isSaving ? "Saving…" : "Save view"}
          </button>
        </div>
      </form>
    </Modal>
  );
};
