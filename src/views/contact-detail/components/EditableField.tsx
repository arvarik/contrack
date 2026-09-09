import React, { useState, useRef, useEffect } from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "../../../lib/utils";
import { EDITABLE_INPUT } from "../../../lib/styles";

/** Inline editor that retains rejected drafts and confirms completed asynchronous saves. */
export function EditableField({
  value,
  onSave,
  placeholder,
  className = "",
}: {
  value: string | null;
  onSave: (value: string) => unknown;
  placeholder: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);
  const cancelled = useRef(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 1500);
    return () => clearTimeout(timer);
  }, [saved]);
  const begin = () => {
    cancelled.current = false;
    setDraft(value ?? "");
    setSaved(false);
    setError(false);
    setEditing(true);
  };
  const commit = async () => {
    if (cancelled.current || pending.current) return;
    const next = draft.trim();
    if (next === (value ?? "")) {
      setEditing(false);
      return;
    }
    pending.current = true;
    setSaving(true);
    setError(false);
    try {
      const result = onSave(next);
      const completed = await result;
      if (completed === false) throw new Error("Save failed");
      if (mounted.current) {
        setEditing(false);
        setSaved(result instanceof Promise);
      }
    } catch {
      if (mounted.current) setError(true);
    } finally {
      pending.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  if (editing)
    return (
      <span className="inline-flex flex-col min-w-0">
        <span className="inline-flex items-center gap-1">
          <input
            aria-label={placeholder}
            aria-invalid={error || undefined}
            aria-busy={saving}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            value={draft}
            readOnly={saving}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              void commit();
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Enter") {
                event.preventDefault();
                void commit();
              }
              if (event.key === "Escape" && !pending.current) {
                event.preventDefault();
                event.stopPropagation();
                cancelled.current = true;
                setEditing(false);
                setError(false);
              }
            }}
            className={cn(EDITABLE_INPUT, className)}
            placeholder={placeholder}
          />
          {saving && (
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-label="Saving" />
          )}
        </span>
        {error && (
          <span role="alert" className="text-xs text-error">
            Save failed. Press Enter to retry or Escape to cancel.
          </span>
        )}
      </span>
    );
  return (
    <button
      type="button"
      onClick={begin}
      className={cn(
        "relative cursor-text text-left inline-flex items-center gap-1.5 rounded hover:bg-surface-container-high transition-colors",
        !value && "text-on-surface-variant italic",
        className,
      )}
    >
      <span>{value || placeholder}</span>
      {saved && (
        <Check className="w-3.5 h-3.5 text-success" aria-label="Saved" />
      )}
    </button>
  );
}
