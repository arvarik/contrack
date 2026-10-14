import React, { useState, useEffect, useRef } from "react";
import { Modal } from "../../components/ui/Modal";
import type { MapView } from "../../api/mapViews";
import { touchFirst } from "../../lib/platform";
import { DIALOG_ACTIONS, FORM_INPUT, FORM_LABEL } from "../../lib/styles";
import { errorText } from "../../lib/utils";

interface RenameViewModalProps {
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
      setTimeout(() => {
        if (!touchFirst()) inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen, view]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!view) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a name for the view");
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
      setError(errorText(err, "Could not rename the view"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm" title="Rename view">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="rename-view-name" className={FORM_LABEL}>
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
            className={FORM_INPUT}
            required
          />
          {error && (
            <p role="alert" className="text-xs text-error font-medium">
              {error}
            </p>
          )}
        </div>

        <div className={DIALOG_ACTIONS}>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="btn-secondary btn-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving || !name.trim() || name.trim() === view?.name}
            className="btn-primary btn-sm"
          >
            {isSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
};
