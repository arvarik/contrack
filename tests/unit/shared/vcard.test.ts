// Unit: the vCard parser rules. A file this app writes reads back with nothing
// lost, a file another address book or a CardDAV server writes reads in, and a
// patch keeps every line of the card that Contrack does not change.
// tests/integration/api.vcard.test.ts runs the round trip through the API.

import { describe, it, expect } from "vitest";
import {
  escapeValue,
  extractVCardContacts,
  foldLine,
  parseVCards,
  patchVCard,
  serializeVCard,
  serializeVCards,
  splitDisplayName,
  unescapeValue,
  valuesOf,
  type VCardInput,
} from "../../../shared/vcard";

const card = (...lines: string[]) =>
  ["BEGIN:VCARD", ...lines, "END:VCARD", ""].join("\r\n");
const read = (text: string) => extractVCardContacts(text).contacts;

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
  // The minimum a contact can be. One word, so nothing is guessed from it.
  { name: "Prince" },
];

/** The fields a round trip must keep, with the defaults a reader fills in. */
const kept = (c: VCardInput) => ({
  name: c.name,
  firstName: c.firstName ?? null,
  lastName: c.lastName ?? null,
  company: c.company ?? null,
  role: c.role ?? null,
  birthday: c.birthday ?? null,
  about: c.about ?? null,
  emails: c.emails ?? [],
  phones: c.phones ?? [],
  addresses: c.addresses ?? [],
  tags: c.tags ?? [],
});

describe("a contact written out and read back", () => {
  const written = serializeVCards(ROUND_TRIP);
  const back = read(written);

  it.each(ROUND_TRIP.map((c, i) => [c.name, i] as const))(
    "keeps every field of %s",
    (_name, index) => {
      const before = ROUND_TRIP[index]!;
      expect(kept(back[index]!)).toEqual(kept(before));
      expect(back[index]!.socialLinks.map((s) => s.url)).toEqual(
        expect.arrayContaining((before.socialLinks ?? []).map((s) => s.url)),
      );
    },
  );

  it("writes a file another address book accepts, and the same file again", () => {
    // Every card is a complete BEGIN/VERSION/N/FN/END, CRLF-terminated and
    // folded. Apple Contacts opens a file without VERSION or N as zero
    // contacts and says nothing.
    expect(written.split("BEGIN:VCARD")).toHaveLength(ROUND_TRIP.length + 1);
    expect(written.split("END:VCARD")).toHaveLength(ROUND_TRIP.length + 1);
    expect(written).toContain("VERSION:3.0");
    expect(written).not.toMatch(/[^\r]\n/);
    for (const line of written.split("\r\n")) {
      expect(line.length, line).toBeLessThanOrEqual(76);
    }
    // A fold inside an emoji is not valid UTF-8. One letter puts a pair
    // across the first fold.
    for (const line of foldLine("NOTE:x" + "🎉".repeat(80)).split("\r\n")) {
      expect(line).not.toMatch(/[\uD800-\uDBFF]$|^ ?[\uDC00-\uDFFF]/);
    }
    // Nothing drifts with each pass through the app.
    const again = serializeVCards(
      back.map(({ uid: _uid, avatarUrl: _a, location: _l, ...c }) => ({
        ...c,
        socialLinks: c.socialLinks.filter((s) => s.platform !== "website"),
      })),
    );
    expect(again).toBe(written);
  });
});

describe("splitDisplayName", () => {
  // A contact added by hand has one name field, so without this every export
  // carries `N:;;;;` and lands in another address book filed under nothing.
  it.each([
    ["Ada Lovelace", "Ada", "Lovelace", ""],
    ["José García", "José", "García", ""],
    ["Ana María Gonzáles de la Vega", "Ana María Gonzáles de la", "Vega", ""],
    ["Lovelace, Ada", "Ada", "Lovelace", ""],
    ["Martin Luther King Jr.", "Martin Luther", "King", "Jr."],
    ["Grace Hopper PhD", "Grace", "Hopper", "PhD"],
    // Nothing to split, the format's own separator, two commas, a suffix
    // alone: guessing would be wrong.
    ...["Prince", "Smith; Jr., Robert", "King, Martin Luther, Jr.", "Jr."].map(
      (name) => [name, "", "", ""],
    ),
    ["   ", "", "", ""],
  ])("reads %j", (name, given, family, suffix) => {
    expect(splitDisplayName(name)).toEqual({ given, family, suffix });
  });
});

