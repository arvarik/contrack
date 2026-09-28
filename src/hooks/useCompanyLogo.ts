import { useMemo } from "react";

const GENERIC_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "msn.com",
  "live.com",
  "protonmail.com",
  "zoho.com",
  "yandex.com",
]);

const guessDomainFromCompany = (name: string) => {
  let cleaned = name.toLowerCase().trim();

  // 1. Remove common business suffixes completely
  cleaned = cleaned.replace(
    /\b(inc|llc|corp|corporation|ltd|co|limited|group|holdings|platforms|technologies)\b.*/gi,
    "",
  );

  // 2. The most powerful heuristic: just take the very first word!
  // "Amazon Web Services" -> "amazon"
  // "Dell Technologies" -> "dell"
  // "Meta Platforms" -> "meta"
  cleaned = cleaned.split(/[\s,.-]+/)[0];

  // 3. Remove any remaining non-alphanumeric chars
  cleaned = cleaned.replace(/[^a-z0-9]/g, "");

  return cleaned.length > 1 ? `${cleaned}.com` : null;
};

/**
 * Extracts a business domain from an email address or guesses it from the company name,
 * returning our local proxy URL (which fetches from Google S2 Favicons).
 *
 * @param email The contact's email address
 * @param companyName The contact's company name
 * @returns An object with the logoUrl and the resolved domain for cache tracking, or null.
 */
export function useCompanyLogo(
  email: string | null | undefined,
  companyName?: string | null | undefined,
): { url: string; domain: string } | null {
  return useMemo(() => {
    let domain: string | null = null;

    // Strategy 1: Extract exact domain from business email
    if (email) {
      try {
        const parts = email.split("@");
        if (parts.length === 2) {
          const d = parts[1].toLowerCase().trim();
          if (!GENERIC_DOMAINS.has(d) && d.includes(".")) {
            domain = d;
          }
        }
      } catch {}
    }

    // Strategy 2: Clever heuristic to guess domain from company name
    if (!domain && companyName) {
      domain = guessDomainFromCompany(companyName);
    }

    if (!domain) return null;

    // No failure cache here. The server keeps one on disk (a domain with no
    // logo is asked again after 30 days), and it asks Google's favicon
    // service at most once per domain, so the browser never contacts Google.

    return {
      url: `/api/logos/${domain}`,
      domain,
    };
  }, [email, companyName]);
}
