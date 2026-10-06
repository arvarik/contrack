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

interface ImportedEmail {
  email: string;
  label?: string;
  isPrimary?: boolean;
}
interface ImportedPhone {
  phone: string;
  label?: string;
  isPrimary?: boolean;
}
interface ImportedAddress {
  address: string;
  label?: string;
  isPrimary?: boolean;
}
interface ImportedSocialLink {
  platform: string;
  url: string;
  handle?: string | null;
}
interface ImportedSource {
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
// same code that produced it, and `tests/unit/shared/vcard.test.ts` walks a
// contact out and back in and compares the fields.
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
 * meant one person's phone was labeled three ways depending on which address
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
  tally?: ImportTally,
): ImportedContact[] => {
  const contacts: ImportedContact[] = [];
  const cards = parseVCards(vcardData);

  for (const card of cards) {
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

  if (tally) tally.skipped += cards.length - contacts.length;
  return contacts;
};

// ===========================================================================
// CSV helpers
// ===========================================================================

type CsvRow = Record<string, string | undefined>;

/** The rows of a CSV that starts with a header line, keyed by the header. */
function readCsv(csvData: string): Promise<CsvRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<CsvRow>(csvData, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => resolve(results.data),
      error: () => reject(new Error("Could not read the CSV file")),
    });
  });
}

/** The first of these columns that holds a value in the row, trimmed. */
function cell(row: CsvRow, ...columns: string[]): string {
  for (const column of columns) {
    const value = row[column]?.trim();
    if (value) return value;
  }
  return "";
}

/**
 * Entries a parser dropped because they had no name. The import counts
 * them, so a file of four cards that saves three says why.
 */
interface ImportTally {
  skipped: number;
}

/** The contacts that the rows make, counting the rows that make none. */
function collect<T>(
  rows: T[],
  toContact: (row: T) => ImportedContact | null,
  tally?: ImportTally,
): ImportedContact[] {
  const contacts: ImportedContact[] = [];
  for (const row of rows) {
    const contact = toContact(row);
    if (contact) contacts.push(contact);
  }
  if (tally) tally.skipped += rows.length - contacts.length;
  return contacts;
}

// ===========================================================================
// LinkedIn CSV Parser
// Columns: First Name, Last Name, URL, Email Address, Company, Position, Connected On
// ===========================================================================
export const parseLinkedInCSV = async (
  csvData: string,
  tally?: ImportTally,
): Promise<ImportedContact[]> => {
  // LinkedIn puts a few lines of notes before the real header row.
  const lines = csvData.split("\n");
  const headerIndex = Math.max(
    0,
    lines.findIndex(
      (line) => line.includes("First Name") && line.includes("Last Name"),
    ),
  );
  const rows = await readCsv(lines.slice(headerIndex).join("\n"));
  return collect(
    rows,
    (row) => {
      const firstName = cell(row, "First Name");
      const lastName = cell(row, "Last Name");
      const name = `${firstName} ${lastName}`.trim();
      if (!name) return null;

      const email = cell(row, "Email Address");
      const profileUrl = cell(row, "URL");
      return {
        name,
        firstName: firstName || null,
        lastName: lastName || null,
        company: cell(row, "Company") || null,
        role: cell(row, "Position") || null,
        emails: email ? [{ email, label: "work", isPrimary: true }] : [],
        socialLinks: profileUrl
          ? [{ platform: "linkedin", url: profileUrl }]
          : [],
        sources: [
          {
            platform: "linkedin",
            externalId: profileUrl || null,
            connectedOn: cell(row, "Connected On") || null,
            rawData: JSON.stringify(row),
          },
        ],
        _sourcePlatform: "linkedin",
      };
    },
    tally,
  );
};

// ===========================================================================
// Facebook JSON Parser
// Input: friends_v2 JSON array with [{ name, timestamp }] structure
// ===========================================================================
interface FacebookFriend {
  name?: string;
  timestamp?: number;
}

/** The friends array of a Facebook export, wherever the export put it. */
function facebookFriends(data: unknown): FacebookFriend[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const record = data as Record<string, unknown>;
  for (const key of ["friends_v2", "friends", ...Object.keys(record)]) {
    const value = record[key];
    if (
      Array.isArray(value) &&
      value.length > 0 &&
      typeof value[0] === "object" &&
      value[0] !== null &&
      "name" in value[0]
    ) {
      return value;
    }
  }
  return [];
}

