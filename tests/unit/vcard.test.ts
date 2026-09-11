// =============================================================================
// vCard — the round trip, and the four things that break parsers
// =============================================================================
// The claim this feature makes is not "we can write a .vcf". It is that a file
// this app writes is a file this app reads back with nothing lost, and that a
// file another address book writes is one this app can read. Those are two
// different tests and both are here.
//
// The round trip is the first block and it is the one that matters: contacts
// with the awkward values — a semicolon in a surname, a comma in a company, a
// newline in a note, an emoji, a name long enough to fold — go out through the
// serializer and back in through the importer, and every field is compared.
//
// The rest are the four things that make vCard harder than it looks, each with
// a sample from the exporter that produces it: folding, escaping, the three
// spellings of a parameter, and quoted-printable.
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  escapeValue,
  firstValue,
  foldLine,
  splitDisplayName,
  parseVCards,
  serializeVCard,
  serializeVCards,
  splitComponents,
  unescapeValue,
  valuesOf,
  type VCardInput,
} from "../../shared/vcard";
import { parseVCard } from "../../src/lib/importers";

// ---------------------------------------------------------------------------
// The round trip
// ---------------------------------------------------------------------------

/** Contacts chosen for the values that break a naive implementation. */
const ROUND_TRIP: VCardInput[] = [
  {
    name: "Jane Doe",
    firstName: "Jane",
    lastName: "Doe",
    company: "Acme Corp",
    role: "Staff Engineer",
    birthday: "1986-04-12",
    about: "Met at the conference.",
    website: "https://jane.example.com",
    emails: [
      { email: "jane@acme.com", label: "work", isPrimary: true },
      { email: "jane@personal.com", label: "home", isPrimary: false },
    ],
    phones: [{ phone: "+1 555 123 4567", label: "mobile", isPrimary: true }],
    addresses: [
      {
        address: "222 2nd St, San Francisco, CA 94105",
        label: "work",
        isPrimary: true,
      },
    ],
    socialLinks: [
      { platform: "linkedin", url: "https://www.linkedin.com/in/janedoe" },
    ],
    tags: ["investor", "alumni"],
  },
  {
    // Every character the format gives a meaning to.
    name: "Smith; Jr., Robert \\ III",
    firstName: "Robert",
    lastName: "Smith; Jr.",
    company: "Widgets, Incorporated; a Delaware company",
    role: "VP, Sales",
    about: "First line.\nSecond line, with a comma; and a semicolon.\nThird.",
    emails: [{ email: "rob@widgets.example", label: "work", isPrimary: true }],
    phones: [],
    tags: ["needs, review", "a;b"],
  },
  {
    // Long enough to fold several times, and not ASCII.
    name: "Ana María Gonzáles de la Vega Fernández Rodríguez Hernández",
    firstName: "Ana María",
    lastName: "Gonzáles de la Vega Fernández Rodríguez Hernández",
    company: "Instituto Nacional de Investigación y Desarrollo Tecnológico",
    about:
      "A note long enough that it must be folded across several lines, with an emoji 🎉 in it so that a fold cannot land between the two halves of a surrogate pair.",
    emails: [
      {
        email: "ana.maria@instituto.example.mx",
        label: "work",
        isPrimary: true,
      },
    ],
  },
  {
    // The minimum a contact can be. One word, so nothing is guessed from it.
    name: "Prince",
  },
];

