/**
 * Contact Import Parsers — Converts platform-specific data exports into
 * normalized Contrack `Contact` objects.
 *
 * Supported formats:
 * - Apple Contacts (vCard / .vcf)
 * - LinkedIn Connections (CSV)
 * - Facebook Friends (JSON)
 * - Google Contacts (CSV)
 * - Generic CSV (fallback)
 *
 * @module lib/importers
 */
import Papa from "papaparse";
import {
  firstRaw,
  firstValue,
  groupLabel,
  parseVCards,
  splitComponents,
  splitList,
  unescapeValue,
  valuesOf,
  type ParsedVCard,
  type VCardProperty,
} from "../../shared/vcard";

// ===========================================================================
// Parser output types — the wire shape POSTed to /api/contacts/bulk
// ===========================================================================

export interface ImportedEmail {
  email: string;
  label?: string;
  isPrimary?: boolean;
}
export interface ImportedPhone {
  phone: string;
  label?: string;
  isPrimary?: boolean;
}
export interface ImportedAddress {
  address: string;
  label?: string;
  isPrimary?: boolean;
}
export interface ImportedSocialLink {
  platform: string;
  url: string;
  handle?: string | null;
}
export interface ImportedSource {
  platform: string;
  externalId?: string | null;
  connectedOn?: string | null;
  rawData?: string;
}

/** Draft contact produced by the import parsers. */
export interface ImportedContact {
  name: string;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  role?: string | null;
  location?: string | null;
  birthday?: string | null;
  about?: string | null;
  website?: string | null;
  avatarUrl?: string | null;
  emails?: ImportedEmail[];
  phones?: ImportedPhone[];
  addresses?: ImportedAddress[];
  socialLinks?: ImportedSocialLink[];
  sources?: ImportedSource[];
  tags?: string[];
  /** Provenance stamp consumed by the bulk-import endpoint. */
  _sourcePlatform?: string;
}

// ===========================================================================
// Social Profile Helpers
// ===========================================================================

/**
 * Known social platform URL templates. Used to:
 * 1. Resolve incomplete URLs (e.g., GitHub "x-apple:arvarik" → "https://github.com/arvarik")
 * 2. Extract handles from full URLs for display
 */
const SOCIAL_PLATFORM_URLS: Record<string, string> = {
  linkedin: "https://www.linkedin.com/in/{handle}",
  twitter: "https://twitter.com/{handle}",
  github: "https://github.com/{handle}",
  facebook: "https://www.facebook.com/{handle}",
  instagram: "https://www.instagram.com/{handle}",
  youtube: "https://www.youtube.com/@{handle}",
  tiktok: "https://www.tiktok.com/@{handle}",
  mastodon: "https://mastodon.social/@{handle}",
  threads: "https://www.threads.net/@{handle}",
};

/**
 * Resolve a social profile entry into a proper URL and handle.
 * Apple Contacts sometimes stores profiles as:
 * - Full URL: "http://www.linkedin.com/in/arvarik"
 * - Apple-prefixed handle: "x-apple:arvarik"
 * - Just a handle: "arvarik"
 */
function resolveSocialProfile(
  platform: string,
  rawUrl: string,
): { url: string; handle: string | null } {
  const platformKey = platform.toLowerCase();
  let url = rawUrl.trim();
  let handle: string | null = null;

  // Strip "x-apple:" prefix (Apple Contacts uses this for non-URL social handles)
  if (url.startsWith("x-apple:")) {
    url = url.replace("x-apple:", "");
  }

  // If it's already a valid URL, extract the handle from it
  if (url.startsWith("http://") || url.startsWith("https://")) {
    try {
      const parsed = new URL(url);
      // Extract handle from path (e.g., /in/arvarik → arvarik)
      const pathParts = parsed.pathname.split("/").filter(Boolean);
      handle = pathParts[pathParts.length - 1] || null;
    } catch {
      /* not a valid URL, treat as handle */
    }
    return { url, handle };
  }

  // It's a bare handle — construct the full URL from our templates
  handle = url;
  const template = SOCIAL_PLATFORM_URLS[platformKey];
  if (template) {
    url = template.replace("{handle}", handle);
  } else {
    // Unknown platform, keep as-is but note it's not a URL
    url = handle;
  }

  return { url, handle };
}

