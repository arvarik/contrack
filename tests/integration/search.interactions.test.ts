// =============================================================================
// Integration: the note search — GET /api/search/interactions
// =============================================================================
// Real database, real triggers, real route. What is pinned here is the
// promise the feature makes: a note written today is found today, an edited
// note is found by its new words and not its old ones, a deleted note is
// gone, a note on a contact the app hides is hidden with it, and "last month"
// means the caller's month.
// =============================================================================

import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";
import { localOwnerId } from "./tenancy/helpers.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";
import { sqlite } from "../../server/db.ts";
import { installSearchIndex } from "../../server/services/search/ftsIndex.ts";
import { searchInteractions } from "../../server/services/interactionSearchService.ts";
import type { InteractionSearchResult } from "../../src/types.ts";

const app = makeTestApp();
const scope = () => scopeForOwnerId(localOwnerId());

let contactCount = 0;
function contact(name = `Person ${++contactCount}`, extra = ""): string {
  const id = `c-${contactCount}-${Math.random().toString(36).slice(2, 8)}`;
  sqlite
    .prepare(
      `INSERT INTO contacts(id, name, ownerId${extra ? `, ${extra.split("=")[0].trim()}` : ""})
       VALUES (?, ?, ?${extra ? `, ${extra.split("=")[1].trim()}` : ""})`,
    )
    .run(id, name, localOwnerId());
  return id;
}

let noteCount = 0;
function note(
  contactId: string,
  title: string,
  content: string | null = null,
  fields: { date?: string; type?: string } = {},
): string {
  const id = `n-${++noteCount}`;
  sqlite
    .prepare(
      "INSERT INTO interactions(id, contactId, ownerId, type, title, content, date) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      id,
      contactId,
      localOwnerId(),
      fields.type ?? "note",
      title,
      content,
      fields.date ?? new Date().toISOString(),
    );
  return id;
}

const search = (query: Record<string, string | number>) =>
  request(app).get("/api/search/interactions").query(query);
const ids = (body: InteractionSearchResult) => body.hits.map((h) => h.id);
const ftsCount = () =>
  (
    sqlite.prepare("SELECT COUNT(*) AS n FROM interactions_fts").get() as {
      n: number;
    }
  ).n;

beforeEach(() => {
  sqlite.prepare("DELETE FROM contacts").run();
});