describe("escaping", () => {
  it.each(["everything: \\ ; , \n at once", "trailing backslash \\", ""])(
    "survives %j",
    (value) => {
      expect(unescapeValue(escapeValue(value))).toBe(value);
    },
  );
});

describe("reading", () => {
  const png = "data:image/png;base64,iVBORw0KGgo=";
  it.each<[string, string[], Record<string, unknown>]>([
    [
      "Apple's grouped properties, custom labels and social profiles",
      [
        "FN:Ada",
        "item1.EMAIL;type=INTERNET;type=pref:ada@analytical.example",
        "item1.X-ABLabel:_$!<Work>!$_",
        "item2.TEL;type=pref:+44 20 7946 0000",
        "item2.X-ABLabel:Studio",
        "X-SOCIALPROFILE;type=GitHub:x-apple:adalovelace",
      ],
      {
        emails: [
          { email: "ada@analytical.example", label: "work", isPrimary: true },
        ],
        phones: [{ label: "studio" }],
        socialLinks: [
          {
            platform: "github",
            url: "https://github.com/adalovelace",
            handle: "adalovelace",
          },
        ],
      },
    ],
    [
      // A bare parameter is a TYPE, or every phone export loses its labels.
      "the vCard 2.1 shorthand a phone still writes",
      [
        "FN:Grace",
        "TEL;WORK;VOICE:+1 202 555 0100",
        "EMAIL;HOME;INTERNET:g@navy.example",
      ],
      { phones: [{ label: "work" }], emails: [{ label: "home" }] },
    ],
    [
      // Decoded one escape at a time, "José" reads as "JosÃ©".
      "quoted-printable, a whole character at a time",
      [
        "N;ENCODING=QUOTED-PRINTABLE:Garc=C3=ADa;Jos=C3=A9;;;",
        "FN;ENCODING=QUOTED-PRINTABLE:Jos=C3=A9 Garc=C3=ADa",
      ],
      { name: "José García", firstName: "José", lastName: "García" },
    ],
    ["a name from N without FN", ["N:Turing;Alan;;;"], { name: "Alan Turing" }],
    [
      "a tab continuation and escapes nobody needed to write",
      ["FN:Ada", "NOTE:Ada\\NLovelace\r\n\ta\\:b"],
      { about: "Ada\nLovelacea:b" },
    ],
    [
      "a tel: URI",
      ["VERSION:4.0", "FN:Ann", "TEL;VALUE=uri:tel:+1-555-0100"],
      { phones: [{ phone: "+1-555-0100", label: "mobile", isPrimary: true }] },
    ],
    [
      "4.0's PREF=1, every CATEGORIES line, and one primary per list",
      [
        "VERSION:4.0",
        "FN:X",
        "EMAIL;TYPE=home:a@x.example",
        "EMAIL;TYPE=work;PREF=1:b@x.example",
        "TEL:+1 555 0100",
        "TEL:+1 555 0101",
        "CATEGORIES:Friends,Climbing",
        "CATEGORIES:Work",
      ],
      {
        emails: [
          { label: "home", isPrimary: false },
          { label: "work", isPrimary: true },
        ],
        phones: [{ isPrimary: true }, { isPrimary: false }],
        tags: ["Friends", "Climbing", "Work"],
      },
    ],
    [
      "a base64 photo",
      ["FN:X", "PHOTO;ENCODING=b;TYPE=PNG:iVBORw0KGgo="],
      { avatarUrl: png },
    ],
    ["a data URI photo", ["FN:X", `PHOTO:${png}`], { avatarUrl: png }],
    [
      "a photo URL",
      ["FN:X", "PHOTO:https://x.example/a.png"],
      { avatarUrl: "https://x.example/a.png" },
    ],
    [
      "a photo whose type is a media type",
      ["FN:X", "PHOTO;ENCODING=b;TYPE=image/jpeg:/9j/4A=="],
      { avatarUrl: "data:image/jpeg;base64,/9j/4A==" },
    ],
  ])("reads %s", (_label, lines, expected) => {
    const [contact] = read(card(...lines));
    expect(contact).toMatchObject(expected);
  });

  describe("a folded photo and note, whatever ends the lines", () => {
    // A real 4 by 4 JPEG: its base64 folds over six lines.
    const jpeg =
      "/9j/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAAEAAQDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABAb/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCWAEpn/9k=";
    const note =
      "Met at the Lisbon offsite. Follow up in March: the seed round, the board seat and the first hire.";
    const file = (end: string) =>
      card(
        "VERSION:3.0",
        "FN:Ada",
        foldLine(`PHOTO;ENCODING=b;TYPE=JPEG:${jpeg}`),
        foldLine(`NOTE:${escapeValue(note)}`),
        "EMAIL:ada@analytical.example",
      ).replaceAll("\r\n", end);

    it.each([
      ["CR CR LF, as an Apple Contacts export can", "\r\r\n"],
      ["CR LF", "\r\n"],
      ["LF", "\n"],
      ["CR", "\r"],
    ])("reads every line of each value with %s", (_label, end) => {
      expect(file(end).split(end).length).toBeGreaterThan(10);
      expect(read(file(end))).toEqual([
        expect.objectContaining({
          avatarUrl: `data:image/jpeg;base64,${jpeg}`,
          about: note,
          emails: [
            expect.objectContaining({ email: "ada@analytical.example" }),
          ],
        }),
      ]);
    });
  });

  it("reads a card with a long run of CRs in linear time", () => {
    // A CardDAV server sends this to the server, which has one thread. A
    // regex that tried the run again from each CR took seconds here. No LF
    // follows the run, which is what made it slow.
    const text = card(
      "VERSION:3.0",
      `FN:Ada${"\r".repeat(200_000)}EMAIL:ada@analytical.example`,
    );
    const started = performance.now();
    const contacts = read(text);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(contacts).toEqual([expect.objectContaining({ name: "Ada" })]);
  });

  it("reads a quoted parameter list", () => {
    const [parsed] = parseVCards(card('TEL;TYPE="WORK,VOICE":+1 555 0000'));
    expect(valuesOf(parsed!, "TEL")[0]!.params.TYPE).toEqual(["WORK", "VOICE"]);
  });

  it.each([
    ["an empty file", "", []],
    ["text that is not a vCard", "this is not a vcard at all", []],
    ["a card with no end", "BEGIN:VCARD", []],
    ["an end before the begin", "END:VCARD\r\nBEGIN:VCARD", []],
    [
      "a card with no name between two others",
      card("FN:First") + card("EMAIL:nameless@example.com") + card("FN:Third"),
      ["First", "Third"],
    ],
    [
      "group cards from Apple and vCard 4.0",
      card("FN:VIP", "X-ADDRESSBOOKSERVER-KIND:group") +
        card("VERSION:4.0", "FN:Team", "KIND:group") +
        card("FN:Margaret Hamilton"),
      ["Margaret Hamilton"],
    ],
    [
      "a byte-order mark and blank lines",
      "\uFEFF\r\n\r\nBEGIN:VCARD\r\nFN:Ada\r\n\r\nEND:VCARD\r\n\r\n",
      ["Ada"],
    ],
    ["bare newlines", "BEGIN:VCARD\nFN:Ada\nEND:VCARD\n", ["Ada"]],
    ["a line with no colon", card("FN:Ada", "GARBAGE"), ["Ada"]],
  ])("reads only the contacts in %s", (_label, text, names) => {
    expect(read(text).map((c) => c.name)).toEqual(names);
  });
});