// ===========================================================================
// vCard (.vcf)
// ===========================================================================
// Apple Contacts, Google Contacts, Outlook, Android, and Contrack's own
// export. One parser, because they all write vCard and the differences between
// them are parameters rather than formats.
//
// The reading is done by `shared/vcard.ts`, which the server also uses to
// WRITE the export. That is deliberate and it is what makes the round trip a
// promise rather than a hope: a file this app produces is parsed back by the
// same code that produced it, and `tests/unit/vcard.test.ts` walks a contact
// out and back in and compares the fields.
//
// This layer is the mapping from vCard properties onto Contrack's shape, and
// it is where the Apple-specific conventions live: `item1.`-grouped properties
// with an `X-ABLabel`, `X-SOCIALPROFILE` with an `x-apple:` handle instead of
// a URL, and a `PHOTO` folded across a dozen lines.
// ===========================================================================

/** Parameters that describe the transport rather than the label. */
const NOISE_TYPES = new Set(["internet", "pref", "voice", "other", "x-apple"]);

/**
 * Names for the same label, folded onto one.
 *
 * Every exporter has its own word for a mobile number — Apple writes IPHONE
 * and CELL, Android writes CELL, Outlook writes MOBILE — and keeping all three
 * meant one person's phone was labelled three ways depending on which address
 * book the file came out of. The app's own vocabulary is "mobile".
 */
const TYPE_ALIASES: Record<string, string> = {
  cell: "mobile",
  iphone: "mobile",
  main: "work",
  homepage: "website",
};

/**
 * The label to show for one property.
 *
 * Apple's grouped `X-ABLabel` wins when there is one — it is the label the
 * person typed. Otherwise the first TYPE that means something: `TYPE=WORK`
 * is a label, `TYPE=INTERNET` and `TYPE=PREF` are plumbing.
 */
function labelFor(
  card: ParsedVCard,
  property: VCardProperty,
  fallback: string,
): string {
  const custom = groupLabel(card, property.group);
  if (custom && custom.toLowerCase() !== "other") return custom.toLowerCase();

  const types = (property.params.TYPE ?? []).map((t) => t.toLowerCase());
  const meaningful = types.find((t) => t && !NOISE_TYPES.has(t));
  if (!meaningful) return fallback;
  return TYPE_ALIASES[meaningful] ?? meaningful;
}

/** True when a property carries `TYPE=PREF`, whichever way it was written. */
function isPreferred(property: VCardProperty): boolean {
  return (property.params.TYPE ?? []).some((t) => /^pref$/i.test(t));
}

/**
 * A readable one-line address from the seven ADR components.
 *
 * ADR is `PO Box;Extended;Street;City;Region;Postal;Country`. Contrack keeps
 * one free-text address, so the components are joined; an address this app
 * exported put everything in the street slot and comes back unchanged.
 */
function joinAddress(value: string): string {
  const [, , street, city, region, postal, country] = splitComponents(value);
  return [
    (street ?? "").replace(/\n/g, ", ").trim(),
    (city ?? "").trim(),
    [(region ?? "").trim(), (postal ?? "").trim()].filter(Boolean).join(" "),
    (country ?? "").trim(),
  ]
    .filter(Boolean)
    .join(", ");
}

