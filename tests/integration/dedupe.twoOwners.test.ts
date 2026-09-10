// =============================================================================
// Integration: the merge and scan paths, run again with two seeded owners
// =============================================================================
// `api.merge.test.ts` runs every merge scenario on a single-account instance
// and `dedupe.test.ts` checks the engine's shape. Both still pass, and neither
// can see the failure this file is about.
//
// `merging.ts` re-parents sixty child statements by contact id alone. That is
// safe only because one statement proved both contacts share the caller's
// owner first. With one account on the instance, a broken check looks exactly
// like a working one. So the same merges run here against two accounts holding
// rows that are identical in every visible field, and each assertion says both
// what moved and what did not.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";
import { sqlite } from "../../server/db.ts";
import { dedupeQueue } from "../../server/services/dedupe/index.ts";
import { buildPassContext } from "../../server/services/dedupe/context.ts";
import { runDeterministicPass } from "../../server/services/dedupe/passes.ts";
import type { ContactRow } from "../../server/services/dedupe/types.ts";
import {
  asUser,
  createActor,
  resetAccounts,
  snapshotRow,
  type Actor,
} from "./tenancy/helpers.ts";

const app = makeTestApp();

let A: Actor;
let B: Actor;

/** One account's twin pair: same name, same address, same phone. */
interface Twins {
  primaryId: string;
  duplicateId: string;
  interactionId: string;
  listId: string;
}

async function seedTwins(actor: Actor, label: string): Promise<Twins> {
  const auth = asUser(actor);

  const primary = await auth(
    request(app)
      .post("/api/contacts")
      .send({ name: "Casey Twin", emails: [`casey.twin@example.com`] }),
  );
  expect(primary.status).toBe(201);

  const duplicate = await auth(
    request(app)
      .post("/api/contacts")
      .send({
        name: "Casey Twin",
        emails: [`casey.twin@example.com`, `casey.${label}@example.com`],
        phones: ["+1 555 0142"],
        company: `${label} Holdings`,
      }),
  );
  expect(duplicate.status).toBe(201);

  const note = await auth(
    request(app)
      .post(`/api/contacts/${duplicate.body.id}/interactions`)
      .send({ type: "note", title: `${label} note on the duplicate` }),
  );
  expect(note.status).toBeLessThan(300);

  const list = await auth(
    request(app)
      .post("/api/lists")
      .send({ name: `${label} list` }),
  );
  expect(list.status).toBeLessThan(300);
  const member = await auth(
    request(app)
      .post(`/api/lists/${list.body.id}/members`)
      .send({ contactId: duplicate.body.id }),
  );
  expect(member.status).toBeLessThan(300);

  return {
    primaryId: primary.body.id,
    duplicateId: duplicate.body.id,
    interactionId: note.body.id,
    listId: list.body.id,
  };
}

/** The contact a child row currently hangs off, straight from the table. */
function parentOf(table: string, id: string): string | undefined {
  return (
    sqlite.prepare(`SELECT contactId FROM ${table} WHERE id = ?`).get(id) as
      { contactId: string } | undefined
  )?.contactId;
}

/** The distinct accounts a set of contact ids belongs to. */
function ownersOf(contactIds: string[]): string[] {
  const owners = new Set<string>();
  for (const id of contactIds) {
    const row = sqlite
      .prepare("SELECT ownerId FROM contacts WHERE id = ?")
      .get(id) as { ownerId: string } | undefined;
    if (row) owners.add(row.ownerId);
  }
  return [...owners];
}

/** Every address on one contact, lowercased. */
function emailsOf(contactId: string): string[] {
  return (
    sqlite
      .prepare("SELECT email FROM contact_emails WHERE contactId = ?")
      .all(contactId) as { email: string }[]
  )
    .map((r) => r.email.toLowerCase())
    .sort();
}

let twinsA: Twins;
let twinsB: Twins;

beforeAll(async () => {
  resetAccounts();
  process.env.AUTH_REQUIRED = "true";
  A = await createActor(app, { username: "ada", email: "ada@example.com" });
  B = await createActor(app, { username: "ben", email: "ben@example.com" });
  twinsA = await seedTwins(A, "ada");
  twinsB = await seedTwins(B, "ben");
});

afterAll(() => {
  process.env.AUTH_REQUIRED = "";
  dedupeQueue.__resetForTests();
  resetAccounts();
});

