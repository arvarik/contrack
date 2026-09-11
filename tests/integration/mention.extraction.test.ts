// =============================================================================
// Integration Tests — what saving a note actually does with the names in it
// =============================================================================
// `mention.resolution.test.ts` covers the decision. This covers the wiring:
// that a saved note reaches the resolver, that a confident answer attaches the
// mention to the contact already there instead of making a ghost, and that a
// plausible one reaches the review queue rather than nowhere.
//
// Background jobs are on in this file and off everywhere else, because the
// extraction runs on a timer after the response has gone. The model is
// mocked: what it returns is not what is under test, and a real provider call
// would make this a contract test.
// =============================================================================

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import request from "supertest";

/** Names the mocked model "finds" in the next note. */
let extracted: { name: string; company?: string | null; context: string }[] =
  [];

vi.mock("../../server/ai/aiService.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../server/ai/aiService.ts")>();
  return { ...actual, extractMentions: vi.fn(async () => extracted) };
});

const { makeTestApp } = await import("./helpers.ts");
const { sqlite } = await import("../../server/db.ts");
const { createActor, asUser, resetAccounts } =
  await import("./tenancy/helpers.ts");
const { contactRepo } =
  await import("../../server/repositories/contactRepository.ts");
const { computePrimaryScore } =
  await import("../../server/services/dedupe/clustering.ts");
const { scopeForOwnerId } = await import("../../server/tenancy/scope.ts");
const { doubleMetaphone } = await import("../../server/utils/nlp/index.ts");

const app = makeTestApp();
let actor: Awaited<ReturnType<typeof createActor>>;
let anchorId: string;

