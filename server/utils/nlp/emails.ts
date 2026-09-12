// =============================================================================
// Shared mailboxes
// =============================================================================
// A shared email address is the strongest signal the dedupe engine has. Two
// records that carry one address are one person, so the engine scores that
// pair at 0.98 and merges it with nobody asked.
//
// That holds for a personal address and fails for a shared one. `info@` and
// `team.northwind@` belong to an employer, and `haddad.family@` belongs to a
// household. Two contacts recorded against either are two people. The eval
// corpus measured the cost: 15 of the 45 pairs the engine merged without
// asking were two colleagues on one team alias.
//
// So an address is classified before it is trusted. A shared mailbox still
// blocks, because two people who share one are worth comparing, and it still
// adds the employer booster, because it does say something. It stops being
// proof of one identity.
// =============================================================================

/**
 * Local parts that name a mailbox rather than a person.
 *
 * Matched as the FIRST token only. A surname that happens to be a role word
 * sits second in `mark.sales@`, and a role word that names the mailbox sits
 * first in `sales.uk@`, so the position is what separates them.
 *
 * Deliberately short. Every word here is one that nobody is called, because a
 * false positive costs a real duplicate its identity anchor. Words that are
 * also names ("bill", "art", "guy", "rose") are the reason this is a list and
 * not a pattern.
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
 * Words that name a shared mailbox wherever they appear in the local part.
 *
 * `haddad.family@example.net` is a household address and the household name
 * comes first, so a first-token rule cannot see it. A couple sharing one
 * address is the ordinary case in a contacts application, more common than
 * two colleagues sharing a team alias.
 *
 * Two words only. Neither is a given name or a surname in any position, which
 * is what makes reading them anywhere safe when reading "sales" anywhere
 * would not be.
 */
const MAILBOX_ANY_WORDS: ReadonlySet<string> = new Set(["family", "household"]);

/** Where one local part stops being one word: `team.uk`, `no-reply`, `info+x`. */
const LOCAL_PART_SEPARATORS = /[.\-_+]/g;

/**
 * Whether this address belongs to a group rather than to one person.
 *
 * Three tests, in the order they are cheap: the first token against the
 * mailbox words, every token against the two household words, and the local
 * part with its separators removed against the mailbox words, which is what
 * catches `noreply` spelled `no-reply` or `no_reply`.
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