export const parseVCard = (
  vcardData: string,
  sourcePlatform: string,
): ImportedContact[] => {
  const contacts: ImportedContact[] = [];

  for (const card of parseVCards(vcardData)) {
    // A card with no name is not a contact anyone can use. FN is required by
    // the specification; N is the fallback for exporters that skip it.
    const nComponents = splitComponents(firstRaw(card, "N") ?? "");
    const lastName = (nComponents[0] ?? "").trim() || null;
    const firstName = (nComponents[1] ?? "").trim() || null;

    const name =
      (firstValue(card, "FN") ?? "").trim() ||
      [firstName, lastName].filter(Boolean).join(" ").trim();
    if (!name) continue;

    // ── Emails ────────────────────────────────────────────────────────────
    const emails: ImportedEmail[] = [];
    for (const property of valuesOf(card, "EMAIL")) {
      const email = unescapeValue(property.value).trim();
      if (!email) continue;
      // The same address twice, in two groups, is one address.
      if (emails.some((e) => e.email.toLowerCase() === email.toLowerCase()))
        continue;
      emails.push({
        email,
        label: labelFor(card, property, "personal"),
        isPrimary: isPreferred(property) || emails.length === 0,
      });
    }

    // ── Phones ────────────────────────────────────────────────────────────
    const phones: ImportedPhone[] = [];
    for (const property of valuesOf(card, "TEL")) {
      const phone = unescapeValue(property.value).trim();
      if (!phone) continue;
      phones.push({
        phone,
        label: labelFor(card, property, "mobile"),
        isPrimary: isPreferred(property) || phones.length === 0,
      });
    }

    // ── Addresses ─────────────────────────────────────────────────────────
    const addresses: ImportedAddress[] = [];
    for (const property of valuesOf(card, "ADR")) {
      const address = joinAddress(property.value);
      if (!address) continue;
      addresses.push({
        address,
        label: labelFor(card, property, "home"),
        isPrimary: isPreferred(property) || addresses.length === 0,
      });
    }

    // ── Social profiles and URLs ──────────────────────────────────────────
    const socialLinks: ImportedSocialLink[] = [];
    for (const property of valuesOf(card, "X-SOCIALPROFILE")) {
      const raw = unescapeValue(property.value).trim();
      if (!raw) continue;
      const platform = (property.params.TYPE?.[0] ?? "other").toLowerCase();
      const resolved = resolveSocialProfile(platform, raw);
      socialLinks.push({
        platform,
        url: resolved.url,
        handle: resolved.handle,
      });
    }

    for (const property of valuesOf(card, "URL")) {
      const url = unescapeValue(property.value).trim();
      if (!url) continue;
      if (socialLinks.some((s) => s.url.toLowerCase() === url.toLowerCase()))
        continue;
      const label = labelFor(card, property, "website");
      socialLinks.push({
        platform: label === "homepage" ? "website" : label,
        url,
        handle: null,
      });
    }

    // ── Photo ─────────────────────────────────────────────────────────────
    // Base64 in 3.0 (`PHOTO;ENCODING=b;TYPE=JPEG:`), a data URI or a plain URL
    // in 4.0. Folding is already undone, so the value is whole either way.
    let avatarUrl: string | null = null;
    const photo = valuesOf(card, "PHOTO")[0];
    if (photo) {
      const value = photo.value.replace(/\s+/g, "");
      if (value.startsWith("data:") || /^https?:/i.test(value)) {
        avatarUrl = value;
      } else if (value) {
        const type = (photo.params.TYPE?.[0] ?? "jpeg").toLowerCase();
        avatarUrl = `data:image/${type};base64,${value}`;
      }
    }

    // ── The rest ──────────────────────────────────────────────────────────
    const org = splitComponents(firstRaw(card, "ORG") ?? "");
    const website =
      socialLinks.find(
        (s) => s.platform === "website" || s.platform === "homepage",
      )?.url ?? null;

    const categories = firstRaw(card, "CATEGORIES");
    const tags = categories
      ? splitList(categories)
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    contacts.push({
      name,
      firstName,
      lastName,
      company: (org[0] ?? "").trim() || null,
      role: (firstValue(card, "TITLE") ?? "").trim() || null,
      birthday: (firstValue(card, "BDAY") ?? "").trim() || null,
      about: (firstValue(card, "NOTE") ?? "").trim() || null,
      location:
        addresses.find((a) => a.isPrimary)?.address ??
        addresses[0]?.address ??
        null,
      website,
      avatarUrl,
      emails,
      phones,
      addresses,
      socialLinks,
      tags,
      sources: [{ platform: sourcePlatform }],
      _sourcePlatform: sourcePlatform,
    });
  }

  return contacts;
};