describe("a contact written out and read back", () => {
  const written = serializeVCards(ROUND_TRIP);
  const read = parseVCard(written, "contrack");

  it("produces one card per contact", () => {
    expect(read).toHaveLength(ROUND_TRIP.length);
  });

  it.each(ROUND_TRIP.map((c, i) => [c.name, i] as const))(
    "keeps every field of %s",
    (_name, index) => {
      const before = ROUND_TRIP[index];
      const after = read[index];

      expect(after.name).toBe(before.name);
      expect(after.firstName).toBe(before.firstName ?? null);
      expect(after.lastName).toBe(before.lastName ?? null);
      expect(after.company).toBe(before.company ?? null);
      expect(after.role).toBe(before.role ?? null);
      expect(after.birthday).toBe(before.birthday ?? null);
      expect(after.about).toBe(before.about ?? null);

      expect((after.emails ?? []).map((e) => e.email)).toEqual(
        (before.emails ?? []).map((e) => e.email),
      );
      expect((after.emails ?? []).map((e) => e.label)).toEqual(
        (before.emails ?? []).map((e) => e.label),
      );
      expect((after.phones ?? []).map((p) => p.phone)).toEqual(
        (before.phones ?? []).map((p) => p.phone),
      );
      expect((after.addresses ?? []).map((a) => a.address)).toEqual(
        (before.addresses ?? []).map((a) => a.address),
      );
      expect((after.socialLinks ?? []).map((s) => s.url)).toEqual(
        expect.arrayContaining((before.socialLinks ?? []).map((s) => s.url)),
      );
      expect(after.tags ?? []).toEqual(before.tags ?? []);
    },
  );

  it("keeps the primary flag on the value it belonged to", () => {
    const jane = read[0];
    expect(jane.emails?.[0]).toMatchObject({
      email: "jane@acme.com",
      isPrimary: true,
    });
    expect(jane.emails?.[1]?.isPrimary).toBe(false);
  });

  it("writes a file another address book will accept", () => {
    // Every card is a complete BEGIN/VERSION/N/FN/END, CRLF-terminated. An
    // exporter that omits VERSION or N produces a file Apple Contacts opens as
    // zero contacts and says nothing about.
    expect(written.split("BEGIN:VCARD")).toHaveLength(ROUND_TRIP.length + 1);
    expect(written.split("END:VCARD")).toHaveLength(ROUND_TRIP.length + 1);
    expect(written).toContain("VERSION:3.0");
    expect(written).toMatch(/\r\n/);
    expect(written).not.toMatch(/[^\r]\n/);
    for (const line of written.split("\r\n")) {
      expect(line.length, line).toBeLessThanOrEqual(76);
    }
  });

  it("survives being written, read and written again unchanged", () => {
    // The strongest form of the promise: the second file is byte-identical to
    // the first, so nothing drifts with each pass through the app.
    const again = serializeVCards(
      read.map((c) => ({
        name: c.name,
        firstName: c.firstName,
        lastName: c.lastName,
        company: c.company,
        role: c.role,
        birthday: c.birthday,
        about: c.about,
        website: c.website,
        emails: c.emails,
        phones: c.phones,
        addresses: c.addresses,
        socialLinks: (c.socialLinks ?? []).filter(
          (s) => s.platform !== "website",
        ),
        tags: c.tags,
      })),
    );
    expect(again).toBe(written);
  });
});

// ---------------------------------------------------------------------------
// Guessing a structured name
// ---------------------------------------------------------------------------

describe("splitDisplayName", () => {
  // A contact added by hand has one name field, so without this every export
  // carries `N:;;;;` and lands in another address book filed under nothing.

  it.each([
    ["Ada Lovelace", { given: "Ada", family: "Lovelace", suffix: "" }],
    ["José García", { given: "José", family: "García", suffix: "" }],
    [
      "Ana María Gonzáles de la Vega",
      { given: "Ana María Gonzáles de la", family: "Vega", suffix: "" },
    ],
    ["Lovelace, Ada", { given: "Ada", family: "Lovelace", suffix: "" }],
    [
      "Martin Luther King Jr.",
      { given: "Martin Luther", family: "King", suffix: "Jr." },
    ],
    ["Grace Hopper PhD", { given: "Grace", family: "Hopper", suffix: "PhD" }],
  ])("reads %s", (name, expected) => {
    expect(splitDisplayName(name)).toEqual(expected);
  });

  it.each([
    // One word: there is nothing to split, and guessing would be wrong.
    "Prince",
    // Already carries the format's own separator.
    "Smith; Jr., Robert",
    // Two commas: a title, a suffix, or something this cannot read.
    "King, Martin Luther, Jr.",
    // A suffix and nothing else.
    "Jr.",
    "",
    "   ",
  ])("declines to guess at %j", (name) => {
    expect(splitDisplayName(name)).toEqual({
      given: "",
      family: "",
      suffix: "",
    });
  });

  it("never overrules a name the contact already has", () => {
    const card = serializeVCard({
      name: "Robert Smith",
      firstName: "Bob",
      lastName: "Smith",
    });
    expect(card).toContain("N:Smith;Bob;;;");
  });

  it("writes the suffix in its own component", () => {
    const card = serializeVCard({ name: "Martin Luther King Jr." });
    expect(card).toContain("N:King;Martin Luther;;;Jr.");
  });
});

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