export const parseFacebookJSON = (
  jsonData: string,
  tally?: ImportTally,
): ImportedContact[] => {
  let data: unknown;
  try {
    data = JSON.parse(jsonData);
  } catch {
    throw new Error(
      "Could not read the Facebook file. Choose the friends file from the export",
    );
  }
  const friends = facebookFriends(data);
  if (friends.length === 0) {
    throw new Error(
      'Could not find friends in the file. Expected a "friends_v2" or "friends" list',
    );
  }

  return collect(
    friends,
    (friend) => {
      if (!friend.name) return null;
      // Facebook writes names as UTF-8 bytes in \u escapes.
      let name = friend.name;
      try {
        name = decodeURIComponent(escape(friend.name));
      } catch {
        /* keep the name as it is */
      }
      return {
        name,
        sources: [
          {
            platform: "facebook",
            connectedOn: friend.timestamp
              ? new Date(friend.timestamp * 1000).toISOString().split("T")[0]
              : null,
            rawData: JSON.stringify(friend),
          },
        ],
        _sourcePlatform: "facebook",
      };
    },
    tally,
  );
};

// ===========================================================================
// Google Contacts CSV Parser
// ===========================================================================
// Google has written two sets of column names. The current export (2024 on)
// has "First Name", "Last Name", "Organization Name" and "E-mail 1 - Label".
// The older one has "Name", "Given Name", "Family Name", "Organization 1 -
// Name" and "E-mail 1 - Type". Both are read, so a file from either works.
// A cell can hold two values of one label joined by " ::: ", and a label
// that starts with "* " marks the primary value.
// ===========================================================================

/** "* Home" → "home". The star is Google's mark for the primary value. */
function googleLabel(raw: string, fallback: string): string {
  return (
    raw
      .replace(/^\*\s*/, "")
      .trim()
      .toLowerCase() || fallback
  );
}