/** Add a contact straight to the database, so the note has somebody to find. */
function addContact(name: string, company?: string): string {
  const id = `mx-${Math.random().toString(36).slice(2, 10)}`;
  sqlite
    .prepare(
      `INSERT INTO contacts (id, name, company, ownerId, phoneticHash)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      name,
      company ?? null,
      actor.user.id,
      doubleMetaphone(name).primary,
    );
  return id;
}

/**
 * Save a note and wait for the background extraction to finish.
 *
 * It runs on `setTimeout(0)` and then awaits the model, so the response
 * returning is not the signal. Poll for the interaction's `mentions` column
 * rather than sleeping a fixed time, which is the flake this avoids.
 */
async function saveNoteAndWait(content: string): Promise<string> {
  const res = await asUser(actor)(
    request(app)
      .post(`/api/contacts/${anchorId}/interactions`)
      .send({ type: "note", title: "Lunch", content }),
  );
  expect(res.status).toBe(201);
  const id = res.body.id as string;

  for (let i = 0; i < 100; i++) {
    const row = sqlite
      .prepare("SELECT mentions FROM interactions WHERE id = ?")
      .get(id) as { mentions: string | null } | undefined;
    if (row?.mentions) return id;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("The background mention extraction never wrote its result.");
}

/** The mentions the note ended up carrying. */
function mentionsOf(interactionId: string) {
  const row = sqlite
    .prepare("SELECT mentions FROM interactions WHERE id = ?")
    .get(interactionId) as { mentions: string | null };
  return JSON.parse(row.mentions ?? "[]") as {
    contactId: string;
    name: string;
    isGhost: boolean;
  }[];
}

beforeAll(async () => {
  resetAccounts();
  // Auth on, so `asUser` really is the actor rather than the local owner. With
  // it off the request resolves to the local owner's scope, the contact the
  // test made belongs to somebody else, and `requireContact` answers 404.
  process.env.AUTH_REQUIRED = "true";
  process.env.DISABLE_BACKGROUND_JOBS = "";
  actor = await createActor(app, { username: "mentionwiring" });
});

afterAll(() => {
  process.env.DISABLE_BACKGROUND_JOBS = "true";
  process.env.AUTH_REQUIRED = "";
  resetAccounts();
});

beforeEach(() => {
  sqlite.prepare("DELETE FROM dedupe_suggestions").run();
  sqlite.prepare("DELETE FROM interaction_mentions").run();
  sqlite.prepare("DELETE FROM interactions").run();
  sqlite.prepare("DELETE FROM contacts WHERE ownerId = ?").run(actor.user.id);
  anchorId = addContact("Anchor Person");
  extracted = [];
});

describe("saving a note that names somebody", () => {
  it("attaches a confident name to the contact already there", async () => {
    const jonathan = addContact("Jonathan Smith", "Northwind Logistics");
    extracted = [{ name: "Jon Smith", context: "had lunch" }];

    const id = await saveNoteAndWait("Lunch with Jon Smith about the move.");

    // No ghost. Before this, "Jon Smith" did not equal "Jonathan Smith" and
    // the account got a second record of a person it already had.
    const mentions = mentionsOf(id);
    expect(mentions).toHaveLength(1);
    expect(mentions[0].contactId).toBe(jonathan);
    expect(mentions[0].isGhost).toBe(false);
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM contacts WHERE ownerId = ? AND isGhost = 1",
        )
        .get(actor.user.id),
    ).toEqual({ n: 0 });
  });

  it("makes a ghost and a suggestion when the name is only plausible", async () => {
    const krzysztof = addContact("Krzysztof Wisniewski");
    extracted = [{ name: "Krzystof Wisniewski", context: "met at a talk" }];

    const id = await saveNoteAndWait("Met Krzystof Wisniewski at a talk.");

    // The ghost is still made, because the note has to point at something and
    // a mention with no contact is a mention the timeline cannot render.
    const mentions = mentionsOf(id);
    expect(mentions[0].isGhost).toBe(true);

    // And somebody is told, which is the part that is new.
    const suggestion = sqlite
      .prepare(
        `SELECT contactIdA, contactIdB, matchType, reasoning, status
           FROM dedupe_suggestions WHERE ownerId = ?`,
      )
      .get(actor.user.id) as {
      contactIdA: string;
      contactIdB: string;
      matchType: string;
      reasoning: string;
      status: string;
    };
    expect(suggestion.matchType).toBe("mention");
    expect(suggestion.status).toBe("pending");
    // Either order. `storeSuggestion` sorts the two ids so that one pair is
    // one row however it was found, which is what makes INSERT OR IGNORE
    // idempotent across re-scans.
    expect([suggestion.contactIdA, suggestion.contactIdB].sort()).toEqual(
      [krzysztof, mentions[0].contactId].sort(),
    );
    expect(suggestion.reasoning).toContain("Krzystof Wisniewski");
  });

  it("leaves the real contact as the one that survives the merge", async () => {
    const krzysztof = addContact("Krzysztof Wisniewski");
    extracted = [{ name: "Krzystof Wisniewski", context: "met at a talk" }];
    const id = await saveNoteAndWait("Met Krzystof Wisniewski at a talk.");
    const ghostId = mentionsOf(id)[0].contactId;

    const hydrated = new Map(
      contactRepo
        .hydrateMany(
          contactRepo.findManyOwned(scopeForOwnerId(actor.user.id), [
            krzysztof,
            ghostId,
          ]),
        )
        .map((c) => [c.id, c]),
    );
    const scope = scopeForOwnerId(actor.user.id);

    // The pair is stored in id order, so which record survives cannot come
    // from that. It comes from `computePrimaryScore`, and the answer has to be
    // the person the account already knew rather than the ghost a note made.
    expect(
      computePrimaryScore(scope, hydrated.get(krzysztof)!),
    ).toBeGreaterThan(computePrimaryScore(scope, hydrated.get(ghostId)!));
  });

  it("makes a plain ghost, and no suggestion, for somebody new", async () => {
    addContact("Jonathan Smith");
    extracted = [{ name: "Ingrid Solberg", context: "new introduction" }];

    const id = await saveNoteAndWait("Ingrid Solberg introduced herself.");

    expect(mentionsOf(id)[0].isGhost).toBe(true);
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM dedupe_suggestions WHERE ownerId = ?",
        )
        .get(actor.user.id),
    ).toEqual({ n: 0 });
  });

  it("finds the ghost a previous note made rather than making a second", async () => {
    extracted = [{ name: "Yusuf Demirci", context: "first mention" }];
    const first = await saveNoteAndWait("Yusuf Demirci called.");
    const ghostId = mentionsOf(first)[0].contactId;

    extracted = [{ name: "Yusuf Demirci", context: "second mention" }];
    const second = await saveNoteAndWait("Yusuf Demirci called again.");

    // One ghost, named twice. An exact match did this too; it is here because
    // the new resolver must not have lost it.
    expect(mentionsOf(second)[0].contactId).toBe(ghostId);
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM contacts WHERE ownerId = ? AND isGhost = 1",
        )
        .get(actor.user.id),
    ).toEqual({ n: 1 });
  });

  it("handles several names in one note, each on its own", async () => {
    const jonathan = addContact("Jonathan Smith");
    extracted = [
      { name: "Jon Smith", context: "was there" },
      { name: "Ingrid Solberg", context: "also there" },
    ];

    const id = await saveNoteAndWait("Jon Smith and Ingrid Solberg came.");

    const mentions = mentionsOf(id);
    expect(mentions).toHaveLength(2);
    expect(mentions.find((m) => m.contactId === jonathan)?.isGhost).toBe(false);
    expect(mentions.find((m) => m.name === "Ingrid Solberg")?.isGhost).toBe(
      true,
    );
  });

  it("writes the ghost into the account that saved the note", async () => {
    extracted = [{ name: "Ingrid Solberg", context: "new" }];

    const id = await saveNoteAndWait("Ingrid Solberg introduced herself.");

    const owner = sqlite
      .prepare("SELECT ownerId FROM contacts WHERE id = ?")
      .get(mentionsOf(id)[0].contactId) as { ownerId: string };
    expect(owner.ownerId).toBe(actor.user.id);
  });
});
