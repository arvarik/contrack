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

  // Drop a business suffix and everything after it.
  cleaned = cleaned.replace(
    /\b(inc|llc|corp|corporation|ltd|co|limited|group|holdings|platforms|technologies)\b.*/gi,
    "",
  );

  // The first word: "Amazon Web Services" is "amazon".
  cleaned = cleaned.split(/[\s,.-]+/)[0];

  cleaned = cleaned.replace(/[^a-z0-9]/g, "");

  return cleaned.length > 1 ? `${cleaned}.com` : null;
};

/**
 * The logo for a contact's business domain, from a work email or guessed
 * from the company name, as the local proxy URL and the domain. Null when
 * there is no domain.
 */
export function useCompanyLogo(
  email: string | null | undefined,
  companyName?: string | null | undefined,
): { url: string; domain: string } | null {
  return useMemo(() => {
    let domain: string | null = null;

    // A work email names the domain exactly.
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
