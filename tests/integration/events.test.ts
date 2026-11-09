// Integration: domain events and their subscribers.
// A write records an event in its own transaction, and the subscribers react
// after the commit (server/events/). Four guarantees:
//
//   1. A rename through PATCH and through PUT gets the same reactions: the
//      dedupe vector, the search index and the duplicate check.
//   2. An event recorded in a transaction that rolls back is never
//      dispatched, even when a nested write asks for a dispatch before the
//      rollback.
//   3. A subscriber that throws does not undo the write, and runs again at
//      the next dispatch.
//   4. A tag rename and a tag delete, which change contacts outside
//      contactService, record an event for every contact they change, so the
//      same subscribers react.
//
// The search index is proved by its own call: the `search_vector_update`
// trigger queues a renamed contact too, so the queue row alone would pass
// without the subscriber. Background jobs are off, so the duplicate check is
// the job row it leaves queued.

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const embedded = vi.fn<(contactId: string) => void>();
vi.mock("../../server/services/dedupe/embeddings.ts", async (importActual) => {
  const actual =
    await importActual<
      typeof import("../../server/services/dedupe/embeddings.ts")
    >();
  return {
    ...actual,
    generateAndStoreEmbedding: async (contactId: string) => {
      embedded(contactId);
      return true;
    },
  };
});

const indexed = vi.fn<(contactId: string) => void>();
vi.mock("../../server/services/search/indexQueue.ts", async (importActual) => {
  const actual =
    await importActual<
      typeof import("../../server/services/search/indexQueue.ts")
    >();
  return {
    ...actual,
    scheduleSearchIndex: (contactId: string) => {
      indexed(contactId);
      actual.scheduleSearchIndex(contactId);
    },
  };
});

const { makeTestApp } = await import("./helpers.ts");
const { sqlite } = await import("../../server/db.ts");
const { scopeForOwnerId } = await import("../../server/tenancy/scope.ts");
const { localOwnerId } = await import("./tenancy/helpers.ts");
const { dispatchEvents, recordEvent, registerSubscriber } =
  await import("../../server/events/index.ts");

const app = makeTestApp();