describe("the note index follows every write", () => {
  it("finds a note written through the API, with the person, the date and the passage", async () => {
    const created = await request(app).post("/api/contacts").send({
      name: "Sam Rivera",
      company: "Acme",
    });
    expect(created.status).toBe(201);
    const posted = await request(app)
      .post(`/api/contacts/${created.body.id}/interactions`)
      .send({
        type: "meeting",
        title: "Coffee with Sam",
        content:
          "<p>We <strong>discussed hiring</strong> plans for the Berlin office. Sam is hiring two engineers.</p>",
        date: "2026-08-12T10:00:00.000Z",
      });
    expect(posted.status).toBe(201);

    const res = await search({ q: "hiring" });
    expect(res.status).toBe(200);
    const body = res.body as InteractionSearchResult;
    expect(body.total).toBe(1);
    expect(body.query).toMatchObject({
      text: "hiring",
      tokens: ["hiring"],
      mode: "all",
      phrase: null,
      range: null,
      timeZone: "UTC",
    });
    const [hit] = body.hits;
    expect(hit).toMatchObject({
      id: posted.body.id,
      contactId: created.body.id,
      type: "meeting",
      title: "Coffee with Sam",
      date: "2026-08-12T10:00:00.000Z",
      contact: { id: created.body.id, name: "Sam Rivera", company: "Acme" },
    });
    expect(hit.excerpt).toBe(
      "We discussed hiring plans for the Berlin office. Sam is hiring two engineers.",
    );
    // The passage is plain text and the ranges point at the matched words.
    expect(hit.excerpt).not.toContain("<");
    expect(hit.highlights.excerpt).toHaveLength(2);
    for (const [start, end] of hit.highlights.excerpt) {
      expect(hit.excerpt!.slice(start, end).toLowerCase()).toBe("hiring");
    }
    expect(hit.highlights.title).toEqual([]);
  });

  it("follows an edit, a delete, and a contact's disappearance", async () => {
    const created = await request(app)
      .post("/api/contacts")
      .send({ name: "Edit Me" });
    const posted = await request(app)
      .post(`/api/contacts/${created.body.id}/interactions`)
      .send({ type: "note", title: "First", content: "<p>sailing plans</p>" });
    const noteId = posted.body.id as string;

    expect(ids((await search({ q: "sailing" })).body)).toEqual([noteId]);
    const patched = await request(app)
      .patch(`/api/interactions/${noteId}`)
      .send({ content: "<p>hiring plans</p>" });
    expect(patched.status).toBe(200);
    expect(ids((await search({ q: "sailing" })).body)).toEqual([]);
    expect(ids((await search({ q: "hiring" })).body)).toEqual([noteId]);

    const renamed = await request(app)
      .patch(`/api/interactions/${noteId}`)
      .send({ title: "Renamed" });
    expect(renamed.status).toBe(200);
    expect((await search({ q: "renamed" })).body.hits[0]).toMatchObject({
      title: "Renamed",
      highlights: { title: [[0, 7]] },
    });

    expect(
      (await request(app).delete(`/api/interactions/${noteId}`)).status,
    ).toBe(200);
    expect((await search({ q: "hiring" })).body.total).toBe(0);
    expect(ftsCount()).toBe(0);

    // A note whose contact is deleted goes with it, through the cascade.
    const again = await request(app)
      .post(`/api/contacts/${created.body.id}/interactions`)
      .send({ type: "note", title: "Second", content: "<p>hiring again</p>" });
    expect(again.status).toBe(201);
    expect(ftsCount()).toBe(1);
    sqlite.prepare("DELETE FROM contacts WHERE id = ?").run(created.body.id);
    expect(ftsCount()).toBe(0);
  });

  it("hides notes on archived, trashed, merged and ghost contacts, and shows them again", async () => {
    const active = contact("Active");
    const kept = note(active, "Kept", "hiring");
    for (const [name, column] of [
      ["Archived", "isArchived = 1"],
      ["Trashed", "deletedAt = datetime('now')"],
      ["Merged", `canonicalId = '${active}'`],
      ["Ghost", "isGhost = 1"],
    ]) {
      const id = contact(name);
      note(id, `${name} note`, "hiring");
      sqlite.prepare(`UPDATE contacts SET ${column} WHERE id = ?`).run(id);
    }
    expect(ftsCount()).toBe(5);
    expect(ids((await search({ q: "hiring" })).body)).toEqual([kept]);

    sqlite
      .prepare("UPDATE contacts SET isArchived = 0 WHERE name = 'Archived'")
      .run();
    expect((await search({ q: "hiring" })).body.total).toBe(2);
  });

  it("indexes a note inserted without an owner once the fill trigger stamps it", async () => {
    const id = contact("Seeded");
    sqlite
      .prepare(
        "INSERT INTO interactions(id, contactId, type, title, content) VALUES ('seeded', ?, 'note', 'From a seed', '<p>hiring</p>')",
      )
      .run(id);
    expect(
      sqlite
        .prepare("SELECT ownerId FROM interactions WHERE id = 'seeded'")
        .get(),
    ).toEqual({ ownerId: localOwnerId() });
    expect(ids((await search({ q: "hiring" })).body)).toEqual(["seeded"]);
  });

  it("follows a note to the contact it is moved to", async () => {
    const a = contact("Alpha");
    const b = contact("Beta");
    const id = note(a, "Moved", "hiring");
    sqlite
      .prepare("UPDATE interactions SET contactId = ? WHERE id = ?")
      .run(b, id);
    expect((await search({ q: "hiring" })).body.hits[0].contact).toMatchObject({
      id: b,
      name: "Beta",
    });
  });

  it("rebuilds from interactions when the schema version changes", async () => {
    const id = contact("Rebuilt");
    note(id, "Before", "hiring");
    sqlite.prepare("DELETE FROM interactions_fts").run();
    expect((await search({ q: "hiring" })).body.total).toBe(0);
    sqlite.pragma("user_version = 1");
    installSearchIndex(sqlite);
    expect(ftsCount()).toBe(1);
    expect((await search({ q: "hiring" })).body.total).toBe(1);
    // A second install on a current database writes nothing new.
    installSearchIndex(sqlite);
    expect(ftsCount()).toBe(1);
  });
});