describe("writing", () => {
  it.each<[string, VCardInput, string[], string[]]>([
    [
      // N is required, and some readers show nothing without it.
      "N and FN, and no line for a field it does not have",
      { name: "Prince", birthday: "1985" },
      ["N:;;;;", "FN:Prince"],
      ["ORG:", "TITLE:", "EMAIL", "CATEGORIES:", "BDAY"],
    ],
    [
      "the contact's own name over a guess",
      { name: "Robert Smith", firstName: "Bob", lastName: "Smith" },
      ["N:Smith;Bob;;;"],
      [],
    ],
    [
      "a guessed suffix in its own component",
      { name: "Martin Luther King Jr." },
      ["N:King;Martin Luther;;;Jr."],
      [],
    ],
    [
      // SQLite writes `2026-09-11 19:35:49` and the app ISO.
      "REV from a SQLite timestamp",
      { name: "X", updatedAt: "2026-09-11 19:35:49" },
      ["REV:2026-09-11T19:35:49.000Z"],
      [],
    ],
    [
      "no REV for a value that is not a date",
      { name: "X", updatedAt: "whenever" },
      [],
      ["REV:"],
    ],
    [
      "PREF on the primary value only",
      {
        name: "X",
        emails: [
          { email: "a@x.example", isPrimary: false },
          { email: "b@x.example", isPrimary: true },
        ],
      },
      [
        "\r\nEMAIL;TYPE=INTERNET:a@x.example\r\n",
        "\r\nEMAIL;TYPE=INTERNET;TYPE=PREF:b@x.example\r\n",
      ],
      [],
    ],
    [
      "a label TYPE cannot carry as an Apple label",
      { name: "X", phones: [{ phone: "+1", label: "at home; really" }] },
      ["item1.TEL;TYPE=VOICE:+1", "item1.X-ABLabel:at home\\; really"],
      [],
    ],
    [
      "the UID of a CardDAV card",
      { uid: "contact-uuid-123", name: "X" },
      ["UID:contact-uuid-123"],
      [],
    ],
  ])("writes %s", (_label, contact, has, hasNot) => {
    const written = serializeVCard(contact);
    for (const line of has) expect(written).toContain(line);
    for (const line of hasNot) expect(written).not.toContain(line);
  });
});