describe("escaping", () => {
  const AWKWARD = [
    "plain",
    "a,b",
    "a;b",
    "a\\b",
    "line\nbreak",
    "everything: \\ ; , \n at once",
    "trailing backslash \\",
    "🎉 emoji",
    "",
  ];

  it.each(AWKWARD)("survives %j", (value) => {
    expect(unescapeValue(escapeValue(value))).toBe(value);
  });

  it("does not cut a structured value inside an escaped semicolon", () => {
    // `N:Smith\; Jr.;Robert;;;` is one surname and one given name, not two
    // surnames. Splitting on a raw semicolon is the bug this prevents.
    const encoded = `${escapeValue("Smith; Jr.")};${escapeValue("Robert")};;;`;
    expect(splitComponents(encoded)).toEqual([
      "Smith; Jr.",
      "Robert",
      "",
      "",
      "",
    ]);
  });

  it("reads an escape an exporter did not need to write", () => {
    expect(unescapeValue("a\\:b")).toBe("a:b");
    expect(unescapeValue("Ada\\NLovelace")).toBe("Ada\nLovelace");
  });
});

// ---------------------------------------------------------------------------
// Folding
// ---------------------------------------------------------------------------

describe("folding", () => {
  it("leaves a short line alone", () => {
    expect(foldLine("FN:Ada")).toBe("FN:Ada");
  });

  it("breaks a long line and marks the continuation", () => {
    const folded = foldLine("NOTE:" + "x".repeat(300));
    const lines = folded.split("\r\n");
    expect(lines.length).toBeGreaterThan(3);
    for (const line of lines.slice(1)) expect(line.startsWith(" ")).toBe(true);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(76);
  });

  it("never splits a surrogate pair", () => {
    // A fold inside an emoji produces a file that is not valid UTF-8, which
    // some readers reject and others render as two replacement characters.
    const folded = foldLine("NOTE:" + "🎉".repeat(80));
    for (const line of folded.split("\r\n")) {
      expect(line).not.toMatch(/[\uD800-\uDBFF]$/);
      expect(line).not.toMatch(/^[\uDC00-\uDFFF]/);
    }
  });

  it("is undone exactly by the parser", () => {
    const note = "y".repeat(500);
    const card = parseVCards(
      `BEGIN:VCARD\r\nVERSION:3.0\r\n${foldLine("NOTE:" + note)}\r\nEND:VCARD\r\n`,
    )[0];
    expect(firstValue(card, "NOTE")).toBe(note);
  });

  it("undoes a tab continuation as well as a space one", () => {
    const card = parseVCards(
      "BEGIN:VCARD\r\nFN:Ada\r\nNOTE:first\r\n\tsecond\r\nEND:VCARD\r\n",
    )[0];
    expect(firstValue(card, "NOTE")).toBe("firstsecond");
  });
});

// ---------------------------------------------------------------------------
// Files from other address books
// ---------------------------------------------------------------------------

