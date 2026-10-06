/**
 * "+ link" at the end of the contact header's meta line, the way "+ tag" adds
 * a tag. No middle dot comes before it: it is an action, and the dots
 * separate facts. Pressed, it becomes a "Paste a link" field. Enter adds,
 * Escape closes, and a blur adds any text. A refusal says why beside the
 * field, and the field keeps the text, so nothing typed is lost. Enter and
 * Escape return focus to "+ link".
 *
 * The component does not save: it calls `onAdd` with the tidied URL, and the
 * server works out the platform (`detectPlatformFromUrl`).
 */
import { useEffect, useId, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "../../../lib/utils";
import { ADD_BUTTON_SMALL, ADD_FIELD } from "../../../lib/styles";
import { scrollBehavior } from "../../../lib/a11y";
import { NO_AUTOCORRECT } from "../../../components/ui/SearchField";

/** A scheme has no dot, so "example.com:8080" reads as a host and a port. */
const SCHEME = /^[a-z][a-z\d+-]*:/i;

const withScheme = (text: string) =>
  SCHEME.test(text) ? text : `https://${text}`;

/**
 * The text as a link to save, or null when it is not a web address. It adds
 * `https://` when there is no scheme, and refuses a space, a scheme other than
 * http or https, a user name or password, and a host with no dot. The text
 * keeps its spelling: `URL.href` would lowercase the host and turn
 * "bücher.de" into "xn--bcher-kva.de".
 */
export function normalizeLink(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const link = withScheme(trimmed);
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (!/^[^.]+(\.[^.]+)+$/.test(url.hostname)) return null;
  return link;
}

/**
 * Two links match on the host without `www.`, the path without a trailing
 * slash, and the query. The scheme and the fragment do not count. The path
 * keeps its case, because on most sites it matters.
 */
export function linkKey(text: string): string {
  const trimmed = text.trim();
  try {
    const url = new URL(withScheme(trimmed));
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return `${host}${url.pathname.replace(/\/+$/, "")}${url.search}`;
  } catch {
    return trimmed.toLowerCase();
  }
}

const NOT_A_LINK = "That is not a web address";
const ALREADY_LINKED = "This contact already has that link";

interface AddLinkProps {
  /** The links the contact has now, and its website: a new link must differ. */
  links: readonly string[];
  onAdd: (url: string) => void;
  /** The narrow header's form: the plus alone, with the words in the name. */
  iconOnly?: boolean;
  /** A new number opens the field and scrolls to it (Research's "Add a link"). */
  openRequest?: number;
  onOpenRequestDone?: () => void;
}

export const AddLink = ({
  links,
  onAdd,
  iconOnly = false,
  openRequest,
  onOpenRequestDone,
}: AddLinkProps) => {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const errorId = useId();
  /** True when a key closed the field: focus then goes back to "+ link". */
  const refocus = useRef(false);
  // Set as the field starts to close, so a blur as it leaves the page does
  // not save the text twice, or save text that Escape threw away.
  const closing = useRef(false);

  useEffect(() => {
    if (adding || !refocus.current) return;
    refocus.current = false;
    button.current?.focus();
  }, [adding]);

  useEffect(() => {
    if (openRequest === undefined) return;
    button.current?.scrollIntoView?.({
      block: "center",
      behavior: scrollBehavior(),
    });
    closing.current = false;
    setError(null);
    setAdding(true);
    onOpenRequestDone?.();
  }, [openRequest, onOpenRequestDone]);

  const open = () => {
    closing.current = false;
    setError(null);
    setAdding(true);
  };

  const close = (byKey: boolean) => {
    closing.current = true;
    refocus.current = byKey;
    setAdding(false);
    setDraft("");
    setError(null);
  };

  /** Adds the text when it is a new link. True when the field may close. */
  const commit = (): boolean => {
    if (!draft.trim()) return true;
    const link = normalizeLink(draft);
    if (!link) {
      setError(NOT_A_LINK);
      return false;
    }
    const key = linkKey(link);
    if (links.some((existing) => linkKey(existing) === key)) {
      setError(ALREADY_LINKED);
      return false;
    }
    onAdd(link);
    return true;
  };

  if (!adding) {
    return (
      <button
        ref={button}
        type="button"
        aria-label="Add link"
        title={iconOnly ? "Add link" : undefined}
        onClick={open}
        // ml-1: two 44 px tap boxes keep 12 px apart, or the later one takes
        // taps aimed at the first. The plus alone is 24 px, the smallest
        // target that needs no spacing rule (WCAG 2.5.8). -my-px keeps the
        // line no taller than its links.
        className={cn(
          ADD_BUTTON_SMALL,
          "ml-1",
          iconOnly && "size-6 p-0 -my-px justify-center",
        )}
      >
        <Plus aria-hidden="true" className="w-3.5 h-3.5" />
        {!iconOnly && "link"}
      </button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0 max-w-full">
      <input
        type="url"
        aria-label="New link"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        placeholder="Paste a link"
        autoComplete="off"
        {...NO_AUTOCORRECT}
        // Opens only after the person pressed "+ link".
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") {
            event.preventDefault();
            if (commit()) close(true);
          } else if (event.key === "Escape") {
            // Handled here: the contact over the map closes on Escape too.
            event.preventDefault();
            event.stopPropagation();
            close(true);
          }
        }}
        onBlur={() => {
          if (closing.current) return;
          if (commit()) close(false);
        }}
        // Wider than the "+ tag" field: a web address is longer than a tag.
        className={cn(ADD_FIELD, "w-56")}
      />
      {error && (
        <span
          id={errorId}
          role="alert"
          className="text-xs font-medium text-error"
        >
          {error}
        </span>
      )}
    </span>
  );
};
