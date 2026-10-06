/**
 * What a merge does to the contacts in it, worked out before it runs.
 *
 * A person choosing whether to merge asks "what will I lose?". The answer
 * follows the server's merge (server/services/dedupe/merging.ts):
 *
 * - The contact kept keeps its own value in every field. A field it has
 *   empty takes the first value the others have, in the order they merge.
 * - Every other value in such a field is not kept. Undo brings it back.
 * - Emails, phones, profile links and tags join the kept contact's, each
 *   once. Notes, follow-ups and list places move over whole.
 *
 * The review row, the contact page's banner and the manual merge all show
 * this, so the three say the same thing.
 *
 * @module views/dedupe/utils/mergeOutcome
 */
import type { Contact, SuggestedContact } from "../../../types";

/**
 * A contact as the duplicate screens get it. A suggestion's contacts also
 * count their open follow-ups. A contact from elsewhere, such as the
 * manual merge's list, does not, and none are promised.
 */
export type ReviewContact = SuggestedContact;

/** A field that holds one value, and its name on screen. */
export const SINGLE_FIELDS = [
  { key: "name", label: "Name" },
  { key: "company", label: "Company" },
  { key: "role", label: "Role" },
  { key: "location", label: "City" },
  { key: "birthday", label: "Birthday" },
  { key: "website", label: "Website" },
  { key: "about", label: "About" },
] as const;

export type SingleField = (typeof SINGLE_FIELDS)[number]["key"];

/** One value the merge drops or takes from another contact. */
export interface OutcomeLine {
  field: SingleField;
  label: string;
  value: string;
  /** The name of the contact the value is on now. */
  from: string;
  fromId: string;
}

/** What moves from the other contacts to the one kept. */
export interface Moves {
  emails: number;
  phones: number;
  links: number;
  tags: number;
  notes: number;
  followUps: number;
  lists: number;
}

export interface MergeOutcome {
  /** Values the kept contact replaces with its own. */
  notKept: OutcomeLine[];
  /** Values that fill a field the kept contact has empty. */
  filled: OutcomeLine[];
  moves: Moves;
}

const norm = (value: string | null | undefined) =>
  (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** The last ten digits, as the server compares numbers (`normalizePhone`). */
const phoneKey = (phone: string) => {
  const digits = phone.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
};

const value = (contact: Contact, field: SingleField): string =>
  (contact[field] ?? "").trim();

/**
 * The fields where the contacts hold different values. A field one of them
 * has empty is not a difference: the merge fills it.
 */
export function differingFields(contacts: Contact[]): Set<SingleField> {
  const differing = new Set<SingleField>();
  for (const { key } of SINGLE_FIELDS) {
    const values = new Set(
      contacts.map((c) => norm(value(c, key))).filter(Boolean),
    );
    if (values.size > 1) differing.add(key);
  }
  return differing;
}

/** What merging `others` into `keeper`, in that order, keeps and moves. */
export function mergeOutcome(
  keeper: ReviewContact,
  others: ReviewContact[],
): MergeOutcome {
  const notKept: OutcomeLine[] = [];
  const filled: OutcomeLine[] = [];

  for (const { key, label } of SINGLE_FIELDS) {
    let current = value(keeper, key);
    const dropped = new Set<string>();
    for (const other of others) {
      const theirs = value(other, key);
      if (!theirs) continue;
      if (!current) {
        current = theirs;
        filled.push({
          field: key,
          label,
          value: theirs,
          from: other.name,
          fromId: other.id,
        });
        continue;
      }
      if (norm(theirs) === norm(current) || dropped.has(norm(theirs))) continue;
      dropped.add(norm(theirs));
      notKept.push({
        field: key,
        label,
        value: theirs,
        from: other.name,
        fromId: other.id,
      });
    }
  }

  const emails = new Set((keeper.emails ?? []).map((e) => norm(e.email)));
  const phones = new Set((keeper.phones ?? []).map((p) => phoneKey(p.phone)));
  const links = new Set(
    (keeper.socialLinks ?? []).map(
      (l) => `${norm(l.platform)}::${norm(l.url)}`,
    ),
  );
  const tags = new Set((keeper.tags ?? []).map((t) => norm(t.tag)));
  const lists = new Set((keeper.lists ?? []).map((l) => l.id));
  const moves: Moves = {
    emails: 0,
    phones: 0,
    links: 0,
    tags: 0,
    notes: 0,
    followUps: 0,
    lists: 0,
  };
  /** Count a value the kept contact does not have yet, once. */
  const take = (seen: Set<string>, key: string, kind: keyof Moves) => {
    if (!key || seen.has(key)) return;
    seen.add(key);
    moves[kind]++;
  };

  for (const other of others) {
    for (const e of other.emails ?? []) take(emails, norm(e.email), "emails");
    for (const p of other.phones ?? [])
      take(phones, phoneKey(p.phone), "phones");
    for (const l of other.socialLinks ?? []) {
      take(links, `${norm(l.platform)}::${norm(l.url)}`, "links");
    }
    for (const t of other.tags ?? []) take(tags, norm(t.tag), "tags");
    for (const l of other.lists ?? []) take(lists, l.id, "lists");
    moves.notes += other.interactionCount ?? 0;
    moves.followUps += other.openFollowUpCount ?? 0;
  }

  return { notKept, filled, moves };
}

const NOUNS: Record<keyof Moves, [string, string]> = {
  notes: ["note", "notes"],
  followUps: ["follow-up", "follow-ups"],
  lists: ["list", "lists"],
  emails: ["email", "emails"],
  phones: ["phone number", "phone numbers"],
  links: ["profile link", "profile links"],
  tags: ["tag", "tags"],
};

/**
 * "3 notes, 1 follow-up and 2 lists", with what a person cares about most
 * first, or null when nothing moves.
 */
export function movesSentence(moves: Moves): string | null {
  const parts = (Object.keys(NOUNS) as (keyof Moves)[])
    .filter((kind) => moves[kind] > 0)
    .map((kind) => {
      const [one, many] = NOUNS[kind];
      return `${moves[kind]} ${moves[kind] === 1 ? one : many}`;
    });
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * The contact to keep when nobody has chosen: the most complete one. An
 * uploaded photo counts most, because it is the one thing a person added
 * by hand that a merge cannot fill in.
 */
export function suggestKeeper<T extends Contact>(contacts: T[]): T {
  const score = (c: Contact) =>
    (c.avatarUrl?.startsWith("/uploads/avatars/") ? 100 : c.avatarUrl ? 5 : 0) +
    (c.about ? 5 : 0) +
    (c.role ? 3 : 0) +
    (c.company ? 3 : 0) +
    (c.location ? 2 : 0) +
    (c.emails?.length ?? 0) * 3 +
    (c.phones?.length ?? 0) * 3 +
    (c.socialLinks?.length ?? 0) * 2 +
    (c.tags?.length ?? 0) +
    (c.interactionCount ?? 0);
  return contacts.reduce((best, c) => (score(c) > score(best) ? c : best));
}