describe("files other address books produce", () => {
  it("reads Apple's grouped properties and custom labels", () => {
    const vcf = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "N:Lovelace;Ada;;;",
      "FN:Ada Lovelace",
      "item1.EMAIL;type=INTERNET;type=pref:ada@analytical.example",
      "item1.X-ABLabel:_$!<Work>!$_",
      "item2.TEL;type=pref:+44 20 7946 0000",
      "item2.X-ABLabel:Studio",
      "X-SOCIALPROFILE;type=GitHub:x-apple:adalovelace",
      "END:VCARD",
    ].join("\r\n");

    const [contact] = parseVCard(vcf, "apple");
    expect(contact.emails?.[0]).toMatchObject({
      email: "ada@analytical.example",
      label: "work",
      isPrimary: true,
    });
    expect(contact.phones?.[0]).toMatchObject({ label: "studio" });
    expect(contact.socialLinks?.[0]).toMatchObject({
      platform: "github",
      url: "https://github.com/adalovelace",
      handle: "adalovelace",
    });
  });

  it("reads the vCard 2.1 shorthand a phone still writes", () => {
    // `TEL;WORK;VOICE:` with no `TYPE=` at all. Treating a bare parameter as
    // anything but a TYPE loses the label on every contact from those exports.
    const vcf = [
      "BEGIN:VCARD",
      "VERSION:2.1",
      "N:Hopper;Grace;;;",
      "FN:Grace Hopper",
      "TEL;WORK;VOICE:+1 202 555 0100",
      "EMAIL;HOME;INTERNET:grace@navy.example",
      "END:VCARD",
    ].join("\r\n");

    const [contact] = parseVCard(vcf, "generic");
    expect(contact.phones?.[0]).toMatchObject({ label: "work" });
    expect(contact.emails?.[0]).toMatchObject({ label: "home" });
  });

  it("reads a quoted parameter list", () => {
    const card = parseVCards(
      'BEGIN:VCARD\r\nFN:X\r\nTEL;TYPE="WORK,VOICE":+1 555 0000\r\nEND:VCARD\r\n',
    )[0];
    expect(valuesOf(card, "TEL")[0].params.TYPE).toEqual(["WORK", "VOICE"]);
  });

  it("decodes quoted-printable, as a whole character at a time", () => {
    // `=C3=A9` is two octets of one "é". Decoding each escape separately turns
    // "José" into "JosÃ©", which is the classic symptom of an address book
    // imported from an older phone.
    const vcf = [
      "BEGIN:VCARD",
      "VERSION:2.1",
      "N;ENCODING=QUOTED-PRINTABLE:Garc=C3=ADa;Jos=C3=A9;;;",
      "FN;ENCODING=QUOTED-PRINTABLE:Jos=C3=A9 Garc=C3=ADa",
      "END:VCARD",
    ].join("\r\n");

    const [contact] = parseVCard(vcf, "generic");
    expect(contact.name).toBe("José García");
    expect(contact.firstName).toBe("José");
    expect(contact.lastName).toBe("García");
  });

  it("builds a name from N when FN is missing", () => {
    const [contact] = parseVCard(
      "BEGIN:VCARD\r\nVERSION:3.0\r\nN:Turing;Alan;;;\r\nEND:VCARD\r\n",
      "generic",
    );
    expect(contact.name).toBe("Alan Turing");
  });

  it("reads a photo whether it is base64, a data URI, or a URL", () => {
    const base64 = parseVCard(
      [
        "BEGIN:VCARD",
        "FN:B64",
        "PHOTO;ENCODING=b;TYPE=PNG:iVBORw0KGgo=",
        "END:VCARD",
      ].join("\r\n"),
      "apple",
    )[0];
    expect(base64.avatarUrl).toBe("data:image/png;base64,iVBORw0KGgo=");

    const uri = parseVCard(
      [
        "BEGIN:VCARD",
        "FN:URI",
        "PHOTO:data:image/png;base64,iVBORw0KGgo=",
        "END:VCARD",
      ].join("\r\n"),
      "apple",
    )[0];
    expect(uri.avatarUrl).toBe("data:image/png;base64,iVBORw0KGgo=");

    const url = parseVCard(
      [
        "BEGIN:VCARD",
        "FN:URL",
        "PHOTO:https://x.example/a.png",
        "END:VCARD",
      ].join("\r\n"),
      "apple",
    )[0];
    expect(url.avatarUrl).toBe("https://x.example/a.png");
  });
});

