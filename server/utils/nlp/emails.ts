// Shared mailboxes. A shared email address is the dedupe engine's strongest
// signal: two records with one address are scored 0.98 and merged with nobody
// asked. That holds for a personal address and fails for a shared one: `info@`
// and `team.northwind@` belong to an employer, `haddad.family@` to a household,
// and two contacts on either are two people (in the eval corpus, 15 of the 45
// pairs merged without asking were colleagues on one team alias). So an address
// is classified before it is trusted. A shared mailbox still blocks, since two
// people who share one are worth comparing, and still adds the employer
// booster, but it is no proof of identity.

/**
 * Local parts that name a mailbox rather than a person, matched as the first
 * token only: a surname that is a role word sits second in `mark.sales@`, and a
 * role word that names the mailbox sits first in `sales.uk@`. Short on purpose:
 * every word is one nobody is called, because a false positive costs a real
 * duplicate its identity anchor. Words that are also names ("bill", "art",
 * "guy", "rose") are why this is a list and not a pattern.
 */
const MAILBOX_FIRST_WORDS: ReadonlySet<string> = new Set([
  "abuse",
  "accounts",
  "admin",
  "administrator",
  "billing",
  "careers",
  "contact",
  "contactus",
  "customerservice",
  "enquiries",
  "enquiry",
  "everyone",
  "feedback",
  "finance",
  "frontdesk",
  "general",
  "hello",
  "help",
  "helpdesk",
  "hr",
  "info",
  "inquiries",
  "inquiry",
  "invoices",
  "jobs",
  "legal",
  "mail",
  "mailbox",
  "marketing",
  "media",
  "newsletter",
  "noreply",
  "office",
  "orders",
  "payments",
  "postmaster",
  "press",
  "privacy",
  "recruiting",
  "recruitment",
  "reception",
  "sales",
  "security",
  "service",
  "staff",
  "support",
  "team",
  "webmaster",
]);

/**
 * Words that name a shared mailbox anywhere in the local part.
 * `haddad.family@example.net` puts the household name first, where a
 * first-token rule cannot see it, and a couple sharing an address is common in
 * a contacts app. Neither word is a given name or a surname, which makes
 * reading them anywhere safe, where reading "sales" anywhere would not be.
 */
const MAILBOX_ANY_WORDS: ReadonlySet<string> = new Set(["family", "household"]);

/** Where one local part stops being one word: `team.uk`, `no-reply`, `info+x`. */
const LOCAL_PART_SEPARATORS = /[.\-_+]/g;

/**
 * Whether this address belongs to a group rather than to one person. Three
 * tests, cheapest first: the first token against the mailbox words, every token
 * against the household words, and the local part without separators against
 * the mailbox words, which catches `no-reply` and `no_reply`.
 *
 * @param email - Any address. Case and surrounding space do not matter.
 * @returns True when the address names a mailbox rather than a person.
 */
export function isSharedMailbox(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at <= 0) return false;

  const local = email.slice(0, at).toLowerCase().trim();
  if (local.length === 0) return false;

  const tokens = local.split(LOCAL_PART_SEPARATORS).filter((t) => t.length > 0);
  if (tokens.length === 0) return false;

  if (MAILBOX_FIRST_WORDS.has(tokens[0])) return true;
  if (tokens.some((token) => MAILBOX_ANY_WORDS.has(token))) return true;

  return MAILBOX_FIRST_WORDS.has(tokens.join(""));
}
