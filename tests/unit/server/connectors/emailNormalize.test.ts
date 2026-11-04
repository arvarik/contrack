/**
 * Unit: email normalization.
 */

import { describe, expect, it } from "vitest";
import {
  canonicalEmailAddress,
  isAutomatedSender,
  isBulkMail,
  mailDate,
  normalizeEmail,
  normalizeEmailAddress,
  parseAddressList,
  stripSubjectPrefixes,
} from "../../../../server/connectors/email/normalize.ts";

describe("email normalization", () => {
  it.each([
    ["  Alice@Example.COM  ", "alice@example.com"],
    [null, ""],
    [undefined, ""],
  ])("normalizeEmailAddress(%j) is %j", (raw, address) => {
    expect(normalizeEmailAddress(raw)).toBe(address);
  });

  it.each([
    ["Re: Project update", "Project update"],
    ["Fw: Contract details", "Contract details"],
    ["Re: [Marketing] Fwd: Re[2]: Q3 Roadmap", "Q3 Roadmap"],
    ["  RE:  FW:  Hello  ", "Hello"],
    [null, "(No subject)"],
    ["Re: ", "(No subject)"],
  ])("stripSubjectPrefixes(%j) is %j", (subject, title) => {
    expect(stripSubjectPrefixes(subject)).toBe(title);
  });

  it.each([
    [
      'Bob <bob@example.com>, "Charlie, Jr." <charlie@example.com>, plain@example.com',
      [
        { name: "Bob", email: "bob@example.com" },
        { name: "Charlie, Jr.", email: "charlie@example.com" },
        { email: "plain@example.com" },
      ],
    ],
    [
      [
        { name: "Dana", address: "dana@example.com" },
        { email: "Eve@Example.COM" },
      ],
      [
        { name: "Dana", email: "dana@example.com" },
        { email: "eve@example.com" },
      ],
    ],
    [null, []],
    ["", []],
  ])("parseAddressList(%j)", (raw, parsed) => {
    expect(
      parseAddressList(raw as Parameters<typeof parseAddressList>[0]),
    ).toEqual(parsed);
  });

  it("normalizes a mail in and out, without its body unless asked", () => {
    const self = {
      selfEmails: ["me@example.com"],
      aliases: ["work@company.com"],
    };
    const incoming = {
      messageId: "<msg-123@mail.com>",
      inReplyTo: "<msg-100@mail.com>",
      date: "2026-03-10T14:30:00Z",
      subject: "Re: Quick question",
      from: "Colleague <colleague@example.com>",
      to: "me@example.com",
      cc: "team@example.com",
      bodyText: "The full body.",
      snippet: "Preview",
    };
    const normalized = normalizeEmail(incoming, self);
    expect(normalized).toMatchObject({
      externalId: "msg-123@mail.com",
      messageId: "msg-123@mail.com",
      inReplyTo: "msg-100@mail.com",
      direction: "in",
      title: "Quick question",
      snippet: "Preview",
    });
    expect(normalized).not.toHaveProperty("bodyText");
    expect(normalized.participants[0]).toEqual({
      name: "Colleague",
      email: "colleague@example.com",
    });
    expect(
      normalizeEmail(incoming, { ...self, includeBody: true }).bodyText,
    ).toBe("The full body.");

    // From an alias: the recipients come first.
    const out = normalizeEmail(
      {
        messageId: "<msg-out@mail.com>",
        date: "2026-03-10T16:00:00Z",
        subject: "Proposal",
        from: "work@company.com",
        to: "Partner <partner@example.com>",
      },
      self,
    );
    expect(out.direction).toBe("out");
    expect(out.participants[0]).toEqual({
      name: "Partner",
      email: "partner@example.com",
    });
  });

  it.each([
    [' "Ana.Lee+news@GoogleMail.com", ', "analee@gmail.com"],
    ["ana.lee+work@acme.io", "ana.lee@acme.io"],
  ])("canonicalEmailAddress(%j) is %j", (raw, mailbox) => {
    expect(canonicalEmailAddress(raw)).toBe(mailbox);
  });

  it.each([
    ["billing@shop.com", null, true],
    ["orders-no-reply@chownow.com", null, true],
    ["hello@email.mindful.com", "Mindful", true],
    ["info_at_shop_com_sv7421e24gr2c7_f8km9154@icloud.com", "Shop", true],
    ["quiet.river-4a@icloud.com", null, true],
    ["anything@icloud.com", "Hide My Email", true],
    ["access-support@x.com", null, true],
    ["salesforce_customercare@customercare.airline.com", "Customer Care", true],
    ["unsubscribe-cqjkpksurq@imh.rsys130.example.com", null, true],
    ["me_ucxcwg@kindle.com", null, true],
    ["john.smith@icloud.com", "John Smith", false],
    ["information.officer@gov.org", null, false],
    ["helena@acme.io", "Helena", false],
    ["deals@e.shop.com", null, true],
    ["team@news.example.co.uk", null, true],
    // Mail providers and universities, whose names look like bulk hosts.
    ["ana@mail.com", null, false],
    ["ivan@mail.ru", null, false],
    ["jan@email.cz", null, false],
    ["lena@mail.de", null, false],
    ["sam@mail.utoronto.ca", null, false],
    ["kim@email.arizona.edu", null, false],
    ["tan@e.ntu.edu.sg", null, false],
  ])("%s is automated: %s", (email, name, automated) => {
    expect(isAutomatedSender(email, name)).toBe(automated);
  });

  it.each([
    [["CATEGORY_PROMOTIONS", "INBOX"], {}, true],
    [["CATEGORY_UPDATES"], {}, true],
    [["INBOX"], { "List-Unsubscribe": "<mailto:u@x.com>" }, true],
    [["INBOX"], { Precedence: "bulk" }, true],
    [["INBOX"], { "Auto-Submitted": "auto-generated" }, true],
    [["INBOX"], { "Auto-Submitted": "no" }, false],
    [["INBOX", "CATEGORY_PERSONAL"], {}, false],
  ])(
    "isBulkMail(%j, %j) is %s",
    (labels, headers: Record<string, string>, bulk) => {
      expect(isBulkMail(labels, (name) => headers[name])).toBe(bulk);
    },
  );

  it("keeps a Date header from before the mail arrived, as in migrated mail", () => {
    const sent = new Date("2020-03-01T10:00:00Z");
    expect(mailDate(sent, new Date("2026-03-01T10:00:00Z"))).toEqual(sent);
  });
});