// ---------------------------------------------------------------------------
// Files that are not really files
// ---------------------------------------------------------------------------

describe("a file that is damaged, or not a vCard at all", () => {
  it("reads nothing rather than throwing", () => {
    expect(parseVCard("", "apple")).toEqual([]);
    expect(parseVCard("this is not a vcard at all", "apple")).toEqual([]);
    expect(parseVCard("BEGIN:VCARD", "apple")).toEqual([]);
    expect(parseVCard("END:VCARD\r\nBEGIN:VCARD", "apple")).toEqual([]);
  });

  it("skips a card with no name and keeps the ones around it", () => {
    const vcf = [
      "BEGIN:VCARD",
      "FN:First Person",
      "END:VCARD",
      "BEGIN:VCARD",
      "EMAIL:nameless@example.com",
      "END:VCARD",
      "BEGIN:VCARD",
      "FN:Third Person",
      "END:VCARD",
    ].join("\r\n");
    expect(parseVCard(vcf, "apple").map((c) => c.name)).toEqual([
      "First Person",
      "Third Person",
    ]);
  });

  it("ignores a byte-order mark and stray blank lines", () => {
    const vcf = "\uFEFF\r\n\r\nBEGIN:VCARD\r\nFN:Ada\r\n\r\nEND:VCARD\r\n\r\n";
    expect(parseVCard(vcf, "apple").map((c) => c.name)).toEqual(["Ada"]);
  });

  it("accepts a file that uses bare newlines", () => {
    // Anything that has been through a text editor or a copy-paste.
    const vcf = "BEGIN:VCARD\nFN:Ada\nEMAIL:ada@x.example\nEND:VCARD\n";
    expect(parseVCard(vcf, "apple")[0].emails?.[0].email).toBe("ada@x.example");
  });

  it("ignores a line with no colon in it", () => {
    const card = parseVCards(
      "BEGIN:VCARD\r\nFN:Ada\r\nGARBAGE\r\nEND:VCARD\r\n",
    )[0];
    expect(card.properties.map((p) => p.name)).toEqual(["FN"]);
  });
});

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

describe("serializeVCard", () => {
  it("writes N even when there is nothing to put in it", () => {
    // Required by the specification, and some readers show nothing without it.
    const card = serializeVCard({ name: "Prince" });
    expect(card).toContain("N:;;;;");
    expect(card).toContain("FN:Prince");
  });

  it("writes REV as a date-time, whichever way the database wrote it", () => {
    // SQLite stamps `2026-09-11 19:35:49` and the app writes ISO, so the column
    // holds both. A space where the T belongs is not a date-time.
    for (const stored of ["2026-09-11 19:35:49", "2026-09-11T19:35:49.000Z"]) {
      const card = serializeVCard({ name: "X", updatedAt: stored });
      expect(card).toContain("REV:2026-09-11T19:35:49.000Z");
    }
    // And a value that is not a date at all is left out rather than written.
    expect(serializeVCard({ name: "X", updatedAt: "whenever" })).not.toContain(
      "REV:",
    );
  });

  it("writes nothing for a field the contact does not have", () => {
    const card = serializeVCard({ name: "Prince" });
    expect(card).not.toContain("ORG:");
    expect(card).not.toContain("TITLE:");
    expect(card).not.toContain("EMAIL");
    expect(card).not.toContain("CATEGORIES:");
  });

  it("marks the primary value and no other", () => {
    const card = serializeVCard({
      name: "X",
      emails: [
        { email: "a@x.example", isPrimary: false },
        { email: "b@x.example", isPrimary: true },
      ],
    });
    const lines = card.split("\r\n").filter((l) => l.startsWith("EMAIL"));
    expect(lines[0]).not.toContain("PREF");
    expect(lines[1]).toContain("PREF");
  });

  it("drops a label that would break the parameter syntax", () => {
    const card = serializeVCard({
      name: "X",
      phones: [{ phone: "+1", label: "at home; really" }],
    });
    expect(card).toContain("TEL;TYPE=ATHOMEREALLY:+1");
  });
});