// ===========================================================================
// LinkedIn CSV Parser
// Columns: First Name, Last Name, URL, Email Address, Company, Position, Connected On
// ===========================================================================
export const parseLinkedInCSV = (
  csvData: string,
): Promise<ImportedContact[]> => {
  return new Promise((resolve, reject) => {
    // LinkedIn CSVs may have introductory lines before the real header
    // Strip any lines before the actual header row
    const lines = csvData.split("\n");
    let headerIndex = lines.findIndex(
      (line) => line.includes("First Name") && line.includes("Last Name"),
    );
    if (headerIndex === -1) headerIndex = 0;
    const cleanedCSV = lines.slice(headerIndex).join("\n");

    Papa.parse<Record<string, string | undefined>>(cleanedCSV, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const parsed = results.data
            .map((row) => {
              const firstName = (row["First Name"] || "").trim();
              const lastName = (row["Last Name"] || "").trim();
              const fullName = `${firstName} ${lastName}`.trim();
              if (!fullName) return null;

              const email = (row["Email Address"] || "").trim();
              const company = (row["Company"] || "").trim();
              const position = (row["Position"] || "").trim();
              const profileUrl = (row["URL"] || "").trim();
              const connectedOn = (row["Connected On"] || "").trim();

              const emails: ImportedEmail[] = email
                ? [{ email, label: "work", isPrimary: true }]
                : [];
              const socialLinks: ImportedSocialLink[] = profileUrl
                ? [{ platform: "linkedin", url: profileUrl }]
                : [];

              return {
                name: fullName,
                firstName: firstName || null,
                lastName: lastName || null,
                company: company || null,
                role: position || null,
                emails,
                socialLinks,
                sources: [
                  {
                    platform: "linkedin",
                    externalId: profileUrl || null,
                    connectedOn: connectedOn || null,
                    rawData: JSON.stringify(row),
                  },
                ],
                _sourcePlatform: "linkedin",
              } satisfies ImportedContact;
            })
            .filter((c): c is NonNullable<typeof c> => c !== null);

          resolve(parsed);
        } catch {
          reject(new Error("Failed to parse LinkedIn CSV structure."));
        }
      },
      error: () => reject(new Error("Failed to read CSV file.")),
    });
  });
};

// ===========================================================================
// Facebook JSON Parser
// Input: friends_v2 JSON array with [{ name, timestamp }] structure
// ===========================================================================
interface FacebookFriend {
  name?: string;
  timestamp?: number;
}

export const parseFacebookJSON = (jsonData: string): ImportedContact[] => {
  try {
    const data = JSON.parse(jsonData);

    // Facebook exports come in various structures
    // Common: { friends_v2: [{ name, timestamp }] }
    // Or: [{ name, timestamp }]
    let friends: FacebookFriend[] = [];

    if (data.friends_v2) {
      friends = data.friends_v2;
    } else if (data.friends) {
      friends = data.friends;
    } else if (Array.isArray(data)) {
      friends = data;
    } else {
      // Try to find any array of objects with a 'name' field
      for (const key of Object.keys(data)) {
        if (
          Array.isArray(data[key]) &&
          data[key].length > 0 &&
          data[key][0].name
        ) {
          friends = data[key];
          break;
        }
      }
    }

    if (friends.length === 0) {
      throw new Error(
        'Could not find friends data in the JSON file. Expected a "friends_v2" or "friends" array.',
      );
    }

    return friends
      .filter((f): f is FacebookFriend & { name: string } => Boolean(f.name))
      .map((f) => {
        // Facebook uses UTF-8 escaped encoding for names
        let name = f.name;
        try {
          name = decodeURIComponent(escape(f.name));
        } catch {
          /* keep original */
        }

        const connectedOn = f.timestamp
          ? new Date(f.timestamp * 1000).toISOString().split("T")[0]
          : null;

        return {
          name,
          sources: [
            {
              platform: "facebook",
              connectedOn,
              rawData: JSON.stringify(f),
            },
          ],
          _sourcePlatform: "facebook",
        } satisfies ImportedContact;
      });
  } catch (e) {
    if ((e instanceof Error ? e.message : String(e)).includes("Could not find"))
      throw e;
    throw new Error(
      "Failed to parse Facebook JSON. Ensure you uploaded the correct friends data file.",
    );
  }
};

