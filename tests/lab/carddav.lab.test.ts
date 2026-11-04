/**
 * The CardDAV connector against Radicale, both ways: the main proof of CardDAV
 * sync. tests/integration/connectors.carddav.test.ts has the answers Radicale
 * cannot give.
 */

import { describe, expect, it } from "vitest";
import { sqlite } from "../../server/db.ts";
import {
  createConnector,
  deleteConnector,
  runNow,
  testConnector,
  updateConnector,
} from "../../server/connectors/service.ts";
import { contactService } from "../../server/services/contactService.ts";
import { mergeContacts } from "../../server/services/dedupe/merging.ts";
import type { Scope } from "../../server/tenancy/scope.ts";
import { labOwner, RADICALE, radicaleBook, vcard } from "./helpers.ts";

// A 1x1 PNG.
const PHOTO =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** A new owner with an empty book. */
async function setup() {
  const owner = labOwner();
  return { ...owner, book: await radicaleBook(`${owner.ownerId}-dav`) };
}
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
  sqlite
    .prepare("SELECT id FROM contacts WHERE ownerId = ? AND name = ?")
    .pluck()
    .all(ownerId, name) as string[];
const get = (scope: Scope, id: string) =>
  contactService.getContactById(scope, id)!;
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

describe("CardDAV against Radicale", () => {
  it("pulls cards, follows the server's edits and deletions, and pushes Contrack's changes without losing the server's fields", async () => {
    const { ownerId, scope, book } = await setup();
    const ana = (phone: string, keep = "server only") =>
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
        `X-LAB-KEEP:${keep}`,
        `PHOTO;ENCODING=b;TYPE=PNG:${PHOTO}`,
      );
    await book.put("ana-lab", ana("+1 415 555 0101"));
    await book.put(
      "bob-lab",
      vcard("UID:bob-lab", "FN:Bob Stone", "EMAIL:bob@stone.example"),
    );
    const connector = await connect(scope, book);
    const run = () => runNow(scope, connector.id);
    const id = (name: string) => ids(ownerId, name)[0]!;

    const first = await run();
    expect([first.status, first.stats.errors ?? 0]).toEqual(["ok", 0]);
    const pulled = get(scope, id("Ana Lee"));
    expect(pulled).toMatchObject({
      company: "Lee Labs",
      birthday: "1990-05-14",
      about: "Met at the conference.",
      website: "https://ana.example",
      emails: [{ email: "ana@lee.example", label: "work" }],
      phones: [{ phone: "+1 415 555 0101" }],
    });
    expect(pulled.tags.map((t) => t.tag).sort()).toEqual([
      "Climbing",
      "Friends",
    ]);
    expect(pulled.addresses?.[0]?.address).toContain("1 Main St");
    expect(pulled.avatarUrl).toBeTruthy();

    // On the server: a new number for Ana, and Bob deleted, which unlinks
    // him and keeps him and his source out of the Trash
    // (docs/import-and-sync.md).
    await book.put("ana-lab", ana("+1 415 555 0199"));
    await book.remove("bob-lab");
    await run();
    expect(get(scope, id("Ana Lee")).phones.map((p) => p.phone)).toEqual([
      "+1 415 555 0199",
    ]);
    const bob = id("Bob Stone");
    expect(
      sqlite
        .prepare(
          `SELECT (SELECT deletedAt FROM contacts WHERE id = @bob) AS deletedAt,
             (SELECT COUNT(*) FROM connector_links WHERE localId = @bob) AS links,
             (SELECT COUNT(*) FROM contact_sources WHERE contactId = @bob) AS sources`,
        )
        .get({ bob }),
    ).toEqual({ deletedAt: null, links: 0, sources: 1 });

    // In Contrack: a new contact, an edit to Bob, which uploads him again,
    // and Ana's company changed while the server changed only a field
    // Contrack does not read, so the pull leaves her edit alone.
    contactService.createContact(scope, {
      name: "Cara Diaz",
      emails: [{ email: "cara@diaz.example", label: "personal" }],
    });
    contactService.updateContact(scope, bob, { company: "Stone Co" });
    contactService.updateContact(scope, id("Ana Lee"), {
      company: "Lee Robotics",
    });
    await book.put("ana-lab", ana("+1 415 555 0199", "edited on the server"));
    await run();
    let cards = await book.cards();
    const card = (fn: string) =>
      [...cards.values()].find((c) => c.includes(`FN:${fn}`));
    expect(card("Cara Diaz")).toContain("cara@diaz.example");
    expect(card("Bob Stone")).toContain("ORG:Stone Co");
    const anaCard = cards.get("ana-lab.vcf")!;
    for (const line of [
      "ORG:Lee Robotics",
      "X-LAB-KEEP:edited on the",
      "PHOTO",
    ])
      expect(anaCard).toContain(line);

    // The same after that push, whose card has the photo.
    contactService.updateContact(scope, id("Ana Lee"), { role: "CEO" });
    await book.put("ana-lab", anaCard.replace("on the server", "again"));
    await run();
    expect((await book.cards()).get("ana-lab.vcf")).toContain("TITLE:CEO");

    // Merged into another contact, Ana's card carries that contact.
    const king = contactService.createContact(scope, { name: "Ana King" })!;
    mergeContacts(scope, king.id, id("Ana Lee"), "lab");
    await run();
    cards = await book.cards();
    expect(cards.get("ana-lab.vcf")).toContain("FN:Ana King");
    expect(cards.size).toBe(3);
  });

  it("uploads only the contacts edited after Two-way sync starts, whatever else touched them", async () => {
    const { scope, book } = await setup();
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
      config: { url: `${RADICALE}/`, username: book.user },
    });
    expect((await runNow(scope, connector.id)).status).toBe("ok");
    expect([...(await book.cards()).keys()]).toEqual(["srv.vcf"]);

    contactService.updateContact(scope, pre.id, { company: "Edited" });
    await runNow(scope, connector.id);
    const cards = [...(await book.cards()).values()];
    expect(cards.filter((c) => c.includes("ORG:Edited"))).toHaveLength(1);
    expect(cards).toHaveLength(2);

    // A first sync that comes late, after meetings touched an older contact.
    const late = await setup();
    const touched = contactService.createContact(late.scope, {
      name: "Touched",
    })!;
    older(touched.id);
    const second = await connect(late.scope, late.book);
    touch(touched.id);
    await runNow(late.scope, second.id);
    expect((await late.book.cards()).size).toBe(0);
  });

  it("keeps the server's edits to a contact Contrack had before it connected, and takes an earlier version's baseline as it is", async () => {
    const { scope, book } = await setup();
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
    expect(get(scope, ada.id).name).toBe("Ada");

    // A whole-card hash that an earlier version saved is a baseline, not a
    // reason to write every field.
    sqlite
      .prepare(
        `UPDATE connectors SET cursor = json_set(cursor, '$.pushedHashes."' || ? || '"', '0123456789abcdef') WHERE id = ?`,
      )
      .run(ada.id, connector.id);
    await runNow(scope, connector.id);

    contactService.updateContact(scope, ada.id, { tags: ["Friends"] });
    await runNow(scope, connector.id);
    const after = (await book.cards()).get("ada.vcf")!;
    expect(after).toContain("FN:Ada King");
    expect(after).not.toContain("0100");
    expect(after).toContain("CATEGORIES:Friends");
  });

  it("checks the chosen book, takes its URL with or without the slash, and unlinks the old book's cards on a switch", async () => {
    const { ownerId, scope, book } = await setup();
    const other = await radicaleBook(book.user, "other");
    await book.put("solo", vcard("UID:solo", "FN:Solo Card"));
    await other.put("pair", vcard("UID:pair", "FN:Pair Card"));
    const missing = `${RADICALE}/${book.user}/missing/`;
    const tested = await testConnector(
      scope,
      "carddav",
      { url: `${RADICALE}/`, username: book.user, addressBookUrl: missing },
      { password: "lab" },
    );
    expect(tested.detail).toMatch(/not found; switched to/);
    for (const config of [
      { addressBookUrl: missing },
      { url: book.url, addressBookUrl: other.url },
    ]) {
      await expect(connect(scope, book, config)).rejects.toThrow(
        /not found on the CardDAV server/,
      );
    }

    const connector = await connect(scope, book, {
      url: book.url.slice(0, -1),
    });
    await runNow(scope, connector.id);
    const save = (config: Record<string, unknown>) =>
      updateConnector(scope, connector.id, {
        config: { url: book.url, username: book.user, ...config },
        secret: { password: "lab" },
      });
    await save({});
    expect((await runNow(scope, connector.id)).stats.contacts).toBe(0);

    await save({
      url: `${RADICALE}/`,
      addressBookUrl: other.url,
      syncDirection: "pull_only",
    });
    await runNow(scope, connector.id);
    expect(ids(ownerId, "Solo Card")).toHaveLength(1);
    expect(
      sqlite
        .prepare("SELECT externalId FROM connector_links WHERE connectorId = ?")
        .pluck()
        .all(connector.id),
    ).toEqual([`/${book.user}/other/pair.vcf`]);
  });

  it("keeps writing a card's edits when a second card shares its address, and pushes to the card that made the contact", async () => {
    const { ownerId, scope, book } = await setup();
    const mom = (title: string) =>
      vcard("UID:a", "FN:Mom Lee", "EMAIL:home@lee.example", `TITLE:${title}`);
    await book.put("a", mom("Nurse"));
    const connector = await connect(scope, book);
    await runNow(scope, connector.id);
    await book.put("b", vcard("UID:b", "FN:Dad Lee", "EMAIL:home@lee.example"));
    await runNow(scope, connector.id);

    await book.put("a", mom("Doctor"));
    await runNow(scope, connector.id);
    const [id] = ids(ownerId, "Mom Lee");
    expect(get(scope, id!).role).toBe("Doctor");

    contactService.updateContact(scope, id!, { company: "Clinic" });
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

  it("links the same cards when the connector is removed and added back, and only fills in a contact it had uploaded", async () => {
    const { ownerId, scope, book } = await setup();
    await book.put("solo", vcard("UID:solo", "FN:Name Only"));
    const kai = contactService.createContact(scope, {
      name: "Kai Ito",
      company: "OldCo",
      emails: [{ email: "kai@ito.example" }],
    })!;
    const first = await connect(scope, book, { pushExistingContacts: true });
    await runNow(scope, first.id);
    expect((await book.cards()).size).toBe(2);
    await deleteConnector(scope, first.id);
    contactService.updateContact(scope, kai.id, {
      name: "Kai Ito-Sato",
      company: "NewCo",
    });

    const again = await connect(scope, book);
    await runNow(scope, again.id);
    expect(ids(ownerId, "Name Only")).toHaveLength(1);
    const after = get(scope, kai.id);
    expect([after.name, after.company]).toEqual(["Kai Ito-Sato", "NewCo"]);
    expect(
      sqlite
        .prepare("SELECT COUNT(*) FROM contact_sources WHERE contactId = ?")
        .pluck()
        .get(kai.id),
    ).toBe(1);
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
    const edited = get(scope, pia.id);
    expect([edited.role, edited.avatarUrl]).toEqual(["Edited on phone", photo]);

    // Uploaded to a second book too: neither copy writes over the contact.
    const c2 = await connect(scope, two, { pushExistingContacts: true });
    await runNow(scope, c2.id);
    await one.put(pia.id, card("FN:Pia From Book One"));
    await runNow(scope, c1.id);
    expect(get(scope, pia.id).name).toBe("Pia Lund");
  });

  it("links a card an interrupted push uploaded instead of importing it twice", async () => {
    const { ownerId, scope, book } = await setup();
    const zoe = contactService.createContact(scope, { name: "Zoe Quinn" })!;
    // The PUT landed, and the run stopped before it saved the link.
    await book.put(zoe.id, vcard(`UID:${zoe.id}`, "FN:Zoe Quinn"));
    const connector = await connect(scope, book);
    await runNow(scope, connector.id);
    expect(ids(ownerId, "Zoe Quinn")).toEqual([zoe.id]);
    expect((await book.cards()).size).toBe(1);
  });

  it("takes back a photo the server removed", async () => {
    const { ownerId, scope, book } = await setup();
    const card = (...photo: string[]) =>
      vcard("UID:pic", "FN:Pic Person", "EMAIL:pic@lab.test", ...photo);
    await book.put("pic", card(`PHOTO;ENCODING=b;TYPE=image/png:${PHOTO}`));
    const connector = await connect(scope, book);
    await runNow(scope, connector.id);
    const [id] = ids(ownerId, "Pic Person");
    expect(get(scope, id!).avatarUrl).toMatch(/^\/uploads\//);

    await book.put("pic", card());
    await runNow(scope, connector.id);
    expect(get(scope, id!).avatarUrl).toMatch(/^\/api\/avatar\//);
  });
});