describe("what the words match", () => {
  it("does not match tag names, attribute values or mention ids", async () => {
    const id = contact("Markup");
    note(
      id,
      "Formatted",
      `<p>Lunch with <span data-type="mention" class="mention" data-id="mention-target-9f2">@Priya Nair</span></p><ul><li>item</li></ul>`,
    );
    for (const word of ["span", "strong", "mention", "target", "class", "li"]) {
      expect((await search({ q: word })).body.total, word).toBe(0);
    }
    expect((await search({ q: "Priya" })).body.total).toBe(1);
  });

  it("matches by stem and folds accents", async () => {
    const id = contact("Stems");
    note(id, "Hiring freeze", "Two engineers. Café budget approved.");
    expect((await search({ q: "hire" })).body.total).toBe(1);
    expect((await search({ q: "engineer" })).body.total).toBe(1);
    expect((await search({ q: "cafe" })).body.total).toBe(1);
    expect((await search({ q: "caf" })).body.total).toBe(1);
  });

  it("ranks a title match above the same word in a body", async () => {
    const id = contact("Ranking");
    const body = note(
      id,
      "Weekly sync",
      "We talked about hiring at length, hiring is hard.",
    );
    const title = note(id, "Hiring plan", "Short.");
    expect(ids((await search({ q: "hiring" })).body)).toEqual([title, body]);
  });

  it("drops question words, then matches every word, then any word", async () => {
    const id = contact("Words");
    const both = note(id, "Both", "hiring plans for Berlin");
    const one = note(id, "One", "a hiring freeze");
    const all = await search({ q: "Who discussed hiring plans?" });
    expect(all.body.query).toMatchObject({
      tokens: ["hiring", "plans"],
      mode: "all",
    });
    expect(ids(all.body)).toEqual([both]);

    const any = await search({ q: "hiring freeze Berlin" });
    expect(any.body.query.mode).toBe("any");
    expect(new Set(ids(any.body))).toEqual(new Set([both, one]));

    const forced = await search({ q: "hiring plans", mode: "any" });
    expect(forced.body.query.mode).toBe("any");
    expect(forced.body.total).toBe(2);
    const strict = await search({ q: "hiring freeze Berlin", mode: "all" });
    expect(strict.body.query.mode).toBe("all");
    expect(strict.body.total).toBe(0);
  });

  it("searches the question words themselves when nothing else is left", async () => {
    const id = contact("Only");
    const hit = note(id, "Talk", "who did I talk to");
    const res = await search({ q: "who did I talk to" });
    expect(res.body.query.tokens).toEqual(["who", "did", "I", "talk", "to"]);
    expect(ids(res.body)).toEqual([hit]);
  });

  it("treats FTS syntax as words", async () => {
    const id = contact("Syntax");
    note(id, "Plain", "hiring");
    for (const q of [
      '"',
      "* () :",
      "hiring OR",
      "-hiring",
      "title:hiring",
      "NEAR(a b)",
    ]) {
      expect((await search({ q })).status, q).toBe(200);
    }
    expect((await search({ q: "hiring OR nothing" })).body.total).toBe(1);
  });

  it("shows the opening of the body when only the title matched", async () => {
    const id = contact("Opening");
    note(id, "Hiring", `<p>${"A long body. ".repeat(40)}</p>`);
    const [hit] = (await search({ q: "hiring" })).body.hits;
    expect(hit.highlights.title).toEqual([[0, 6]]);
    expect(hit.highlights.excerpt).toEqual([]);
    expect(hit.excerpt!.length).toBeLessThanOrEqual(241);
    expect(hit.excerpt!.endsWith("…")).toBe(true);
  });
});

