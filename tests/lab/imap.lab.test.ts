/**
 * The Mailbox (IMAP) connector against GreenMail.
 */

import { ImapFlow } from "imapflow";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sqlite } from "../../server/db.ts";
import * as gateway from "../../server/ai/gateway.ts";
import * as instanceSwitch from "../../server/ai/instanceSwitch.ts";
import {
  createConnector,
  ignoreCorrespondent,
  listCorrespondents,
  runNow,
  updateConnector,
} from "../../server/connectors/service.ts";
import { contactService } from "../../server/services/contactService.ts";
import type { Scope } from "../../server/tenancy/scope.ts";
import {
  appendMail,
  DAY_MS,
  IMAP_PORT,
  imap,
  labOwner,
  mail,
} from "./helpers.ts";

afterEach(() => vi.restoreAllMocks());

const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS);

const config = (user: string, extra: Record<string, unknown> = {}) => ({
  host: "127.0.0.1",
  port: IMAP_PORT,
  secure: false,
  username: user,
  rollup: false,
  ghostThreshold: 3,
  ...extra,
});

const mailConnector = (
  scope: Scope,
  user: string,
  extra: Record<string, unknown> = {},
) =>
  createConnector(scope, {
    kind: "imap",
    name: "Lab mail",
    config: config(user, extra),
    secret: { password: "lab" },
  });

const addAna = (scope: Scope, email = "ana@lee.example") =>
  contactService.createContact(scope, {
    name: "Ana Lee",
    emails: [{ email, label: "work" }],
  })!;

const column = (sql: string, ...params: unknown[]) =>
  sqlite
    .prepare(sql)
    .pluck()
    .all(...params);

const interactionsOf = (contactId: string) =>
  column("SELECT date FROM interactions WHERE contactId = ?", contactId).length;

