// =============================================================================
// Research identity: which of a contact's details help research find them
// =============================================================================
// One set of rules for the research prompt and for the dossier's advice when
// research found no page: an email only at an employer's domain, and a place
// only when it names a city, not a street.
// =============================================================================

/** Common free-email domains that offer zero disambiguation signal. */
const FREE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "aol.com",
  "protonmail.com",
  "live.com",
  "mail.com",
  "zoho.com",
  "yandex.com",
]);

/** The email's domain when it names an employer, else null. */
export function workEmailDomain(
  email: string | null | undefined,
): string | null {
  const domain = email?.split("@")[1]?.trim().toLowerCase();
  return domain && domain.includes(".") && !FREE_EMAIL_DOMAINS.has(domain)
    ? domain
    : null;
}

/**
 * Whether an address names a place, such as "San Francisco, CA", and not a
 * street. An address with a digit in it, a house number or a postcode, is
 * not a place: home addresses are private, and research's words can reach a
 * web search.
 */
function isPlaceText(text: string | null | undefined): boolean {
  const place = text?.trim();
  return !!place && place.length <= 80 && !/\d/.test(place);
}

/**
 * The place among a contact's addresses: the primary address when it names
 * a place, else the first other address that does. A city a person adds
 * after a street address still counts, and the street never does.
 */
export function placeFromAddresses(
  addresses:
    | readonly { address: string; isPrimary?: boolean | null }[]
    | null
    | undefined,
): string | null {
  const list = addresses ?? [];
  const found = [
    ...list.filter((entry) => entry.isPrimary),
    ...list.filter((entry) => !entry.isPrimary),
  ].find((entry) => isPlaceText(entry.address));
  return found ? found.address.trim() : null;
}