describe("dates", () => {
  const seed = () => {
    const id = contact("Dated");
    return {
      id,
      sqliteForm: note(id, "Mid August", "hiring", {
        date: "2026-08-15 10:00:00",
      }),
      isoForm: note(id, "Late August", "hiring", {
        date: "2026-08-20T12:00:00.000Z",
      }),
      dayForm: note(id, "Last of August", "hiring", { date: "2026-08-31" }),
      laEvening: note(id, "August evening in LA", "hiring", {
        date: "2026-09-01T03:00:00.000Z",
      }),
      september: note(id, "September", "hiring", {
        date: "2026-09-10T09:00:00.000Z",
      }),
    };
  };

  it("filters every stored date shape by a calendar range, in UTC by default", async () => {
    const n = seed();
    const res = await search({
      q: "hiring",
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(res.body.query.range).toEqual({
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-09-01T00:00:00.000Z",
      source: "filter",
    });
    expect(new Set(ids(res.body))).toEqual(
      new Set([n.sqliteForm, n.isoForm, n.dayForm]),
    );
  });

  it("reads a calendar range in the caller's zone", async () => {
    const n = seed();
    const res = await search({
      q: "hiring",
      from: "2026-08-01",
      to: "2026-08-31",
      tz: "America/Los_Angeles",
    });
    expect(res.body.query.timeZone).toBe("America/Los_Angeles");
    expect(res.body.query.range.to).toBe("2026-09-01T07:00:00.000Z");
    expect(ids(res.body)).toContain(n.laEvening);
    expect(ids(res.body)).not.toContain(n.september);
  });

  it("takes an instant bound as it is, with an open other end", async () => {
    const n = seed();
    const res = await search({ q: "hiring", from: "2026-09-01T00:00:00.000Z" });
    expect(res.body.query.range).toEqual({
      from: "2026-09-01T00:00:00.000Z",
      to: null,
      source: "filter",
    });
    expect(new Set(ids(res.body))).toEqual(new Set([n.laEvening, n.september]));
  });

  it("lifts a date phrase out of the question", async () => {
    const id = contact("Phrased");
    const inRange = note(id, "In range", "hiring", {
      date: "2026-08-12T10:00:00.000Z",
    });
    note(id, "Out of range", "hiring", { date: "2026-06-12T10:00:00.000Z" });
    const result = searchInteractions(scope(), {
      q: "Who discussed hiring last month?",
      timeZone: "Europe/Berlin",
      now: new Date("2026-09-14T12:00:00.000Z"),
    });
    expect(result.query).toMatchObject({
      tokens: ["hiring"],
      phrase: "last month",
      range: {
        from: "2026-07-31T22:00:00.000Z",
        to: "2026-08-31T22:00:00.000Z",
        source: "phrase",
      },
    });
    expect(result.hits.map((h) => h.id)).toEqual([inRange]);

    // Over HTTP the clock is the real one, so only the shape is pinned.
    const res = await search({ q: "hiring last month", tz: "Europe/Berlin" });
    expect(res.body.query.phrase).toBe("last month");
    expect(res.body.query.range.source).toBe("phrase");
    expect(res.body.query.range.from).toMatch(
      /T22:00:00\.000Z$|T23:00:00\.000Z$/,
    );
  });

  it("lets an explicit range override the phrase, which still leaves the text", async () => {
    const id = contact("Override");
    const hit = note(id, "June", "hiring", {
      date: "2026-06-12T10:00:00.000Z",
    });
    const res = await search({
      q: "hiring last month",
      from: "2026-06-01",
      to: "2026-06-30",
    });
    expect(res.body.query).toMatchObject({
      tokens: ["hiring"],
      phrase: "last month",
      range: { source: "filter" },
    });
    expect(ids(res.body)).toEqual([hit]);
  });

  it("browses a period with no words, newest first, with the opening of each note", async () => {
    const n = seed();
    const res = await search({ from: "2026-08-01", to: "2026-08-31" });
    expect(res.body.query.mode).toBe("none");
    expect(ids(res.body)).toEqual([n.dayForm, n.isoForm, n.sqliteForm]);
    expect(res.body.hits[0].excerpt).toBe("hiring");
    expect(res.body.hits[0].highlights).toEqual({ title: [], excerpt: [] });
  });

  it("orders by date on request, and by relevance by default", async () => {
    const id = contact("Ordered");
    const older = note(id, "Hiring plan", "hiring hiring hiring", {
      date: "2026-01-01T00:00:00.000Z",
    });
    const newer = note(id, "Sync", "mentions hiring once", {
      date: "2026-08-01T00:00:00.000Z",
    });
    expect(ids((await search({ q: "hiring" })).body)).toEqual([older, newer]);
    expect(ids((await search({ q: "hiring", sort: "date" })).body)).toEqual([
      newer,
      older,
    ]);
  });
});

describe("filters and pages", () => {
  it("filters by kind and by contact", async () => {
    const a = contact("Alpha");
    const b = contact("Beta");
    const call = note(a, "Call", "hiring", { type: "call" });
    const noteA = note(a, "Note", "hiring");
    const noteB = note(b, "Note", "hiring");
    expect(ids((await search({ q: "hiring", type: "call" })).body)).toEqual([
      call,
    ]);
    expect(
      new Set(ids((await search({ q: "hiring", contactId: a })).body)),
    ).toEqual(new Set([call, noteA]));
    expect(ids((await search({ contactId: b })).body)).toEqual([noteB]);
  });

  it("pages with a stable total", async () => {
    const id = contact("Pages");
    for (let i = 0; i < 25; i++)
      note(id, `Note ${i}`, "hiring", {
        date: `2026-08-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
      });
    const first = await search({ q: "hiring", limit: 10 });
    expect(first.body).toMatchObject({ total: 25, limit: 10, offset: 0 });
    expect(first.body.hits).toHaveLength(10);
    const last = await search({ q: "hiring", limit: 10, offset: 20 });
    expect(last.body).toMatchObject({ total: 25, limit: 10, offset: 20 });
    expect(last.body.hits).toHaveLength(5);
    const beyond = await search({ q: "hiring", limit: 10, offset: 40 });
    expect(beyond.body).toMatchObject({ total: 25, hits: [] });
  });

  it("answers an empty search with nothing rather than everything", async () => {
    note(contact("Quiet"), "A note", "hiring");
    const res = await search({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 0, hits: [] });
    expect((await search({ q: "   " })).body.total).toBe(0);
  });

  it("refuses what it cannot read", async () => {
    const bad: Record<string, string | number>[] = [
      { q: "x", limit: 0 },
      { q: "x", limit: 51 },
      { q: "x", offset: -1 },
      { q: "x", tz: "Mars/Olympus_Mons" },
      { q: "x", from: "yesterday" },
      { q: "x", sort: "title" },
      { q: "x", mode: "some" },
      { q: "x".repeat(501) },
    ];
    for (const query of bad) {
      const res = await search(query);
      expect(res.status, JSON.stringify(query)).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
    expect(
      (await request(app).get("/api/search/interactions?q=a&q=b")).status,
    ).toBe(400);
  });
});

describe("the MCP route", () => {
  it("answers with the hits as an array, each naming its contact", async () => {
    const id = contact("Machine");
    const hit = note(id, "Proposal draft", "<p>hiring proposal</p>", {
      date: "2026-08-12T10:00:00.000Z",
    });
    const res = await request(app)
      .get("/api/interactions/search")
      .query({ q: "proposal", from: "2026-08-01", to: "2026-08-31" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      id: hit,
      contactId: id,
      contactName: "Machine",
      title: "Proposal draft",
      excerpt: "hiring proposal",
      contact: { id, name: "Machine" },
    });
    expect((await request(app).get("/api/interactions/search")).status).toBe(
      200,
    );
    expect((await request(app).get("/api/interactions/search")).body).toEqual(
      [],
    );
    expect(
      (
        await request(app)
          .get("/api/interactions/search")
          .query({ q: "x", limit: 0 })
      ).status,
    ).toBe(400);
  });
});