describe("IMAP against GreenMail", () => {
  it("logs each mail with a contact once, by mailbox, and counts only people as correspondents", async () => {
    const { ownerId, scope, email: me } = labOwner();
    const ana = addAna(scope, "ana.lee@example.com");

    await appendMail(me, "INBOX", [
      // The contact, with a +tag and capitals.
      {
        from: "Ana Lee <Ana.Lee+news@Example.com>",
        to: me,
        subject: "Lunch?",
        date: daysAgo(4),
      },
      // A stranger who writes alone counts as a correspondent, under one
      // address for each spelling of the mailbox.
      {
        from: "Dan Park <dan@park.example>",
        to: me,
        subject: "Hello",
        date: daysAgo(3),
      },
      {
        from: "dan+news@park.example",
        to: me,
        subject: "Hi",
        date: daysAgo(3),
      },
      // The owner under a +tag is not a stranger.
      {
        from: me.replace("@", "+receipts@"),
        to: me,
        subject: "Receipt",
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
      // A broadcast to many strangers counts none of them.
      {
        from: me,
        to: Array.from({ length: 30 }, (_, i) => `p${i}@list.example`).join(
          ", ",
        ),
        subject: "Newsletter",
        date: daysAgo(2),
      },
    ]);

    const connector = await mailConnector(scope, me);
    const first = await runNow(scope, connector.id);
    expect(first.status).toBe("ok");
    expect(first.stats.errors ?? 0).toBe(0);
    expect(interactionsOf(ana.id)).toBe(3);
    // Carol wrote three times, the threshold, so she is a suggested contact
    // under the name her mail gave.
    expect(
      sqlite
        .prepare(
          `SELECT c.name, e.email FROM contacts c JOIN contact_emails e ON e.contactId = c.id
            WHERE c.ownerId = ? AND c.isGhost = 1`,
        )
        .all(ownerId),
    ).toEqual([{ name: "Carol Kim", email: "carol@kim.example" }]);
    expect(listCorrespondents(scope)).toMatchObject([
      { email: "dan@park.example", name: "Dan Park", seenCount: 2 },
    ]);
    expect(
      ignoreCorrespondent(scope, connector.id, "dan+news@park.example"),
    ).toBe(true);
    expect(listCorrespondents(scope)).toEqual([]);

    // Nothing new: nothing is logged again.
    expect((await runNow(scope, connector.id)).status).toBe("ok");
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

  it("logs a mail once after the folder is made again with a new UIDVALIDITY, under the id an earlier version gave it in another folder", async () => {
    const { scope, email: me } = labOwner();
    const ana = addAna(scope);
    const messages = [1, 2].map((n) => ({
      from: "ana@lee.example",
      to: me,
      subject: `Archived ${n}`,
      date: daysAgo(n),
      messageId: `<archived-${n}-${me}>`,
    }));
    await appendMail(me, "Archive", messages);

    const connector = await mailConnector(scope, me, {
      folders: ["INBOX", "Archive"],
    });
    await runNow(scope, connector.id);
    expect(interactionsOf(ana.id)).toBe(2);
    const links = () =>
      column(
        "SELECT externalId FROM connector_links WHERE connectorId = ? AND kind = 'interaction' ORDER BY externalId",
        connector.id,
      );
    const ids = links();
    sqlite
      .prepare(
        "UPDATE connector_links SET externalId = 'imap:INBOX:<' || substr(externalId, 6) || '>' WHERE connectorId = ? AND kind = 'interaction'",
      )
      .run(connector.id);

    const uidValidity = () =>
      imap(
        me,
        async (c) =>
          await c
            .status("Archive", { uidValidity: true })
            .then((s) => s && s.uidValidity),
      );
    const before = await uidValidity();
    await imap(me, (c) => c.mailboxDelete("Archive"));
    await appendMail(me, "Archive", messages);
    expect(await uidValidity()).not.toBe(before);

    expect((await runNow(scope, connector.id)).status).toBe("ok");
    expect(interactionsOf(ana.id)).toBe(2);
    expect(links()).toEqual(ids);
  });

  it("counts a stranger once per mail, and never the mailbox or bulk mail", async () => {
    const { ownerId, scope } = labOwner();
    // A mailbox that is not the owner's login address.
    const box = `box-${ownerId}@lab.test`;
    const dan = {
      from: "Dan Park <dan@park.example>",
      to: box,
      subject: "Hello",
      date: daysAgo(3),
      messageId: `<dan-${box}>`,
    };
    await appendMail(box, "INBOX", [
      dan,
      ...[4, 5, 6].map((n) => ({
        from: "Shop <deals@shop.example>",
        to: box,
        subject: `Sale ${n}`,
        date: daysAgo(n),
        headers: { "List-Unsubscribe": "<mailto:unsubscribe@shop.example>" },
      })),
    ]);
    // The same mail in two folders, as one sent to oneself is.
    await appendMail(box, "Archive", [dan]);

    // No ghosts, so each count shows.
    const connector = await mailConnector(scope, box, {
      folders: ["INBOX", "Archive"],
      ghostThreshold: 10,
    });
    await runNow(scope, connector.id);
    // Archived again: the next run reads it from Archive once more.
    await appendMail(box, "Archive", [dan]);
    await runNow(scope, connector.id);

    expect(
      sqlite
        .prepare(
          `SELECT externalId, seenCount FROM connector_links
            WHERE connectorId = ? AND kind = 'correspondent'`,
        )
        .all(connector.id),
    ).toEqual([{ externalId: "dan@park.example", seenCount: 1 }]);
  });

  it("takes no folder named like Sent for the Sent folder, reads a folder added later over the lookback window, and reports a folder it cannot open", async () => {
    const { scope, email: me } = labOwner();
    const ana = addAna(scope);
    // No Sent folder: "Presentations" holds "sent" in its name. The mail's
    // Date header is decades off, so the server's date counts.
    await imap(me, async (c) => {
      await c.mailboxCreate("Presentations");
      await c.append(
        "Presentations",
        mail({
          from: me,
          to: "ana@lee.example",
          subject: "Slides",
          date: new Date("2099-01-01T10:00:00Z"),
        }),
        ["\\Seen"],
        daysAgo(5),
      );
    });

    const auto = await mailConnector(scope, me);
    expect((await runNow(scope, auto.id)).status).toBe("ok");
    expect(interactionsOf(ana.id)).toBe(0);

    await updateConnector(scope, auto.id, {
      config: config(me, { folders: ["INBOX", "Presentations"] }),
    });
    expect((await runNow(scope, auto.id)).status).toBe("ok");
    expect(
      column("SELECT date FROM interactions WHERE contactId = ?", ana.id).map(
        (d) => String(d).slice(0, 10),
      ),
    ).toEqual([daysAgo(5).toISOString().slice(0, 10)]);

    const missing = await mailConnector(scope, me, {
      folders: ["INBOX", "Missing"],
    });
    const run = await runNow(scope, missing.id);
    expect(run.status).toBe("ok");
    expect(run.stats.errors).toBe(1);
    expect(
      column("SELECT error FROM connector_runs WHERE id = ?", run.runId),
    ).toEqual([expect.stringContaining("Could not open folder Missing")]);
  });

  it("summarizes a contact's mail once from its text part, and downloads nothing when AI is off for the owner", async () => {
    vi.spyOn(gateway, "isAnyProviderConfigured").mockReturnValue(true);
    const generate = vi.spyOn(gateway, "generateFor").mockResolvedValue({
      text: "Ana sent the plan.",
      model: "test",
      tokenCount: 1,
      latencyMs: 1,
    } as gateway.AIGenerateResult);
    const download = vi.spyOn(ImapFlow.prototype, "download");
    const summaryWith = async (aiAllowed: boolean) => {
      vi.spyOn(instanceSwitch, "aiAllowedForUser").mockReturnValue(aiAllowed);
      const { scope, email: me } = labOwner();
      const ana = addAna(scope);
      // In two folders, and summarized once.
      for (const folder of ["INBOX", "Sent"]) {
        await appendMail(me, folder, [
          {
            from: "ana@lee.example",
            to: me,
            subject: "Plan",
            date: daysAgo(1),
            messageId: `<plan-${me}>`,
            body: "Here is the plan.",
          },
        ]);
      }
      const connector = await mailConnector(scope, me, { summaries: true });
      await runNow(scope, connector.id);
      return column(
        "SELECT content FROM interactions WHERE contactId = ?",
        ana.id,
      );
    };

    expect(await summaryWith(true)).toEqual(["Ana sent the plan."]);
    expect(download.mock.calls.map((call) => call[1])).toEqual(["1"]);
    download.mockClear();
    generate.mockClear();

    expect(await summaryWith(false)).toEqual([null]);
    expect(download).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });
});