// ===========================================================================
// Google Contacts CSV Parser
// Columns: Given Name, Family Name, E-mail 1 - Value, Phone 1 - Value,
//          Organization 1 - Name, Organization 1 - Title, etc.
// ===========================================================================
export const parseGoogleCSV = (csvData: string): Promise<ImportedContact[]> => {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string | undefined>>(csvData, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const parsed = results.data
            .map((row) => {
              const firstName = (row["Given Name"] || "").trim();
              const lastName = (row["Family Name"] || "").trim();
              const fullName = (
                row["Name"] || `${firstName} ${lastName}`
              ).trim();
              if (!fullName) return null;

              // Collect all emails (Google supports E-mail 1, E-mail 2, etc.)
              const emails: ImportedEmail[] = [];
              for (let i = 1; i <= 5; i++) {
                const email = (row[`E-mail ${i} - Value`] || "").trim();
                const type = (
                  row[`E-mail ${i} - Type`] || "personal"
                ).toLowerCase();
                if (email) {
                  emails.push({
                    email,
                    label: type === "*" ? "personal" : type,
                    isPrimary: i === 1,
                  });
                }
              }

              // Collect all phones
              const phones: ImportedPhone[] = [];
              for (let i = 1; i <= 5; i++) {
                const phone = (row[`Phone ${i} - Value`] || "").trim();
                const type = (
                  row[`Phone ${i} - Type`] || "mobile"
                ).toLowerCase();
                if (phone) {
                  phones.push({
                    phone,
                    label: type === "*" ? "mobile" : type,
                    isPrimary: i === 1,
                  });
                }
              }

              const company = (row["Organization 1 - Name"] || "").trim();
              const role = (row["Organization 1 - Title"] || "").trim();
              const location = (row["Address 1 - Formatted"] || "").trim();
              const birthday = (row["Birthday"] || "").trim();
              const notes = (row["Notes"] || "").trim();
              const website = (row["Website 1 - Value"] || "").trim();

              return {
                name: fullName,
                firstName: firstName || null,
                lastName: lastName || null,
                company: company || null,
                role: role || null,
                location: location || null,
                birthday: birthday || null,
                about: notes || null,
                website: website || null,
                emails,
                phones,
                sources: [{ platform: "google" }],
                _sourcePlatform: "google",
              } satisfies ImportedContact;
            })
            .filter((c): c is NonNullable<typeof c> => c !== null);

          resolve(parsed);
        } catch {
          reject(new Error("Failed to parse Google Contacts CSV structure."));
        }
      },
      error: () => reject(new Error("Failed to read CSV file.")),
    });
  });
};

// ===========================================================================
// Generic CSV Parser (fallback)
// ===========================================================================
export const parseGenericCSV = (
  csvData: string,
  sourceName: string,
): Promise<ImportedContact[]> => {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string | undefined>>(csvData, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const parsed = results.data
            .map((row) => {
              const name = row["Name"] || row["name"] || row["Full Name"];
              if (!name || name === "Unknown") return null;

              const email =
                row["Email"] || row["email"] || row["Email Address"] || "";
              const phone =
                row["Phone"] || row["phone"] || row["Phone Number"] || "";

              return {
                name,
                company: row["Company"] || row["company"] || null,
                role: row["Role"] || row["Title"] || row["Position"] || null,
                emails: email
                  ? [{ email, label: "personal", isPrimary: true }]
                  : [],
                phones: phone
                  ? [{ phone, label: "mobile", isPrimary: true }]
                  : [],
                sources: [{ platform: sourceName }],
                _sourcePlatform: sourceName,
              } satisfies ImportedContact;
            })
            .filter((c): c is NonNullable<typeof c> => c !== null);

          resolve(parsed);
        } catch {
          reject(new Error("Failed to parse CSV structure."));
        }
      },
      error: () => reject(new Error("Failed to read CSV file.")),
    });
  });
};
