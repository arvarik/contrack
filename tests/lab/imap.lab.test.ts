/**
 * The Mailbox (IMAP) connector against GreenMail.
 */

import { describe, expect, it } from "vitest";
import { sqlite } from "../../server/db.ts";
import {
  createConnector,
  listCorrespondents,
  runNow,
} from "../../server/connectors/service.ts";
import { contactService } from "../../server/services/contactService.ts";
import type { Scope } from "../../server/tenancy/scope.ts";
import { appendMail, DAY_MS, IMAP_PORT, imap, labOwner } from "./helpers.ts";

const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS);

function mailConnector(scope: Scope, user: string, folders?: string[]) {
  return createConnector(scope, {
    kind: "imap",
    name: "Lab mail",
    config: {
      host: "127.0.0.1",
      port: IMAP_PORT,
      secure: false,
      username: user,
      rollup: false,
      ...(folders ? { folders } : {}),
    },
    secret: { password: "lab" },
  });
}

const interactionsOf = (contactId: string) =>
  (
    sqlite
      .prepare("SELECT COUNT(*) AS n FROM interactions WHERE contactId = ?")
      .get(contactId) as { n: number }
  ).n;

const ghostEmails = (ownerId: string) =>
  (
    sqlite
      .prepare(
        `SELECT e.email FROM contacts c JOIN contact_emails e ON e.contactId = c.id
          WHERE c.ownerId = ? AND c.isGhost = 1 ORDER BY e.email`,
      )
      .all(ownerId) as { email: string }[]
  ).map((r) => r.email);

describe("IMAP against GreenMail", () => {
  it("logs each mail with a contact once, by mailbox, and counts only people as correspondents", async () => {
    const { ownerId, scope, email: me } = labOwner();
    const ana = contactService.createContact(scope, {
      name: "Ana Lee",
      emails: [{ email: "ana.lee@example.com", label: "work" }],
    })!;

    await appendMail(me, "INBOX", [
      // The contact, with a +tag and capitals.
      {
        from: "Ana Lee <Ana.Lee+news@Example.com>",
        to: me,
        subject: "Lunch?",
        date: daysAgo(4),
      },
      // A stranger who writes alone counts as a correspondent.
      {
        from: "Dan Park <dan@park.example>",
        to: me,
        subject: "Hello",
        date: daysAgo(3),
      },
      // A stranger with the contact in Cc does not: the mail is the contact's.
      {
        from: "Bob Stone <bob@stone.example>",
        to: me,
        cc: "ana.lee@example.com",
        subject: "Intro",
        date: daysAgo(3),
      },
      // Three each from a no-reply robot and a person.
      ...[5, 6, 7].flatMap((n) => [
        {
          from: "Service <no-reply@service.example>",
          to: me,
          subject: `Receipt ${n}`,
          date: daysAgo(n),
        },
        {
          from: "Carol Kim <carol@kim.example>",
          to: me,
          subject: `Notes ${n}`,
          date: daysAgo(n),
        },
      ]),
    ]);
    await appendMail(me, "Sent", [
      {
        from: me,
        to: "Ana Lee <ana.lee@example.com>",
        subject: "Re: Lunch?",
        date: daysAgo(2),
      },
    ]);

    const connector = await mailConnector(scope, me);
    const first = await runNow(scope, connector.id);
    expect(first.status).toBe("ok");
    expect(first.stats.errors ?? 0).toBe(0);
    expect(interactionsOf(ana.id)).toBe(3);
    // Carol wrote three times, the threshold, so she is a suggested contact.
    expect(ghostEmails(ownerId)).toEqual(["carol@kim.example"]);
    expect(listCorrespondents(scope).map((c) => c.email)).toEqual([
      "dan@park.example",
    ]);

    // Nothing new: nothing is logged again.
    const second = await runNow(scope, connector.id);
    expect(second.status).toBe("ok");
    expect(interactionsOf(ana.id)).toBe(3);

    await appendMail(me, "INBOX", [
      {
        from: "ana.lee@example.com",
        to: me,
        subject: "See you",
        date: daysAgo(0),
      },
    ]);
    await runNow(scope, connector.id);
    expect(interactionsOf(ana.id)).toBe(4);
  });

  it("logs a mail once after the folder is made again with a new UIDVALIDITY", async () => {
    const { scope, email: me } = labOwner();
    const ana = contactService.createContact(scope, {
      name: "Ana Lee",
      emails: [{ email: "ana@lee.example", label: "work" }],
    })!;
    const messages = [1, 2].map((n) => ({
      from: "ana@lee.example",
      to: me,
      subject: `Archived ${n}`,
      date: daysAgo(n),
      messageId: `<archived-${n}-${me}>`,
    }));
    await appendMail(me, "Archive", messages);

    const connector = await mailConnector(scope, me, ["Archive"]);
    await runNow(scope, connector.id);
    expect(interactionsOf(ana.id)).toBe(2);

    const uidValidity = () =>
      imap(me, async (c) => {
        const status = await c.status("Archive", { uidValidity: true });
        return status && status.uidValidity;
      });
    const before = await uidValidity();
    await imap(me, (c) => c.mailboxDelete("Archive"));
    await appendMail(me, "Archive", messages);
    expect(await uidValidity()).not.toBe(before);

    const run = await runNow(scope, connector.id);
    expect(run.status).toBe("ok");
    expect(interactionsOf(ana.id)).toBe(2);
  });
});
