/**
 * The import parsers: a vCard, a LinkedIn or Google CSV, a Facebook JSON
 * export, or a generic CSV, turned into contacts for `/api/contacts/bulk`.
 */
import Papa from "papaparse";
import { extractVCardContacts } from "../../shared/vcard";

// The parsers' output: the shape POSTed to /api/contacts/bulk

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

export const parseVCard = (
  vcardData: string,
  sourcePlatform: string,
  tally?: ImportTally,
): ImportedContact[] => {
  const { contacts, totalCards } = extractVCardContacts(vcardData);
  if (tally) tally.skipped += totalCards - contacts.length;
  return contacts.map(({ uid: _uid, ...c }) => ({
    ...c,
    sources: [{ platform: sourcePlatform }],
    _sourcePlatform: sourcePlatform,
  }));
};

// CSV helpers

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

// LinkedIn CSV: First Name, Last Name, URL, Email Address, Company,
// Position, Connected On
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

// Facebook JSON: the friends_v2 array of `{ name, timestamp }`
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

// Google Contacts CSV, in both sets of column names: the current export
// ("First Name", "Organization Name", "E-mail 1 - Label") and the older one
// ("Given Name", "Organization 1 - Name", "E-mail 1 - Type"). A cell can hold
// two values joined by " ::: ", and a label that starts with "* " marks the
// primary value.

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

// Generic CSV, the fallback
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

// One file in, contacts out

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
