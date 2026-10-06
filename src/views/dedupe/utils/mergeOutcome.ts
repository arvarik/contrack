/**
 * What a merge will do, worked out before it runs. It must follow the
 * server's merge (server/services/dedupe/merging.ts):
 *
 * - The keeper keeps its own value in every field. An empty field takes the
 *   first value the others have, in merge order. Other values are dropped,
 *   and Undo brings them back.
 * - Emails, phones, profile links and tags join the keeper's, each once.
 *   Notes, follow-ups and list places move over whole.
 */
import type { Contact, SuggestedContact } from "../../../types";

/**
 * A contact on the duplicate screens. Only a suggestion's contacts count
 * their open follow-ups (the manual merge's do not).
 */
export type ReviewContact = SuggestedContact;

const SINGLE_FIELDS = [
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
interface OutcomeLine {
  field: SingleField;
  label: string;
  value: string;
  /** The name of the contact the value is on now. */
  from: string;
  fromId: string;
}

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

/** "3 notes, 1 follow-up and 2 lists", most important first, or null. */
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

/** A name with an initial in it, such as "H. Ishikawa" or "Ada Q". */
const INITIAL = /(^|\s)\p{L}\.?(\s|$)/u;

/**
 * The default keeper: the most complete contact. An uploaded photo counts
 * most, since a merge cannot fill it in. A full name beats an initial.
 */
export function suggestKeeper<T extends Contact>(contacts: T[]): T {
  const score = (c: Contact) =>
    (c.avatarUrl?.startsWith("/uploads/avatars/") ? 100 : c.avatarUrl ? 5 : 0) +
    (INITIAL.test(c.name.trim()) ? 0 : 2) +
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