describe("patchVCard", () => {
  it("keeps every line Contrack does not own, and the server's UID", () => {
    const existing = [
      "PRODID:-//Apple Inc.//macOS 15.0//EN",
      "UID:server-uid-original-777",
      "N:Lovelace;Ada;Augusta;Countess;",
      "FN:Ada Lovelace",
      "NICKNAME:Enchantress of Numbers",
      "ORG:Analytical Engine Ltd;Research Division",
      "PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRgABAQAAAQABAAD/",
      "item1.TEL;type=pref:+44 20 7946 0921",
      "item1.X-ABLabel:_$!<Mobile>!$_",
      "item2.ADR;type=HOME;type=pref:;;10 St James Square;London;Greater London;SW1Y 4LE;UK",
      "item2.X-ABLabel:_$!<Home>!$_",
      "item3.X-ABDATE;type=pref:1835-07-08",
      "item3.X-ABLabel:_$!<Anniversary>!$_",
      "X-ABUID:550E8400-E29B-41D4-A716-446655440000:ABPerson",
    ];
    const patched = patchVCard(card("VERSION:3.0", ...existing), {
      uid: "wrong-fallback-contact-id",
      name: "Ada Lovelace",
      firstName: "Ada",
      lastName: "Lovelace",
      company: "Analytical Engine Ltd",
      role: "Chief Architect",
      phones: [{ phone: "+44 20 7946 0921", label: "mobile", isPrimary: true }],
      addresses: [
        {
          address: "10 St James Square, London, Greater London SW1Y 4LE, UK",
          label: "home",
          isPrimary: true,
        },
      ],
    }).replace(/\r\n[ \t]/g, "");
    for (const line of existing) expect(patched).toContain(line);
    expect(patched).toContain("TITLE:Chief Architect");
    expect(patched).not.toContain("wrong-fallback-contact-id");
  });

  it("keeps a 4.0 card 4.0, with its own lines for values that did not change", () => {
    const v4 = card(
      "VERSION:4.0",
      "FN:Ann Lee",
      "TEL;VALUE=uri;PREF=1:tel:+1-555-0100",
      "EMAIL:a@x.example",
      "EMAIL;TYPE=PREF:b@x.example",
      "CATEGORIES:Friends,Climbing",
      "CATEGORIES:Work",
    );
    const [ann] = read(v4);
    const unchanged = patchVCard(v4, ann!);
    for (const line of v4.split("\r\n").slice(2)) {
      expect(unchanged).toContain(line);
    }
    const patched = patchVCard(v4, {
      ...ann!,
      emails: [{ email: "c@x.example", isPrimary: true }],
    });
    expect(patched).not.toContain("VERSION:3.0");
    expect(patched).toContain("EMAIL;TYPE=INTERNET;PREF=1:c@x.example");
  });

  it.each(["19850514T000000Z", "---14", "1985", "circa 1950"])(
    "keeps a birthday the parser cannot read, %s, as the card wrote it",
    (bday) => {
      const written = card("VERSION:3.0", "FN:X", `BDAY:${bday}`);
      expect(patchVCard(written, read(written)[0]!)).toContain(`BDAY:${bday}`);
    },
  );

  it("keeps a custom label with its spaces", () => {
    const written = serializeVCard({
      name: "X",
      phones: [{ phone: "+1", label: "old work" }],
    });
    const [x] = read(written);
    expect(x!.phones[0]!.label).toBe("old work");
    expect(read(patchVCard(written, x!))[0]!.phones[0]!.label).toBe("old work");
  });

  it("reads and patches a card of 20,000 addresses in linear time", () => {
    // The quadratic version took 5 seconds at this size.
    const big = card(
      "VERSION:3.0",
      "FN:Big",
      ...Array.from({ length: 20_000 }, (_, i) => `EMAIL:u${i}@x.example`),
    );
    const started = performance.now();
    const [contact] = read(big);
    patchVCard(big, contact!);
    expect(contact!.emails).toHaveLength(20_000);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
