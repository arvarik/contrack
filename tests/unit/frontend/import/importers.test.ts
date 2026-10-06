import { describe, it, expect } from "vitest";
import {
  parseGenericCSV,
  parseGoogleCSV,
  parseImportFile,
  parseLinkedInCSV,
  parseVCard,
  parseFacebookJSON,
} from "../../../../src/lib/importers";

describe("parseGenericCSV", () => {
  it("maps name, email and phone columns and skips rows with no name", async () => {
    const csv = [
      "Name,Email,Phone,Company,Role",
      "Jane Doe,jane@example.com,555-1234,Acme,Engineer",
      ",noname@example.com,,,",
    ].join("\n");

    const contacts = await parseGenericCSV(csv, "generic");

    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({
      name: "Jane Doe",
      company: "Acme",
      role: "Engineer",
      emails: [
        { email: "jane@example.com", label: "personal", isPrimary: true },
      ],
      phones: [{ phone: "555-1234", label: "mobile", isPrimary: true }],
    });
    await expect(parseGenericCSV("", "generic")).resolves.toEqual([]);
  });
});

describe("parseLinkedInCSV", () => {
  it("skips the notes before the header and maps the columns", async () => {
    const csv = [
      '"Notes:","When exporting your connection data, you may notice..."',
      "",
      "First Name,Last Name,URL,Email Address,Company,Position,Connected On",
      "Ada,Lovelace,https://www.linkedin.com/in/ada-lovelace,ada@example.com,Analytical Engines,Founder,01 Jan 2024",
    ].join("\n");

    const [contact] = await parseLinkedInCSV(csv);

    expect(contact).toMatchObject({
      name: "Ada Lovelace",
      company: "Analytical Engines",
      role: "Founder",
      emails: [{ email: "ada@example.com", label: "work", isPrimary: true }],
      socialLinks: [
        {
          platform: "linkedin",
          url: "https://www.linkedin.com/in/ada-lovelace",
        },
      ],
    });
  });
});

describe("parseGoogleCSV", () => {
  it("reads the current export's column names", async () => {
    // The header of a Google CSV export from 2024 on (shortened).
    const csv = [
      "First Name,Middle Name,Last Name,Nickname,Organization Name,Organization Title,Birthday,Notes,Labels,E-mail 1 - Label,E-mail 1 - Value,E-mail 2 - Label,E-mail 2 - Value,Phone 1 - Label,Phone 1 - Value,Address 1 - Label,Address 1 - Formatted,Website 1 - Label,Website 1 - Value",
      'Rowan,J,Vale,,Northwind Partners,Founder,--05-20,Met at a fair,* myContacts ::: Friends,* Home,rowan@example.com ::: rv@example.com,Work,rowan@northwind.example,Mobile,+1 555 0100,Home,"1 Main St\nSpringfield",Profile,https://rowan.example',
      ",,,,Acme Plumbing,,,,,,,,,Work,+1 555 0199,,,,",
      ",,,,,,,,,,,,,,,,,,",
    ].join("\n");

    const contacts = await parseGoogleCSV(csv);

    expect(contacts).toHaveLength(2);
    expect(contacts[0]).toMatchObject({
      name: "Rowan J Vale",
      firstName: "Rowan",
      lastName: "Vale",
      company: "Northwind Partners",
      role: "Founder",
      birthday: "--05-20",
      about: "Met at a fair",
      location: "1 Main St, Springfield",
      website: "https://rowan.example",
      tags: ["Friends"],
    });
    expect(contacts[0].emails).toEqual([
      { email: "rowan@example.com", label: "home", isPrimary: true },
      { email: "rv@example.com", label: "home", isPrimary: false },
      { email: "rowan@northwind.example", label: "work", isPrimary: false },
    ]);
    expect(contacts[0].phones).toEqual([
      { phone: "+1 555 0100", label: "mobile", isPrimary: true },
    ]);
    // A company with no person's name is named after the company.
    expect(contacts[1].name).toBe("Acme Plumbing");
  });

  it("still reads the older export's column names", async () => {
    const csv = [
      "Name,Given Name,Family Name,E-mail 1 - Type,E-mail 1 - Value,Organization 1 - Name,Organization 1 - Title",
      "Grace Hopper,Grace,Hopper,* Work,grace@example.com,Navy,Admiral",
    ].join("\n");

    const [contact] = await parseGoogleCSV(csv);

    expect(contact).toMatchObject({
      name: "Grace Hopper",
      company: "Navy",
      role: "Admiral",
      emails: [{ email: "grace@example.com", label: "work", isPrimary: true }],
    });
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
    // CELL, IPHONE and MOBILE are three exporters' words for one label, so
    // they fold onto the one this app uses. Before that a person's phone was
    // labelled differently depending on which address book the file came from.
    expect(c.phones).toEqual([
      { phone: "(555) 123-4567", label: "mobile", isPrimary: true },
    ]);
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
      /Could not read the Facebook file/,
    );
    expect(() => parseFacebookJSON("{}")).toThrowError(/Could not find/);
  });
});

describe("parseImportFile", () => {
  const card = (fn: string) => `BEGIN:VCARD\nVERSION:3.0\nFN:${fn}\nEND:VCARD`;

  it("reads the extension in any case and counts the entries with no name", async () => {
    const vcf = [card("Rowan Vale"), card(""), card("Ines Faro")].join("\n");

    const parsed = await parseImportFile("Contacts.VCF", vcf, "apple");

    expect(parsed.contacts.map((c) => c.name)).toEqual([
      "Rowan Vale",
      "Ines Faro",
    ]);
    expect(parsed.skipped).toBe(1);
  });

  it("says so when no entry has a name, and refuses other file types", async () => {
    await expect(parseImportFile("a.vcf", card(""), "apple")).rejects.toThrow(
      "The one entry in the file has no name",
    );
    await expect(parseImportFile("a.txt", "", "apple")).rejects.toThrow(
      "Choose a .vcf, .csv or .json file",
    );
  });
});
