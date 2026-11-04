/**
 * The CardDAV connector against Radicale, both ways.
 */

import { describe, expect, it } from "vitest";
import { sqlite } from "../../server/db.ts";
import { createConnector, runNow } from "../../server/connectors/service.ts";
import { contactService } from "../../server/services/contactService.ts";
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
});
