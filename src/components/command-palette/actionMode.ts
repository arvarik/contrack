/**
 * The palette's `>` mode, one step at a time.
 *
 * `> note Julian: Left a voicemail` logs a note in one line. Typed in one
 * go it still works, but each part is also a step the palette helps with:
 * after `>` it lists the kinds, after a kind it lists the contacts, and
 * after the colon it shows the row that logs. The mode used to show the
 * same block of syntax help for every partial input, and it picked the
 * first contact whose name held the typed words anywhere.
 *
 * @module components/command-palette/actionMode
 */

export type LogKind = "note" | "call" | "meeting" | "email";

/** The title a logged interaction gets, by kind, from the palette. */
export const LOG_TITLES: Record<LogKind, string> = {
  note: "Quick Note",
  call: "Phone Call",
  meeting: "Meeting summary",
  email: "Email sent",
};

/** The kinds, in the order the palette lists them. */
export const LOG_KINDS: readonly LogKind[] = [
  "note",
  "call",
  "meeting",
  "email",
];

/** Where the typed `>` input stands. */
export type LogStep =
  /** Typing the kind: `>`, `> no`, `> note`. */
  | { step: "kind"; partial: string }
  /** A kind and a space, typing the name: `> note Tyl`. */
  | { step: "contact"; kind: LogKind; partial: string }
  /** A name and a colon, typing the text: `> note Tyler: Sent the deck`. */
  | { step: "text"; kind: LogKind; name: string; text: string };

const KIND_AND_REST = /^>\s*(note|call|meeting|email)\s+(.*)$/i;

/** Read the `>` input. Call it only in `>` mode. */
export function parseLogInput(input: string): LogStep {
  const match = input.trimStart().match(KIND_AND_REST);
  if (!match) {
    return { step: "kind", partial: input.trim().replace(/^>\s*/, "") };
  }
  const kind = match[1].toLowerCase() as LogKind;
  const rest = match[2];
  const colon = rest.indexOf(":");
  if (colon === -1) return { step: "contact", kind, partial: rest.trim() };
  return {
    step: "text",
    kind,
    name: rest.slice(0, colon).trim(),
    text: rest.slice(colon + 1).trim(),
  };
}

interface Named {
  name: string;
}

/**
 * The contact a typed name means: the whole name, else the first name that
 * starts with the words, else the first that holds them.
 */
export function findLogContact<T extends Named>(
  contacts: readonly T[],
  typed: string,
): T | undefined {
  const words = typed.trim().toLowerCase();
  if (!words) return undefined;
  const name = (c: T) => c.name?.toLowerCase() ?? "";
  return (
    contacts.find((c) => name(c) === words) ??
    contacts.find((c) => name(c).startsWith(words)) ??
    contacts.find((c) => name(c).includes(words))
  );
}

/**
 * The contacts to offer for a partly typed name: the names that start with
 * the words, then the names that hold them, at most `limit`.
 */
export function logContactSuggestions<T extends Named>(
  contacts: readonly T[],
  typed: string,
  limit = 6,
): T[] {
  const words = typed.trim().toLowerCase();
  if (!words) return contacts.slice(0, limit);
  const name = (c: T) => c.name?.toLowerCase() ?? "";
  const starts = contacts.filter((c) => name(c).startsWith(words));
  const holds = contacts.filter(
    (c) => !name(c).startsWith(words) && name(c).includes(words),
  );
  return [...starts, ...holds].slice(0, limit);
}
