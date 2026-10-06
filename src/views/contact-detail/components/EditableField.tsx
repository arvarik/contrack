import { useState, useRef, useEffect } from "react";
import { Check, Loader2, Pencil } from "lucide-react";
import { cn, errorText } from "../../../lib/utils";
import { EDITABLE_INPUT } from "../../../lib/styles";
import { useMediaQuery } from "../../../hooks/useMediaQuery";
import { TOUCH_QUERY } from "../../../lib/platform";

/**
 * The pencil after an editable value. A phone has no hover, so the pencil
 * shows at 40 percent on a coarse pointer and on keyboard focus. Elsewhere
 * it is not drawn at all, because a clear pencil still takes its width.
 * It is sized in `em` to follow the text, and hidden from assistive tech.
 */
export const EditHint = () => (
  <Pencil
    aria-hidden="true"
    data-edit-hint=""
    className={cn(
      "w-[0.55em] h-[0.55em] min-w-3 min-h-3 max-w-5 max-h-5 shrink-0 opacity-40",
      "hidden pointer-coarse:inline-block group-focus-visible/edit:inline-block",
    )}
  />
);

/**
 * The keyboard a phone opens for an email or a phone. Autofill is off: these
 * are another person's details, and autofill offers the owner's own.
 */
export const INPUT_KIND = {
  email: { type: "email", inputMode: "email", autoComplete: "off" },
  tel: { type: "tel", inputMode: "tel", autoComplete: "off" },
} as const;

/**
 * Inline editor that keeps a rejected draft and confirms an async save.
 *
 * At rest the value is a button. In the input, Enter saves and Escape
 * cancels (listed in the "Contact" group of `lib/shortcuts`). With an `href`
 * on a touch screen, the value is a link that calls or writes, and the
 * pencil after it opens the input.
 */
export function EditableField({
  value,
  onSave,
  placeholder,
  className = "",
  inputLabel,
  kind,
  href,
  display,
}: {
  value: string | null;
  /** What shows at rest, when it is not the value: a headline's new part. */
  display?: string;
  /** Resolves to `false` or an `Error` when the save failed. */
  onSave: (value: string) => unknown;
  placeholder: string;
  className?: string;
  /** The input's accessible name. Defaults to the placeholder. */
  inputLabel?: string;
  /** An email or a phone: the input's type, keyboard and autofill. */
  kind?: keyof typeof INPUT_KIND;
  /** Where a tap on the value goes: a `tel:` or a `mailto:` link. */
  href?: string | null;
}) {
  const [editing, setEditing] = useState(false);
  // A link only on a touch screen: a desktop's `tel:` handler can be a
  // softphone prompt, or nothing at all.
  const touch = useMediaQuery(TOUCH_QUERY);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  /** Why the last save failed, from the server when it said: "Name is required". */
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  const button = useRef<HTMLButtonElement>(null);
  /**
   * True when a key closed the editor. Focus then goes back to the value,
   * since the input leaves the page and focus would fall to the document.
   * After a blur, focus is already elsewhere and stays there.
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
    setError(null);
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
    setError(null);
    try {
      const result = onSave(next);
      const completed = await result;
      if (completed instanceof Error) throw completed;
      if (completed === false) throw new Error("Save failed");
      if (mounted.current) {
        setEditing(false);
        setSaved(result instanceof Promise);
      }
    } catch (err) {
      if (mounted.current) {
        setError(errorText(err) || "Could not save");
      }
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
            {...(kind && INPUT_KIND[kind])}
            aria-label={inputLabel ?? placeholder}
            aria-invalid={!!error || undefined}
            aria-busy={saving}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            value={draft}
            readOnly={saving}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
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
                setError(null);
              }
            }}
            className={cn(
              EDITABLE_INPUT,
              "min-h-[44px] sm:pointer-fine:min-h-0",
              className,
            )}
            placeholder={placeholder}
          />
          {saving && (
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-label="Saving" />
          )}
        </span>
        {error && (
          <span role="alert" className="text-xs text-error">
            {error}. Press Enter to retry or Escape to cancel
          </span>
        )}
      </span>
    );
  if (href && value && touch)
    return (
      <span className="inline-flex items-center gap-2 min-w-0 max-w-full">
        <a
          href={href}
          // What the tap does, not only the number.
          aria-label={`${href.startsWith("mailto:") ? "Email" : "Call"} ${value}`}
          className={cn(
            "hit-area min-w-0 rounded underline-offset-2 hover:underline",
            className,
            "text-primary",
          )}
        >
          {value}
        </a>
        {/* Always shown: on a link the pencil is the one way to the input. */}
        <button
          ref={button}
          type="button"
          onClick={begin}
          aria-label={`Edit ${value}`}
          title="Edit"
          className="hit-area state-layer shrink-0 rounded p-1 text-on-surface-variant"
        >
          {saved ? (
            <Check className="w-3.5 h-3.5 text-success" aria-label="Saved" />
          ) : (
            <Pencil aria-hidden="true" className="w-3.5 h-3.5 opacity-70" />
          )}
        </button>
      </span>
    );
  return (
    <button
      ref={button}
      type="button"
      onClick={begin}
      onKeyDown={(event) => {
        // Enter opens on keydown, as a native button does. The default is
        // prevented so the click that follows does not run `begin` twice.
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
      <span className="min-w-0 break-words">
        {display ?? (value || placeholder)}
      </span>
      {saved ? (
        <Check className="w-3.5 h-3.5 text-success" aria-label="Saved" />
      ) : (
        <EditHint />
      )}
    </button>
  );
}
