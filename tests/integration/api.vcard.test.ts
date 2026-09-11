// =============================================================================
// Integration: the vCard round trip, through the real API
// =============================================================================
// The unit test walks a contact through the serializer and the parser. This
// one walks it through the product: contacts are created with POST, exported
// with GET, parsed the way the import modal parses a dropped file, and posted
// back. What comes out of the second import has to be the same people.
//
// That is the whole claim of "migration in and out is honest for a self-hosted
// tool", and it is the only test that can make it, because it is the only one
// that exercises the repository's own writing and hydration on both sides.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";
import { sqlite } from "../../server/db.ts";
import { parseVCard } from "../../src/lib/importers.ts";
import { parseVCards } from "../../shared/vcard.ts";

let app: ReturnType<typeof makeTestApp>;

const PEOPLE = [
  {
    name: "Ada Lovelace",
    firstName: "Ada",
    lastName: "Lovelace",
    company: "Analytical Engines",
    role: "Mathematician",
    about: "Wrote the first algorithm.",
    emails: [
      { email: "ada@analytical.example", label: "work", isPrimary: true },
      { email: "ada@home.example", label: "home", isPrimary: false },
    ],
    phones: [{ phone: "+44 20 7946 0000", label: "mobile", isPrimary: true }],
    tags: ["mathematician", "founder"],
  },
  {
    // The values that break a naive exporter, through the whole pipeline.
    name: "Smith; Jr., Robert",
    firstName: "Robert",
    lastName: "Smith; Jr.",
    company: "Widgets, Incorporated",
    about: "A note\nover two lines, with a comma.",
    emails: [{ email: "rob@widgets.example", label: "work", isPrimary: true }],
    tags: ["needs, review"],
  },
  {
    name: "José García",
    firstName: "José",
    lastName: "García",
    company: "Instituto Nacional",
    emails: [
      { email: "jose@instituto.example", label: "work", isPrimary: true },
    ],
  },
];

beforeAll(async () => {
  app = makeTestApp();
  for (const person of PEOPLE) {
    const res = await request(app).post("/api/contacts").send(person);
    expect(res.status).toBe(201);
  }
});

afterAll(() => {
  app.close();
});

const exportVcf = async () => {
  const res = await request(app).get("/api/export/vcard");
  expect(res.status).toBe(200);
  return res.text;
};

describe("GET /api/export/vcard", () => {
  it("serves a file an address book will open", async () => {
    const res = await request(app).get("/api/export/vcard");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/vcard");
    expect(res.headers["content-disposition"]).toMatch(/\.vcf"$/);
    // Extra F1 put no-store on the export prefix, and an export is the
    // caller's whole address book.
    expect(res.headers["cache-control"]).toContain("no-store");
  });

  it("writes one card per contact", async () => {
    const cards = parseVCards(await exportVcf());
    expect(cards).toHaveLength(PEOPLE.length);
  });

  it("leaves out contacts the person deleted", async () => {
    const created = await request(app)
      .post("/api/contacts")
      .send({ name: "Deleted Person" });
    await request(app).delete(`/api/contacts/${created.body.id}`);

    const vcf = await exportVcf();
    expect(vcf).not.toContain("Deleted Person");

    // And it is in the trash rather than gone, so this is about the export
    // rather than about the delete.
    const trash = await request(app).get("/api/trash");
    expect(trash.body.items.map((c: { name: string }) => c.name)).toContain(
      "Deleted Person",
    );
  });

  it("leaves out ghosts, which have no card to write", async () => {
    // A ghost is a name Contrack pulled out of a note. It has no email, no
    // phone and often no surname; exporting a thousand into somebody's phone
    // is not migration.
    sqlite
      .prepare(
        `INSERT INTO contacts (id, ownerId, name, isGhost, addedAt, updatedAt)
         SELECT 'ghost-vcf', ownerId, 'Ghosty McGhostface', 1,
                datetime('now'), datetime('now')
           FROM contacts LIMIT 1`,
      )
      .run();

    expect(await exportVcf()).not.toContain("Ghosty");
  });
});

describe("out and back in", () => {
  it("returns the same people, field for field", async () => {
    const vcf = await exportVcf();

    // Exactly what the import modal does with a dropped .vcf.
    const parsed = parseVCard(vcf, "apple");
    expect(parsed).toHaveLength(PEOPLE.length);

    const before = await request(app).get("/api/contacts");
    const beforeCount = before.body.length;

    const imported = await request(app)
      .post("/api/contacts/bulk")
      .send(parsed.map((c) => ({ ...c, name: `${c.name} (copy)` })));
    expect(imported.status).toBe(201);

    const after = await request(app).get("/api/contacts");
    expect(after.body).toHaveLength(beforeCount + PEOPLE.length);

    for (const original of PEOPLE) {
      const copy = (after.body as { name: string; id: string }[]).find(
        (c) => c.name === `${original.name} (copy)`,
      );
      expect(copy, original.name).toBeDefined();

      const full = await request(app).get(`/api/contacts/${copy!.id}`);
      expect(full.status).toBe(200);
      expect(full.body.firstName).toBe(original.firstName ?? null);
      expect(full.body.lastName).toBe(original.lastName ?? null);
      expect(full.body.company).toBe(original.company ?? null);
      expect(full.body.role).toBe(original.role ?? null);
      expect(full.body.about).toBe(original.about ?? null);
      expect(
        full.body.emails.map((e: { email: string }) => e.email).sort(),
      ).toEqual((original.emails ?? []).map((e) => e.email).sort());
      expect(
        full.body.phones.map((p: { phone: string }) => p.phone).sort(),
      ).toEqual((original.phones ?? []).map((p) => p.phone).sort());
      expect(full.body.tags.map((t: { tag: string }) => t.tag).sort()).toEqual(
        (original.tags ?? []).slice().sort(),
      );
    }
  });

  it("keeps a semicolon in a surname a semicolon", async () => {
    // The single most common way a vCard implementation is wrong: `N` is a
    // structured value, and splitting it before unescaping turns "Smith; Jr."
    // into a surname of "Smith" and a given name of " Jr.".
    const parsed = parseVCard(await exportVcf(), "apple");
    const rob = parsed.find((c) => c.lastName === "Smith; Jr.");
    expect(rob).toBeDefined();
    expect(rob!.firstName).toBe("Robert");
    expect(rob!.company).toBe("Widgets, Incorporated");
    expect(rob!.tags).toEqual(["needs, review"]);
  });

  it("keeps accented names intact", async () => {
    const parsed = parseVCard(await exportVcf(), "apple");
    const jose = parsed.find((c) => c.name === "José García");
    expect(jose).toBeDefined();
    expect(jose!.firstName).toBe("José");
    expect(jose!.lastName).toBe("García");
  });
});
