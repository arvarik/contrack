/**
 * The CardDAV connector against Radicale, both ways.
 */

import { describe, expect, it } from "vitest";
import { sqlite } from "../../server/db.ts";
import {
  createConnector,
  deleteConnector,
  runNow,
  updateConnector,
} from "../../server/connectors/service.ts";
import { contactService } from "../../server/services/contactService.ts";
import type { Scope } from "../../server/tenancy/scope.ts";
import { labOwner, RADICALE, radicaleBook, vcard } from "./helpers.ts";

// A 1x1 PNG.
const PHOTO =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("CardDAV against Radicale", () => {
  it("pulls cards, follows edits and deletions on the server, and pushes Contrack's changes without losing the server's fields", async () => {
    const { ownerId, scope } = labOwner();
    const book = await radicaleBook(`${ownerId}-dav`);
    const ana = (phone: string) =>
      vcard(
        "UID:ana-lab",
        "FN:Ana Lee",
        "N:Lee;Ana;;;",
        "EMAIL;TYPE=WORK:ana@lee.example",
        `TEL;TYPE=CELL:${phone}`,
        "ORG:Lee Labs",
        "TITLE:Founder",
        "BDAY:1990-05-14",
        "ADR;TYPE=HOME:;;1 Main St;Springfield;IL;62701;US",
        "CATEGORIES:Friends,Climbing",
        "NOTE:Met at the conference.",
        "URL:https://ana.example",
        "X-LAB-KEEP:server only",
        `PHOTO;ENCODING=b;TYPE=PNG:${PHOTO}`,
      );
    await book.put("ana-lab", ana("+1 415 555 0101"));
    await book.put(
      "bob-lab",
      vcard("UID:bob-lab", "FN:Bob Stone", "EMAIL:bob@stone.example"),
    );

    const connector = await createConnector(scope, {
      kind: "carddav",
      name: "Lab contacts",
      config: { url: `${RADICALE}/`, username: book.user },
      secret: { password: "lab" },
    });
    const byName = (name: string) =>
      sqlite
        .prepare(
          "SELECT id, deletedAt FROM contacts WHERE ownerId = ? AND name = ?",
        )
        .get(ownerId, name) as { id: string; deletedAt: string | null };
    const contact = (name: string) =>
      contactService.getContactById(scope, byName(name).id)!;

    const first = await runNow(scope, connector.id);
    expect(first.status).toBe("ok");
    expect(first.stats.errors ?? 0).toBe(0);
    const pulled = contact("Ana Lee");
    expect(pulled.emails.map((e) => [e.email, e.label])).toEqual([
      ["ana@lee.example", "work"],
    ]);
    expect(pulled.phones.map((p) => p.phone)).toEqual(["+1 415 555 0101"]);
    expect(pulled.company).toBe("Lee Labs");
    expect(pulled.birthday).toBe("1990-05-14");
    expect(pulled.about).toBe("Met at the conference.");
    expect(pulled.website).toBe("https://ana.example");
    expect(pulled.tags.map((t) => t.tag).sort()).toEqual([
      "Climbing",
      "Friends",
    ]);
    expect(pulled.addresses?.[0]?.address).toContain("1 Main St");
    expect(pulled.avatarUrl).toBeTruthy();

    // On the server: a new number for Ana, and Bob deleted.
    await book.put("ana-lab", ana("+1 415 555 0199"));
    await book.remove("bob-lab");
    const second = await runNow(scope, connector.id);
    expect(second.status).toBe("ok");
    expect(contact("Ana Lee").phones.map((p) => p.phone)).toEqual([
      "+1 415 555 0199",
    ]);
    // A card deleted on the server unlinks the contact and keeps it out of
    // the Trash (docs/import-and-sync.md).
    expect(byName("Bob Stone").deletedAt).toBeNull();
    expect(
      sqlite
        .prepare("SELECT COUNT(*) AS n FROM connector_links WHERE localId = ?")
        .get(byName("Bob Stone").id),
    ).toEqual({ n: 0 });

    // In Contrack: a new contact, and Ana's company changed.
    contactService.createContact(scope, {
      name: "Cara Diaz",
      emails: [{ email: "cara@diaz.example", label: "personal" }],
    });
    contactService.updateContact(scope, byName("Ana Lee").id, {
      company: "Lee Robotics",
    });
    const third = await runNow(scope, connector.id);
    expect(third.status).toBe("ok");
    const cards = [...(await book.cards()).values()];
    const cara = cards.find((c) => c.includes("FN:Cara Diaz"));
    expect(cara).toContain("cara@diaz.example");
    const anaCard = cards.find((c) => c.includes("FN:Ana Lee"))!;
    expect(anaCard).toContain("ORG:Lee Robotics");
    expect(anaCard).toContain("X-LAB-KEEP:server only");
    expect(anaCard).toMatch(/PHOTO/);
  });

  /** A CardDAV connector on `book`, two-way unless `config` says otherwise. */
  const connect = (
    scope: Scope,
    book: { user: string },
    config: Record<string, unknown> = {},
  ) =>
    createConnector(scope, {
      kind: "carddav",
      name: "Lab contacts",
      config: { url: `${RADICALE}/`, username: book.user, ...config },
      secret: { password: "lab" },
    });
  const ids = (ownerId: string, name: string) =>
    (
      sqlite
        .prepare("SELECT id FROM contacts WHERE ownerId = ? AND name = ?")
        .all(ownerId, name) as Array<{ id: string }>
    ).map((r) => r.id);
  /** Moves a contact's dates before the connector, as an older contact. */
  const older = (id: string) =>
    sqlite
      .prepare(
        "UPDATE contacts SET addedAt = '2026-01-01 00:00:00', updatedAt = '2026-01-01 00:00:00' WHERE id = ?",
      )
      .run(id);
  /** What a trigger does when a meeting or a briefing touches a contact. */
  const touch = (id: string) =>
    sqlite
      .prepare(
        "UPDATE contacts SET lastContactedAt = datetime('now'), updatedAt = datetime('now', '+1 hour') WHERE id = ?",
      )
      .run(id);

  it("uploads only the contacts edited after Two-way sync starts, whatever else touched them", async () => {
    const { ownerId, scope } = labOwner();
    const book = await radicaleBook(`${ownerId}-dav`);
    await book.put("srv", vcard("UID:srv", "FN:Server Person"));
    const pre = contactService.createContact(scope, { name: "Pre Existing" })!;
    older(pre.id);

    const connector = await connect(scope, book, {
      syncDirection: "pull_only",
    });
    expect((await runNow(scope, connector.id)).status).toBe("ok");
    contactService.createContact(scope, { name: "Added While Pulling" });
    expect((await runNow(scope, connector.id)).status).toBe("ok");
    touch(pre.id);

    await updateConnector(scope, connector.id, {
      config: {
        url: `${RADICALE}/`,
        username: book.user,
        syncDirection: "two_way",
      },
    });
    expect((await runNow(scope, connector.id)).status).toBe("ok");
    expect([...(await book.cards()).keys()]).toEqual(["srv.vcf"]);

    contactService.updateContact(scope, pre.id, { company: "Edited" });
    await runNow(scope, connector.id);
    const cards = [...(await book.cards()).values()];
    expect(cards.filter((c) => c.includes("ORG:Edited"))).toHaveLength(1);
    expect(cards).toHaveLength(2);

    // A first sync that comes late, after meetings touched an older contact.
    const other = labOwner();
    const late = await radicaleBook(`${other.ownerId}-dav`);
    const touched = contactService.createContact(other.scope, {
      name: "Touched",
    })!;
    older(touched.id);
    const second = await connect(other.scope, late);
    touch(touched.id);
    await runNow(other.scope, second.id);
    expect((await late.cards()).size).toBe(0);
  });

  it("keeps the server's edits to a contact Contrack had before it connected", async () => {
    const { ownerId, scope } = labOwner();
    const book = await radicaleBook(`${ownerId}-dav`);
    const ada = contactService.createContact(scope, {
      name: "Ada",
      emails: [{ email: "ada@lab.test" }],
      phones: [{ phone: "+1 415 555 0100" }],
    })!;
    older(ada.id);
    const card = (fn: string, tel: string) =>
      vcard("UID:ada", `FN:${fn}`, "EMAIL:ada@lab.test", `TEL:${tel}`);
    await book.put("ada", card("Ada L.", "+1 415 555 0100"));
    const connector = await connect(scope, book);
    await runNow(scope, connector.id);

    await book.put("ada", card("Ada King", "+1 415 555 0199"));
    await runNow(scope, connector.id);
    // The contact keeps its own name (docs/import-and-sync.md).
    expect(contactService.getContactById(scope, ada.id)!.name).toBe("Ada");

    contactService.updateContact(scope, ada.id, { tags: ["Friends"] });
    await runNow(scope, connector.id);
    const after = (await book.cards()).get("ada.vcf")!;
    expect(after).toContain("FN:Ada King");
    expect(after).not.toContain("0100");
    expect(after).toContain("CATEGORIES:Friends");
  });

  it("keeps writing a card's edits when a second card shares its address, and pushes to the card that made the contact", async () => {
    const { ownerId, scope } = labOwner();
    const book = await radicaleBook(`${ownerId}-dav`);
    await book.put(
      "a",
      vcard("UID:a", "FN:Mom Lee", "EMAIL:home@lee.example", "TITLE:Nurse"),
    );
    const connector = await connect(scope, book);
    await runNow(scope, connector.id);
    await book.put("b", vcard("UID:b", "FN:Dad Lee", "EMAIL:home@lee.example"));
    await runNow(scope, connector.id);

    await book.put(
      "a",
      vcard("UID:a", "FN:Mom Lee", "EMAIL:home@lee.example", "TITLE:Doctor"),
    );
    await runNow(scope, connector.id);
    const [mom] = ids(ownerId, "Mom Lee");
    expect(contactService.getContactById(scope, mom)!.role).toBe("Doctor");

    contactService.updateContact(scope, mom, { company: "Clinic" });
    await runNow(scope, connector.id);
    const cards = await book.cards();
    expect(cards.get("a.vcf")).toContain("ORG:Clinic");
    expect(cards.get("b.vcf")).not.toContain("ORG:Clinic");
  });

  it("keeps applying a card's edits after another connector uploads its contact", async () => {
    const { ownerId, scope } = labOwner();
    const bookA = await radicaleBook(`${ownerId}-a`);
    const bookB = await radicaleBook(`${ownerId}-b`);
    const sam = (fn: string) =>
      vcard("UID:sam", `FN:${fn}`, "EMAIL:sam@stone.example");
    await bookA.put("sam", sam("Sam Stone"));
    const a = await connect(scope, bookA, { syncDirection: "pull_only" });
    await runNow(scope, a.id);
    const b = await connect(scope, bookB, { pushExistingContacts: true });
    await runNow(scope, b.id);
    expect([...(await bookB.cards()).values()][0]).toContain("FN:Sam Stone");

    await bookA.put("sam", sam("Samuel Stone"));
    await runNow(scope, a.id);
    expect(ids(ownerId, "Samuel Stone")).toHaveLength(1);
    await runNow(scope, b.id);
    expect([...(await bookB.cards()).values()][0]).toContain("FN:Samuel Stone");
  });

  it("links the same cards again when the connector is removed and added back", async () => {
    const { ownerId, scope } = labOwner();
    const book = await radicaleBook(`${ownerId}-dav`);
    await book.put("solo", vcard("UID:solo", "FN:Name Only"));
    const first = await connect(scope, book);
    await runNow(scope, first.id);
    await deleteConnector(scope, first.id);

    const again = await connect(scope, book);
    await runNow(scope, again.id);
    expect(ids(ownerId, "Name Only")).toHaveLength(1);
  });

  it("only fills in a contact it uploaded before it was removed and added back", async () => {
    const { scope } = labOwner();
    const book = await radicaleBook(`${scope.ownerId}-dav`);
    const kai = contactService.createContact(scope, {
      name: "Kai Ito",
      company: "OldCo",
      emails: [{ email: "kai@ito.example" }],
    })!;
    const first = await connect(scope, book, { pushExistingContacts: true });
    await runNow(scope, first.id);
    expect((await book.cards()).size).toBe(1);
    await deleteConnector(scope, first.id);
    contactService.updateContact(scope, kai.id, {
      name: "Kai Ito-Sato",
      company: "NewCo",
    });

    const again = await connect(scope, book);
    await runNow(scope, again.id);
    const after = contactService.getContactById(scope, kai.id)!;
    expect([after.name, after.company]).toEqual(["Kai Ito-Sato", "NewCo"]);
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM contact_sources WHERE contactId = ?",
        )
        .get(kai.id),
    ).toEqual({ n: 1 });
  });

  it("writes a card's edits to a contact it uploaded, but not its own missing photo, and not when two books have it", async () => {
    const { ownerId, scope } = labOwner();
    const one = await radicaleBook(`${ownerId}-1`);
    const two = await radicaleBook(`${ownerId}-2`);
    const pia = contactService.createContact(scope, {
      name: "Pia Lund",
      emails: [{ email: "pia@lund.example" }],
    })!;
    const photo = `/uploads/u/${ownerId}/avatars/import-0123456789abcdef.jpg`;
    sqlite
      .prepare("UPDATE contacts SET avatarUrl = ? WHERE id = ?")
      .run(photo, pia.id);
    const card = (...lines: string[]) =>
      vcard(`UID:${pia.id}`, "EMAIL:pia@lund.example", ...lines);
    const c1 = await connect(scope, one, { pushExistingContacts: true });
    await runNow(scope, c1.id);

    // Contrack's card has no PHOTO: the owner's photo stays.
    await one.put(pia.id, card("FN:Pia Lund", "TITLE:Edited on phone"));
    await runNow(scope, c1.id);
    const edited = contactService.getContactById(scope, pia.id)!;
    expect([edited.role, edited.avatarUrl]).toEqual(["Edited on phone", photo]);

    // Uploaded to a second book too: neither copy writes over the contact.
    const c2 = await connect(scope, two, { pushExistingContacts: true });
    await runNow(scope, c2.id);
    await one.put(pia.id, card("FN:Pia From Book One"));
    await runNow(scope, c1.id);
    expect(contactService.getContactById(scope, pia.id)!.name).toBe("Pia Lund");
  });

  it("links a card an interrupted push uploaded instead of importing it twice", async () => {
    const { ownerId, scope } = labOwner();
    const book = await radicaleBook(`${ownerId}-dav`);
    const zoe = contactService.createContact(scope, { name: "Zoe Quinn" })!;
    // The PUT landed, and the run stopped before it saved the link.
    await book.put(zoe.id, vcard(`UID:${zoe.id}`, "FN:Zoe Quinn"));
    const connector = await connect(scope, book);
    await runNow(scope, connector.id);
    expect(ids(ownerId, "Zoe Quinn")).toEqual([zoe.id]);
    expect((await book.cards()).size).toBe(1);
  });

  it("takes back a photo the server removed", async () => {
    const { ownerId, scope } = labOwner();
    const book = await radicaleBook(`${ownerId}-dav`);
    const card = (...photo: string[]) =>
      vcard("UID:pic", "FN:Pic Person", "EMAIL:pic@lab.test", ...photo);
    await book.put("pic", card(`PHOTO;ENCODING=b;TYPE=image/png:${PHOTO}`));
    const connector = await connect(scope, book);
    await runNow(scope, connector.id);
    const [id] = ids(ownerId, "Pic Person");
    expect(contactService.getContactById(scope, id)!.avatarUrl).toMatch(
      /^\/uploads\//,
    );

    await book.put("pic", card());
    await runNow(scope, connector.id);
    expect(contactService.getContactById(scope, id)!.avatarUrl).toMatch(
      /^\/api\/avatar\//,
    );
  });
});