describe("a merge moves one account's children and no other account's", () => {
  it("merges A's pair and leaves B's identical pair whole", async () => {
    const beforeB = {
      primary: snapshotRow("contacts", twinsB.primaryId),
      duplicate: snapshotRow("contacts", twinsB.duplicateId),
      emails: emailsOf(twinsB.primaryId),
      interaction: parentOf("interactions", twinsB.interactionId),
    };

    const merged = await asUser(A)(
      request(app).post("/api/contacts/merge").send({
        primaryId: twinsA.primaryId,
        duplicateId: twinsA.duplicateId,
      }),
    );
    expect(merged.status).toBe(200);

    // A's primary absorbed A's duplicate: the second address, the phone, the
    // company, the note, and the list membership.
    expect(emailsOf(twinsA.primaryId)).toContain("casey.ada@example.com");
    expect(parentOf("interactions", twinsA.interactionId)).toBe(
      twinsA.primaryId,
    );
    expect(merged.body.contact.company).toBe("ada Holdings");
    expect(
      sqlite
        .prepare("SELECT contactId FROM list_members WHERE listId = ?")
        .all(twinsA.listId),
    ).toContainEqual({ contactId: twinsA.primaryId });

    // B's rows are byte-identical. The child statements select by contact id
    // alone, so an owner check that did not run would have pulled these too:
    // the two duplicates share a name and an address.
    expect(snapshotRow("contacts", twinsB.primaryId)).toEqual(beforeB.primary);
    expect(snapshotRow("contacts", twinsB.duplicateId)).toEqual(
      beforeB.duplicate,
    );
    expect(emailsOf(twinsB.primaryId)).toEqual(beforeB.emails);
    expect(parentOf("interactions", twinsB.interactionId)).toBe(
      beforeB.interaction,
    );
    expect(emailsOf(twinsA.primaryId)).not.toContain("casey.ben@example.com");
  });

  it("writes the audit row under the account that merged", () => {
    const rows = sqlite
      .prepare(
        "SELECT ownerId, mergeType FROM dedupe_merge_log WHERE primaryId = ?",
      )
      .all(twinsA.primaryId) as { ownerId: string; mergeType: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ ownerId: A.user.id, mergeType: "hard" });
  });

  it("merges B's pair afterwards with the same result", async () => {
    const merged = await asUser(B)(
      request(app).post("/api/contacts/merge").send({
        primaryId: twinsB.primaryId,
        duplicateId: twinsB.duplicateId,
      }),
    );
    expect(merged.status).toBe(200);
    expect(emailsOf(twinsB.primaryId)).toContain("casey.ben@example.com");
    expect(parentOf("interactions", twinsB.interactionId)).toBe(
      twinsB.primaryId,
    );
    // A's merge is still exactly what it was: merging is not a global sweep.
    expect(emailsOf(twinsA.primaryId)).not.toContain("casey.ben@example.com");
  });

  it("gives each account its own merge log", async () => {
    const logA = await asUser(A)(request(app).get("/api/dedupe/merge-log"));
    const logB = await asUser(B)(request(app).get("/api/dedupe/merge-log"));
    expect(logA.body.entries).toHaveLength(1);
    expect(logB.body.entries).toHaveLength(1);
    expect(logA.body.entries[0].primaryId).toBe(twinsA.primaryId);
    expect(logB.body.entries[0].primaryId).toBe(twinsB.primaryId);
  });
});

describe("a scan reads one account's contacts", () => {
  it("finds each account's own duplicates and nobody else's", async () => {
    dedupeQueue.__resetForTests();
    // Fresh twins on both sides: the pairs above were merged away.
    const freshA = await seedTwins(A, "ada2");
    const freshB = await seedTwins(B, "ben2");

    const started = await asUser(A)(
      request(app)
        .post("/api/dedupe/scan")
        .send({ mode: "quick", autoMergeThreshold: 0.99 }),
    );
    expect(started.status).toBe(200);

    const finished = await asUser(A)(
      request(app)
        .get("/api/dedupe/status")
        .query({ scanId: started.body.scanId }),
    );
    expect(finished.body.phase).toBe("complete");

    const found: string[] = finished.body.clusters.flatMap(
      (c: { contacts: { id: string }[] }) => c.contacts.map((x) => x.id),
    );
    // A's fresh pair is there. So is A's surviving primary from the merge
    // above, which shares the name and the address, and that is right: it is
    // A's row. What matters is that every id in every cluster is A's.
    expect(found).toContain(freshA.primaryId);
    expect(found).toContain(freshA.duplicateId);
    expect(found).not.toContain(freshB.primaryId);
    expect(found).not.toContain(freshB.duplicateId);
    expect(ownersOf(found)).toEqual([A.user.id]);

    // A's scan clears and rewrites its own review queue only, and every pair
    // it wrote is a pair of A's rows.
    const pendingFor = (owner: string) =>
      sqlite
        .prepare(
          `SELECT contactIdA, contactIdB FROM dedupe_suggestions
            WHERE ownerId = ? AND status = 'pending'`,
        )
        .all(owner) as { contactIdA: string; contactIdB: string }[];
    const pendingA = pendingFor(A.user.id);
    expect(pendingA.length).toBeGreaterThan(0);
    expect(
      ownersOf(pendingA.flatMap((r) => [r.contactIdA, r.contactIdB])),
    ).toEqual([A.user.id]);
    expect(pendingFor(B.user.id)).toEqual([]);
  });

  it("reads one account's child tables even with both accounts in the map", () => {
    // The deterministic pass filters its SQL rows through `ctx.contactMap` in
    // JavaScript as well as in SQL, and the map is built from a scoped query,
    // so B's rows are dropped either way. That makes a missing owner join in
    // the SQL invisible, and the join is what stops the database reading every
    // account's addresses and phone numbers on every scan.
    //
    // So this context is built for A and then deliberately given B's rows too.
    // The JavaScript filter can no longer mask anything, and the four whole
    // table loads are pinned on their own. Both accounts hold a contact named
    // "Casey Twin" at casey.twin@example.com, so a pair would span them.
    const ctx = buildPassContext(A.scope, "pass-scope-check");
    const strangers = sqlite
      .prepare("SELECT * FROM contacts WHERE ownerId = ?")
      .all(B.user.id) as ContactRow[];
    expect(strangers.length).toBeGreaterThan(0);
    for (const row of strangers) ctx.contactMap.set(row.id, row);

    const pairs = runDeterministicPass(ctx);
    expect(pairs.length).toBeGreaterThan(0);
    expect(ownersOf(pairs.flatMap((p) => [p.idA, p.idB]))).toEqual([A.user.id]);
  });
});
