import { describe, it, expect } from "vitest";
import {
  parseGenericCSV,
  parseLinkedInCSV,
  parseVCard,
  parseFacebookJSON,
} from "../../src/lib/importers";

describe("parseGenericCSV", () => {
  it("parses a generic CSV with name/email columns", async () => {
    const csv = [
      "Name,Email,Phone,Company,Role",
      "Jane Doe,jane@example.com,555-1234,Acme,Engineer",
      "John Smith,john@example.com,,Globex,",
    ].join("\n");

    const contacts = await parseGenericCSV(csv, "generic");

    expect(contacts).toHaveLength(2);
    expect(contacts[0]).toMatchObject({
      name: "Jane Doe",
      company: "Acme",
      role: "Engineer",
    });
    expect(contacts[0].emails).toEqual([
      { email: "jane@example.com", label: "personal", isPrimary: true },
    ]);
    expect(contacts[0].phones).toEqual([
      { phone: "555-1234", label: "mobile", isPrimary: true },
    ]);
    expect(contacts[1].name).toBe("John Smith");
    expect(contacts[1].phones).toEqual([]);
  });

  it("skips rows without a name", async () => {
    const csv = [
      "Name,Email",
      ",noname@example.com",
      "Real Person,r@x.com",
    ].join("\n");
    const contacts = await parseGenericCSV(csv, "generic");
    expect(contacts).toHaveLength(1);
    expect(contacts[0].name).toBe("Real Person");
  });

  it("returns empty for malformed input without throwing", async () => {
    await expect(parseGenericCSV("", "generic")).resolves.toEqual([]);
    await expect(
      parseGenericCSV(",,,\ngarbage without headers", "generic"),
    ).resolves.toEqual([]);
  });
});

describe("parseLinkedInCSV", () => {
  it("maps LinkedIn CSV headers to contact fields", async () => {
    const csv = [
      "First Name,Last Name,URL,Email Address,Company,Position,Connected On",
      "Ada,Lovelace,https://www.linkedin.com/in/ada-lovelace,ada@example.com,Analytical Engines,Founder,01 Jan 2024",
    ].join("\n");

    const contacts = await parseLinkedInCSV(csv);

    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({
      name: "Ada Lovelace",
      firstName: "Ada",
      lastName: "Lovelace",
      company: "Analytical Engines",
      role: "Founder",
    });
    expect(contacts[0].emails).toEqual([
      { email: "ada@example.com", label: "work", isPrimary: true },
    ]);
    expect(contacts[0].socialLinks).toEqual([
      {
        platform: "linkedin",
        url: "https://www.linkedin.com/in/ada-lovelace",
      },
    ]);
  });

  it("skips the LinkedIn preamble notes before the header row", async () => {
    const csv = [
      '"Notes:","When exporting your connection data, you may notice..."',
      "",
      "First Name,Last Name,URL,Email Address,Company,Position,Connected On",
      "Grace,Hopper,https://www.linkedin.com/in/grace-hopper,,Navy,Admiral,02 Feb 2024",
    ].join("\n");

    const contacts = await parseLinkedInCSV(csv);

    expect(contacts).toHaveLength(1);
    expect(contacts[0].name).toBe("Grace Hopper");
    expect(contacts[0].emails).toEqual([]);
  });

  it("returns empty for malformed input without throwing", async () => {
    await expect(parseLinkedInCSV("")).resolves.toEqual([]);
    await expect(
      parseLinkedInCSV("random,text\nwith,no,names"),
    ).resolves.toEqual([]);
  });
});

describe("parseVCard", () => {
  it("parses a vCard with FN/EMAIL/TEL", () => {
    const vcf = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "N:Doe;Jane;;;",
      "FN:Jane Doe",
      "ORG:Acme Corp;Engineering",
      "TITLE:Staff Engineer",
      "EMAIL;type=INTERNET;type=WORK;type=pref:jane@acme.com",
      "EMAIL;type=INTERNET;type=HOME:jane@personal.com",
      "TEL;type=CELL;type=VOICE;type=pref:(555) 123-4567",
      "END:VCARD",
    ].join("\n");

    const contacts = parseVCard(vcf, "apple");

    expect(contacts).toHaveLength(1);
    const c = contacts[0];
    expect(c).toMatchObject({
      name: "Jane Doe",
      firstName: "Jane",
      lastName: "Doe",
      company: "Acme Corp",
      role: "Staff Engineer",
    });
    expect(c.emails).toEqual([
      { email: "jane@acme.com", label: "work", isPrimary: true },
      { email: "jane@personal.com", label: "home", isPrimary: false },
    ]);
    expect(c.phones).toEqual([
      { phone: "(555) 123-4567", label: "cell", isPrimary: true },
    ]);
  });

  it("parses multiple cards from one file", () => {
    const vcf = [
      "BEGIN:VCARD",
      "FN:First Person",
      "END:VCARD",
      "BEGIN:VCARD",
      "FN:Second Person",
      "END:VCARD",
    ].join("\n");

    const contacts = parseVCard(vcf, "apple");
    expect(contacts.map((c) => c.name)).toEqual([
      "First Person",
      "Second Person",
    ]);
  });

  it("skips cards without an FN and handles malformed input without throwing", () => {
    expect(parseVCard("", "apple")).toEqual([]);
    expect(parseVCard("this is not a vcard at all", "apple")).toEqual([]);
    expect(
      parseVCard("BEGIN:VCARD\nEMAIL:no-name@example.com\nEND:VCARD", "apple"),
    ).toEqual([]);
  });
});

describe("parseFacebookJSON", () => {
  it("parses the friends_v2 structure", () => {
    const json = JSON.stringify({
      friends_v2: [{ name: "Mark Example", timestamp: 1700000000 }],
    });

    const contacts = parseFacebookJSON(json);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].name).toBe("Mark Example");
  });

  it("throws a friendly error (not a crash) on malformed JSON", () => {
    // Contract: parseFacebookJSON surfaces a user-facing Error the ImportModal
    // catches and renders — it never lets a raw SyntaxError escape.
    expect(() => parseFacebookJSON("{not json")).toThrowError(
      /Failed to parse Facebook JSON/,
    );
    expect(() => parseFacebookJSON("{}")).toThrowError(/Could not find/);
  });
});