async function addContact(name: string): Promise<string> {
  const res = await request(app).post("/api/contacts").send({ name });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

interface JobRow {
  kind: string;
  status: string;
  runAt: string;
  ownerId: string | null;
  payload: string;
}

function dedupeChecks(contactId: string): JobRow[] {
  return sqlite
    .prepare(
      `SELECT kind, status, runAt, ownerId, payload FROM jobs
        WHERE dedupeKey = ?`,
    )
    .all(`dedupe.check:${contactId}`) as JobRow[];
}

beforeEach(() => {
  embedded.mockClear();
  indexed.mockClear();
});

describe("a rename", () => {
  it.each([["PATCH"], ["PUT"]] as const)(
    "through %s gets the dedupe vector, the search index and the duplicate check",
    async (method) => {
      const id = await addContact(`Ada ${method}`);
      // What the create itself queued and called.
      sqlite
        .prepare("DELETE FROM jobs WHERE dedupeKey = ?")
        .run(`dedupe.check:${id}`);
      embedded.mockClear();
      indexed.mockClear();

      const before = Date.now();
      const send =
        method === "PATCH"
          ? request(app).patch(`/api/contacts/${id}`)
          : request(app).put(`/api/contacts/${id}`);
      const res = await send.send({ name: `Ada Lovelace ${method}` });

      expect(res.status).toBe(200);
      expect(embedded).toHaveBeenCalledWith(id);
      expect(indexed).toHaveBeenCalledWith(id);
      const checks = dedupeChecks(id);
      expect(checks).toHaveLength(1);
      expect(checks[0]).toMatchObject({
        kind: "dedupe.check",
        status: "queued",
        ownerId: localOwnerId(),
      });
      expect(JSON.parse(checks[0].payload)).toEqual({ contactId: id });
      // Five seconds out, as the debounce has always been.
      expect(Date.parse(checks[0].runAt)).toBeGreaterThanOrEqual(
        before + 5_000,
      );
    },
  );
});

describe("an event in a transaction that rolls back", () => {
  it("is never dispatched", async () => {
    const seen: string[] = [];
    registerSubscriber({
      id: "test.rollback",
      types: ["list.members_changed"],
      handle(event) {
        seen.push(event.subjectId);
      },
    });
    const scope = scopeForOwnerId(localOwnerId());

    expect(() =>
      sqlite.transaction(() => {
        recordEvent(scope, "list.members_changed", "rolled-back", {
          added: ["someone"],
          removed: [],
        });
        // A nested write asks for its dispatch before the outer write fails.
        dispatchEvents();
        throw new Error("the write failed");
      })(),
    ).toThrow("the write failed");
    // Past the microtask the nested dispatch waited for, and a turn more.
    await new Promise((resolve) => setImmediate(resolve));
    dispatchEvents();
    expect(seen).toEqual([]);

    // The same write, committed, is dispatched, so the subscriber listens.
    sqlite.transaction(() => {
      recordEvent(scope, "list.members_changed", "committed", {
        added: ["someone"],
        removed: [],
      });
    })();
    dispatchEvents();
    expect(seen).toEqual(["committed"]);
  });
});

describe("a subscriber that throws", () => {
  it("does not undo the write, and runs again at the next dispatch", async () => {
    const id = await addContact("Grace Hopper");
    let tries = 0;
    const handled: string[] = [];
    registerSubscriber({
      id: "test.throwsOnce",
      types: ["contact.updated"],
      handle(event) {
        tries += 1;
        if (tries === 1) throw new Error("not this time");
        handled.push(event.subjectId);
      },
    });

    const res = await request(app)
      .patch(`/api/contacts/${id}`)
      .send({ company: "Navy" });

    expect(res.status).toBe(200);
    expect(res.body.company).toBe("Navy");
    expect(
      sqlite.prepare("SELECT company FROM contacts WHERE id = ?").get(id),
    ).toEqual({ company: "Navy" });
    expect(tries).toBe(1);
    expect(handled).toEqual([]);

    dispatchEvents();

    expect(tries).toBe(2);
    expect(handled).toEqual([id]);
  });
});

describe("a tag rename and a tag delete", () => {
  it("record contact.updated for every contact they change, and the search index follows", async () => {
    const tagged = async (name: string, tags: string[]) => {
      const res = await request(app).post("/api/contacts").send({ name, tags });
      expect(res.status).toBe(201);
      return res.body.id as string;
    };
    const newestEvent = () =>
      (
        sqlite
          .prepare("SELECT COALESCE(MAX(id), 0) AS id FROM events")
          .get() as { id: number }
      ).id;
    const updatedSince = (after: number) =>
      (
        sqlite
          .prepare(
            `SELECT subjectId, payload FROM events
              WHERE id > ? AND type = 'contact.updated'
              ORDER BY subjectId`,
          )
          .all(after) as { subjectId: string; payload: string }[]
      ).map((row) => ({ id: row.subjectId, payload: JSON.parse(row.payload) }));
    const tagsChanged = (...ids: string[]) =>
      [...ids]
        .sort()
        .map((id) => ({ id, payload: { changed: ["tags"], bulk: true } }));

    const one = await tagged("Tag Events One", ["evt-old"]);
    const both = await tagged("Tag Events Both", ["evt-old", "evt-new"]);
    const other = await tagged("Tag Events Other", ["evt-other"]);

    let mark = newestEvent();
    indexed.mockClear();
    const renamed = await request(app)
      .patch("/api/tags/evt-old")
      .send({ to: "evt-new" });

    expect(renamed.status).toBe(200);
    expect(renamed.body).toEqual({ affected: 2 });
    expect(updatedSince(mark)).toEqual(tagsChanged(one, both));
    // tagService no longer queues the index itself, so these calls prove the
    // subscriber reacted to the events.
    expect(indexed).toHaveBeenCalledWith(one);
    expect(indexed).toHaveBeenCalledWith(both);
    expect(indexed).not.toHaveBeenCalledWith(other);

    mark = newestEvent();
    indexed.mockClear();
    const deleted = await request(app).delete("/api/tags/evt-new");

    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ affected: 2 });
    expect(updatedSince(mark)).toEqual(tagsChanged(one, both));
    expect(indexed).toHaveBeenCalledWith(one);
    expect(indexed).toHaveBeenCalledWith(both);
  });
});
