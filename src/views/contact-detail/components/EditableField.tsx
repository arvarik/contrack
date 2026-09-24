import React, { useState, useRef, useEffect } from "react";
import { Check, Loader2, Pencil } from "lucide-react";
import { cn } from "../../../lib/utils";
import { EDITABLE_INPUT } from "../../../lib/styles";

/**
 * The pencil after an editable value.
 *
 * A pointer shows a grey wash on hover, and that was the only sign a value
 * could be edited. A phone has no hover, so nothing said it. The pencil shows
 * at 40 percent on a coarse pointer (touch) and whenever the value has
 * keyboard focus. It is sized in `em`, so it follows the text it sits beside,
 * from a 14 px phone number to the name. It is decoration: the value is the
 * button's name, and the pencil is hidden from assistive tech.
 *
 * Where it is not shown it is not drawn at all, rather than drawn clear. A
 * clear pencil still took its width, and left a gap after every name, role
 * and company on a desktop.
 */
export const EditHint = ({ className }: { className?: string }) => (
  <Pencil
    aria-hidden="true"
    data-edit-hint=""
    className={cn(
      "w-[0.55em] h-[0.55em] min-w-3 min-h-3 max-w-5 max-h-5 shrink-0 opacity-40",
      "hidden pointer-coarse:inline-block group-focus-visible/edit:inline-block",
      className,
    )}
  />
);

/**
 * Inline editor that retains rejected drafts and confirms completed
 * asynchronous saves.
 *
 * At rest the value is a button: a click, Enter or Space opens the input.
 * In the input, Enter saves and Escape cancels. These two keys are in the
 * "Contact" group of `lib/shortcuts`, so the shortcuts dialog lists them.
 */
export function EditableField({
  value,
  onSave,
  placeholder,
  className = "",
  inputLabel,
}: {
  value: string | null;
  onSave: (value: string) => unknown;
  placeholder: string;
  className?: string;
  /**
   * The input's accessible name while editing. Defaults to the placeholder,
   * which is right for a single field and too vague for one row of several.
   */
  inputLabel?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);
  const cancelled = useRef(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  const button = useRef<HTMLButtonElement>(null);
  /**
   * True when a key closed the editor. The input leaves the page when the
   * editor closes, and focus would fall to the document, so a keyboard user
   * who pressed Escape lost their place. Focus goes back to the value. A
   * blur closes the editor too, and then focus is already somewhere else
   * and stays there.
   */
  const refocus = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (editing || !refocus.current) return;
    refocus.current = false;
    button.current?.focus();
  }, [editing]);
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
            aria-label={inputLabel ?? placeholder}
            aria-invalid={error || undefined}
            aria-busy={saving}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            value={draft}
            readOnly={saving}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              // Focus has moved on, so nothing is handed back to the value.
              refocus.current = false;
              void commit();
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Enter") {
                event.preventDefault();
                refocus.current = true;
                void commit();
              }
              if (event.key === "Escape" && !pending.current) {
                event.preventDefault();
                event.stopPropagation();
                refocus.current = true;
                cancelled.current = true;
                setEditing(false);
                setError(false);
              }
            }}
            className={cn(EDITABLE_INPUT, "min-h-[44px] sm:min-h-0", className)}
            placeholder={placeholder}
          />
          {saving && (
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-label="Saving" />
          )}
        </span>
        {error && (
          <span role="alert" className="text-xs text-error">
            Save failed. Press Enter to retry or Escape to cancel
          </span>
        )}
      </span>
    );
  return (
    <button
      ref={button}
      type="button"
      onClick={begin}
      onKeyDown={(event) => {
        // Enter opens the editor on keydown, as a native button would, and
        // the default is prevented so the click that follows does not run
        // `begin` a second time.
        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          begin();
        }
      }}
      className={cn(
        // hit-area: a role or company in 20 px type is 28 px tall, and the
        // tap box is 44.
        "group/edit hit-area state-layer relative cursor-text text-left inline-flex items-center gap-1.5 rounded transition-colors",
        !value && "text-on-surface-variant italic",
        className,
      )}
    >
      <span className="min-w-0 break-words">{value || placeholder}</span>
      {saved ? (
        <Check className="w-3.5 h-3.5 text-success" aria-label="Saved" />
      ) : (
        <EditHint />
      )}
    </button>
  );
}
