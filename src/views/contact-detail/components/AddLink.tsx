/**
 * AddLink: "+ link" at the end of the contact header's meta line.
 *
 * The meta line shows a contact's links, and each link has a menu to copy
 * or remove it, but a new link could only arrive with an import or an
 * enrichment. "+ link" adds one where the links are, the way "+ tag" adds a
 * tag (`ChipInput`):
 *
 * 1. It is a button with the "+ tag" look (`ADD_BUTTON_SMALL`), named "Add
 *    link". It is an action, not a fact, so no middle dot comes before it:
 *    the dots separate facts. The narrow header draws the plus alone, as it
 *    draws each link as its icon alone, with the words in the name and the
 *    tooltip.
 * 2. Pressed, it becomes a field in its place, "Paste a link". Enter adds the
 *    link and closes the field. Escape closes it. Leaving the field with
 *    text adds the text, and leaving it empty closes it.
 * 3. The text is tidied before it is saved (`normaliseLink`): trimmed, with
 *    `https://` in front when it has no scheme, and it has to read as a web
 *    address whose host has a dot. A link the contact already has, in any
 *    spelling (with `www.` or without, a trailing slash or not, http or
 *    https), is refused (`linkKey`). A refusal says why beside the field,
 *    as an inline edit on this page does, and the field stays open with the
 *    text in it, so nothing typed is lost.
 * 4. Focus never falls to the page. After Enter or Escape it goes back to
 *    "+ link", which keeps its place while the new link arrives before it.
 *    After a click somewhere else it stays where the click put it.
 *
 * The component does not save. It calls `onAdd` with the tidied URL, and the
 * header writes it. The platform and the handle are the server's to work out
 * (`detectPlatformFromUrl`), so the link arrives with its icon.
 *
 * @module views/contact-detail/components/AddLink
 */
import { useEffect, useId, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "../../../lib/utils";
import { ADD_BUTTON_SMALL, ADD_FIELD } from "../../../lib/styles";

/**
 * A scheme: letters before the first colon, with no dot, so that
 * "example.com:8080" reads as a host and a port and not as a scheme.
 */
const SCHEME = /^[a-z][a-z\d+-]*:/i;

/** The text as a URL, with `https://` in front when it has no scheme. */
const withScheme = (text: string) =>
  SCHEME.test(text) ? text : `https://${text}`;

/**
 * The text as a link to save, or null when it is not a web address.
 *
 * Trimmed, and with `https://` in front when there is no scheme, the way a
 * person pastes "github.com/ada". Refused: text with a space in it, a scheme
 * other than http or https, a user name or password in the address, and a
 * host with no dot inside it ("localhost", "ada"). The rest of the text is
 * kept as it was written: the browser's own form would lowercase the host
 * and turn a name like "bücher.de" into "xn--bcher-kva.de", and that is not
 * what the person pasted.
 */
export function normaliseLink(text: string): string | null {
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
 * What makes two links the same link: the host without `www.`, the path
 * without a trailing slash, and the query. Not the scheme and not the
 * fragment, which do not change where a link goes for a person. The path
 * keeps its case, because on most sites it matters. Text that is not a URL
 * compares as itself, trimmed and in lower case.
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

/** What the field says when it refuses the text. */
export const NOT_A_LINK = "That is not a web address.";
export const ALREADY_LINKED = "This contact already has that link.";

export interface AddLinkProps {
  /** The links the contact has now, and its website: a new link must differ. */
  links: readonly string[];
  /** Called with the tidied URL of a new link. */
  onAdd: (url: string) => void;
  /** The narrow header's form: the plus alone, with the words in the name. */
  iconOnly?: boolean;
}

export const AddLink = ({ links, onAdd, iconOnly = false }: AddLinkProps) => {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const errorId = useId();
  /** True when a key closed the field: focus then goes back to "+ link". */
  const refocus = useRef(false);
  /**
   * True from the moment the field starts to close. A browser that fires a
   * blur on the field as it leaves the page would otherwise save the text a
   * second time, or save text that Escape threw away.
   */
  const closing = useRef(false);

  useEffect(() => {
    if (adding || !refocus.current) return;
    refocus.current = false;
    button.current?.focus();
  }, [adding]);

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
    const link = normaliseLink(draft);
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
        // 4 px on top of the line's gap: the last link's menu button is a
        // 44 px tap box too, and two such boxes keep 12 px apart, or the
        // later one takes taps aimed at the first. The plus alone is a
        // 24 px square: the smallest target that needs no spacing rule
        // (WCAG 2.5.8), and narrow enough to stay on a phone's meta line
        // after a link and its menu. It overhangs the line by a pixel above
        // and below, so it does not make the line taller than its links.
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
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
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
        // A web address is longer than a tag, so the field is wider than
        // "+ tag"'s. The heights and the text sizes are the same.
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