/** The values of one cell, which Google joins with " ::: ". */
function googleValues(raw: string): string[] {
  return raw
    .split(":::")
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * Every value of a numbered field ("E-mail 1 - Value", "Phone 2 - Value"),
 * with its label, in column order. `prefixes` are the names the two export
 * versions give the field.
 */
function googleEntries(
  row: CsvRow,
  prefixes: string[],
  fallbackLabel: string,
): { value: string; label: string }[] {
  const entries: { value: string; label: string }[] = [];
  for (let i = 1; ; i++) {
    const columns = prefixes.map((prefix) => `${prefix} ${i} -`);
    if (!columns.some((column) => `${column} Value` in row)) break;
    const label = googleLabel(
      cell(row, ...columns.flatMap((c) => [`${c} Label`, `${c} Type`])),
      fallbackLabel,
    );
    for (const value of googleValues(
      cell(row, ...columns.map((c) => `${c} Value`)),
    )) {
      entries.push({ value, label });
    }
  }
  return entries;
}

/** The addresses of a row, from "Formatted" or else from its parts. */
function googleAddresses(row: CsvRow): ImportedAddress[] {
  const addresses: ImportedAddress[] = [];
  for (
    let i = 1;
    `Address ${i} - Street` in row || `Address ${i} - Formatted` in row;
    i++
  ) {
    const at = (part: string) => cell(row, `Address ${i} - ${part}`);
    const address =
      at("Formatted").replace(/\n/g, ", ") ||
      [
        at("Street"),
        at("City"),
        [at("Region"), at("Postal Code")].filter(Boolean).join(" "),
        at("Country"),
      ]
        .filter(Boolean)
        .join(", ");
    if (!address) continue;
    addresses.push({
      address,
      label: googleLabel(
        cell(row, `Address ${i} - Label`, `Address ${i} - Type`),
        "home",
      ),
      isPrimary: addresses.length === 0,
    });
  }
  return addresses;
}

export const parseGoogleCSV = async (
  csvData: string,
  tally?: ImportTally,
): Promise<ImportedContact[]> => {
  const rows = await readCsv(csvData);
  return collect(
    rows,
    (row) => {
      const firstName = cell(row, "First Name", "Given Name");
      const lastName = cell(row, "Last Name", "Family Name");
      const company = cell(row, "Organization Name", "Organization 1 - Name");
      const name =
        cell(row, "Name") ||
        [firstName, cell(row, "Middle Name", "Additional Name"), lastName]
          .filter(Boolean)
          .join(" ") ||
        cell(row, "File As", "Nickname") ||
        company;
      if (!name) return null;

      const emails: ImportedEmail[] = googleEntries(
        row,
        ["E-mail", "Email"],
        "personal",
      ).map(({ value, label }, i) => ({
        email: value,
        label,
        isPrimary: i === 0,
      }));
      const phones: ImportedPhone[] = googleEntries(
        row,
        ["Phone"],
        "mobile",
      ).map(({ value, label }, i) => ({
        phone: value,
        label,
        isPrimary: i === 0,
      }));
      const addresses = googleAddresses(row);
      // Google's own groups ("* myContacts", "* starred") are not tags.
      const tags = googleValues(cell(row, "Labels", "Group Membership")).filter(
        (label) => !label.startsWith("*"),
      );

      return {
        name,
        firstName: firstName || null,
        lastName: lastName || null,
        company: company || null,
        role: cell(row, "Organization Title", "Organization 1 - Title") || null,
        location: addresses[0]?.address ?? null,
        birthday: cell(row, "Birthday") || null,
        about: cell(row, "Notes") || null,
        website: googleEntries(row, ["Website"], "website")[0]?.value ?? null,
        emails,
        phones,
        addresses,
        tags,
        sources: [{ platform: "google" }],
        _sourcePlatform: "google",
      };
    },
    tally,
  );
};

// ===========================================================================
// Generic CSV Parser (fallback)
// ===========================================================================
export const parseGenericCSV = async (
  csvData: string,
  sourceName: string,
  tally?: ImportTally,
): Promise<ImportedContact[]> => {
  const rows = await readCsv(csvData);
  return collect(
    rows,
    (row) => {
      const name = cell(row, "Name", "name", "Full Name");
      if (!name || name === "Unknown") return null;
      const email = cell(row, "Email", "email", "Email Address");
      const phone = cell(row, "Phone", "phone", "Phone Number");
      return {
        name,
        company: cell(row, "Company", "company") || null,
        role: cell(row, "Role", "Title", "Position") || null,
        emails: email ? [{ email, label: "personal", isPrimary: true }] : [],
        phones: phone ? [{ phone, label: "mobile", isPrimary: true }] : [],
        sources: [{ platform: sourceName }],
        _sourcePlatform: sourceName,
      };
    },
    tally,
  );
};

// ===========================================================================
// One file in, contacts out
// ===========================================================================

/** The sources the Import tabs offer. */
export type ImportSource = "apple" | "linkedin" | "google" | "facebook";

/** The file types each source's export comes in. */
export const SOURCE_FILES: Record<
  ImportSource,
  { accept: string; label: string }
> = {
  apple: { accept: ".vcf", label: "vCard (.vcf)" },
  linkedin: { accept: ".csv", label: "CSV (.csv)" },
  google: { accept: ".csv", label: "CSV (.csv)" },
  facebook: { accept: ".json", label: "JSON (.json)" },
};

/** What a file held: the contacts, and the entries with no name. */
interface ParsedImport {
  contacts: ImportedContact[];
  skipped: number;
}

/**
 * Read one chosen file with the parser its type and source call for. The
 * type is the file name's extension in any case, so "Contacts.VCF" is a
 * vCard. Throws an Error a person can read when the file does not fit.
 */
export async function parseImportFile(
  fileName: string,
  text: string,
  source: ImportSource,
): Promise<ParsedImport> {
  const tally: ImportTally = { skipped: 0 };
  const extension = fileName.toLowerCase().split(".").pop();
  let contacts: ImportedContact[];
  if (extension === "vcf") {
    contacts = parseVCard(text, "apple", tally);
  } else if (extension === "csv") {
    contacts =
      source === "linkedin"
        ? await parseLinkedInCSV(text, tally)
        : source === "google"
          ? await parseGoogleCSV(text, tally)
          : await parseGenericCSV(text, source, tally);
  } else if (extension === "json" && source === "facebook") {
    contacts = parseFacebookJSON(text, tally);
  } else if (extension === "json") {
    throw new Error("Only a Facebook export can be a .json file");
  } else {
    throw new Error("Choose a .vcf, .csv or .json file");
  }
  if (contacts.length === 0) {
    throw new Error(
      tally.skipped === 1
        ? "The one entry in the file has no name"
        : tally.skipped > 1
          ? `None of the ${tally.skipped} entries in the file has a name`
          : "Could not find any contacts in the file",
    );
  }
  return { contacts, skipped: tally.skipped };
}
