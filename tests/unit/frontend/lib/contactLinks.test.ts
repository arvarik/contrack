/**
 * The links a contact's details become, and the vCard that "Share contact"
 * sends. An address book reads the card, so its escapes, its folds and its
 * TYPE labels are what is checked here.
 */
import { describe, expect, it } from "vitest";
import {
  buildVCard,
  mailtoHref,
  smsHref,
  telHref,
  vCardFileName,
} from "../../../../src/lib/contactLinks";

describe("contact links", () => {
  it.each([
    ["+1 (555) 010-2030", "tel:+15550102030", "sms:+15550102030"],
    // A text goes to the number, never to its extension.
    ["020 7946 0018 ext. 42", "tel:02079460018,42", "sms:02079460018"],
    ["555.010.2030 x7", "tel:5550102030,7", "sms:5550102030"],
    ["+1 555 0100, 12", "tel:+15550100,12", "sms:+15550100"],
    // The trunk zero after a country code is not dialed.
    ["+44 (0) 20 7946 0018", "tel:+442079460018", "sms:+442079460018"],
    // Each of these would dial a wrong number, or none on an iPhone.
    ["no number", null, null],
    ["1-800-FLOWERS", null, null],
    ["+1 555 0100 / +1 555 0101", null, null],
    ["1234 5678 9012 3456", null, null],
    ["*67 555 010 2030", null, null],
    ["+1 555 010 2030 #22", null, null],
  ])("dials %s as %s and texts it as %s", (phone, tel, sms) => {
    expect(telHref(phone)).toBe(tel);
    expect(smsHref(phone)).toBe(sms);
  });

  it("encodes an email, so the value cannot add a subject or a body", () => {
    expect(mailtoHref(" ada+crm@example.com ")).toBe(
      "mailto:ada%2Bcrm@example.com",
    );
    expect(mailtoHref("a@b.com?body=hi")).toBe("mailto:a@b.com%3Fbody%3Dhi");
  });
});

describe("buildVCard", () => {
  const lines = (card: string) => card.split("\r\n");

  it("writes a vCard 3.0 card with labels, the primary first, and escapes", () => {
    const card = buildVCard({
      name: "Ada King Lovelace",
      role: "Engineer; analyst",
      company: "Babbage, Co",
      emails: [
        { email: "ada@work.example", label: "work" },
        { email: "ada@home.example", label: "personal" },
      ],
      phones: [
        { phone: "+44 20 7946 0018", label: "mobile" },
        { phone: "555", label: "other" },
      ],
      addresses: [{ address: "12 St James's Sq\nLondon", label: "home" }],
      birthday: "1815-12-10",
      website: "https://ada.example",
      socialLinks: [
        { url: "https://ada.example" },
        { url: "https://x.example/ada" },
      ],
    });

    expect(card.endsWith("END:VCARD\r\n")).toBe(true);
    expect(lines(card)).toEqual([
      "BEGIN:VCARD",
      "VERSION:3.0",
      "N:Lovelace;Ada King;;;",
      "FN:Ada King Lovelace",
      "ORG:Babbage\\, Co",
      "TITLE:Engineer\\; analyst",
      "EMAIL;TYPE=INTERNET,WORK,PREF:ada@work.example",
      "EMAIL;TYPE=INTERNET,HOME:ada@home.example",
      "TEL;TYPE=CELL,PREF:+44 20 7946 0018",
      "TEL:555",
      "ADR;TYPE=HOME,PREF:;;12 St James's Sq\\nLondon;;;;",
      "BDAY:1815-12-10",
      // The website is also a social link, and the card lists it once.
      "URL:https://ada.example",
      "URL:https://x.example/ada",
      "END:VCARD",
      "",
    ]);
  });

  it("takes the older single place, and a birthday with no year", () => {
    const card = buildVCard({
      name: "Cher",
      location: "Paris, France",
      birthday: "May 20",
    });
    expect(lines(card)).toContain("N:;Cher;;;");
    expect(lines(card)).toContain("ADR;TYPE=HOME,PREF:;;Paris\\, France;;;;");
    // Apple's form: vCard 3.0 has no date without a year.
    expect(lines(card)).toContain("BDAY;X-APPLE-OMIT-YEAR=1604:1604-05-20");
  });

  it("folds a long line at 75 octets without cutting a character", () => {
    const card = buildVCard({ name: "Zoë", role: "é".repeat(60) });
    const title = card.slice(card.indexOf("TITLE:"), card.indexOf("END:"));
    const folded = title.split("\r\n ");
    expect(folded.length).toBeGreaterThan(1);
    for (const part of folded) {
      expect(new TextEncoder().encode(part.trimEnd()).length).toBeLessThan(76);
    }
    expect(folded.join("").trimEnd()).toBe(`TITLE:${"é".repeat(60)}`);
  });

  it("names the file after the contact, short and with no dot at the end", () => {
    expect(vCardFileName("Ada: Lovelace / CEO")).toBe("Ada Lovelace  CEO.vcf");
    expect(vCardFileName('***"')).toBe("contact.vcf");
    expect(vCardFileName("A".repeat(300))).toBe(`${"A".repeat(80)}.vcf`);
    expect(vCardFileName("Ada Inc.")).toBe("Ada Inc.vcf");
  });

  it("keeps a suffix, writes a URL as it is, and names a card with no name", () => {
    const card = buildVCard({
      name: "Martin Luther King Jr.",
      website: "https://x.example/a,b;c",
    });
    expect(card).toContain("N:King;Martin Luther;;;Jr.");
    expect(card).toContain("URL:https://x.example/a,b;c");
    expect(buildVCard({ name: " ", company: "Acme" })).toContain("FN:Acme");
  });
});
