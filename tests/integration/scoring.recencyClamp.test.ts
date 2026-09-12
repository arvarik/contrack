// =============================================================================
// Integration Tests — lastContactedAt never holds the future
// =============================================================================
// `recencyScore` is discontinuous at zero. It returns 100 when `daysSince <= 0`
// and 91.68 at any positive value with the default cadence, so a contact
// stamped at or ahead of now scores full marks on a signal that carries 40
// percent of the composite, and a contact stamped a millisecond ago scores
// 91.68. A-05 in `.agent/STATUS.md` records the discontinuity.
//
// The formula is not changed here. Smoothing it moves every score in the
// instance, and no eval exists that would show the new numbers are better than
// the old ones. What is changed is the only way the cliff is reachable: a
// `lastContactedAt` ahead of now.
//
// Two guards, and both are tested because each covers what the other cannot.
// The schema refuses the write and says why. The `MIN` in the derived UPDATE
// closes the five minutes of clock slack the schema allows, and the rows an
// older version already wrote.
// =============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { sqlite, ensureLocalOwner } from "../../server/db.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";
import { contactService } from "../../server/services/contactService.ts";
import { interactionService } from "../../server/services/interactionService.ts";
import { relationshipService } from "../../server/services/relationshipService.ts";

const scope = scopeForOwnerId(ensureLocalOwner());

function lastContactedAt(contactId: string): string | null {
  const row = sqlite
    .prepare("SELECT lastContactedAt FROM contacts WHERE id = ?")
    .get(contactId) as { lastContactedAt: string | null } | undefined;
  return row?.lastContactedAt ?? null;
}

/** A contact with nothing else about it. */
async function makeContact(name = "Anton Kovacs"): Promise<string> {
  const contact = await contactService.createContact(scope, { name });
  if (!contact) throw new Error(`createContact returned nothing for ${name}`);
  return contact.id;
}

function logInteraction(contactId: string, date?: string): string {
  const created = interactionService.createInteraction(scope, contactId, {
    type: "call",
    title: "A call",
    ...(date ? { date } : {}),
  });
  return (created as { id: string }).id;
}

/** Put a value straight into the column, the way an older version could. */
function forceLastContacted(contactId: string, value: string): void {
  sqlite
    .prepare("UPDATE contacts SET lastContactedAt = ? WHERE id = ?")
    .run(value, contactId);
}

function forceInteractionDate(interactionId: string, value: string): void {
  sqlite
    .prepare("UPDATE interactions SET date = ? WHERE id = ?")
    .run(value, interactionId);
}

beforeEach(() => {
  sqlite.exec("DELETE FROM interactions");
  sqlite.exec("DELETE FROM contacts");
});

describe("the derived write clamps to now", () => {
  it("stores now rather than a future interaction date", async () => {
    const contactId = await makeContact();
    // Written straight to the row, because the schema refuses this shape at the
    // route. What is being tested is the second guard, on its own.
    const interactionId = logInteraction(contactId);
    forceInteractionDate(interactionId, "2030-01-01T00:00:00.000Z");

    // Any interaction write recomputes the column from MAX(date).
    logInteraction(contactId);

    const stored = lastContactedAt(contactId)!;
    expect(stored).not.toBe("2030-01-01T00:00:00.000Z");
    expect(new Date(stored).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("keeps a past interaction date exactly as it is", async () => {
    const contactId = await makeContact();
    const interactionId = logInteraction(contactId);
    forceInteractionDate(interactionId, "2020-06-01T09:30:00.000Z");

    interactionService.deleteInteraction(scope, logInteraction(contactId));

    expect(lastContactedAt(contactId)).toBe("2020-06-01T09:30:00.000Z");
  });

  it("leaves the column null when the last interaction is deleted", async () => {
    // SQLite's two-argument MIN returns NULL when either side is NULL, which
    // is what keeps "never contacted" distinct from "contacted just now".
    const contactId = await makeContact();
    const interactionId = logInteraction(contactId);

    interactionService.deleteInteraction(scope, interactionId);

    expect(lastContactedAt(contactId)).toBeNull();
  });

  it("clamps on the delete path as well as the create path", async () => {
    const contactId = await makeContact();
    const keep = logInteraction(contactId);
    const remove = logInteraction(contactId);
    forceInteractionDate(keep, "2030-01-01T00:00:00.000Z");

    interactionService.deleteInteraction(scope, remove);

    const stored = lastContactedAt(contactId)!;
    expect(new Date(stored).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("compares the two timestamp formats correctly", async () => {
    // The trap this clamp was written around. SQLite's `datetime('now')` gives
    // "2026-09-11 18:45:11" and this app writes "2026-09-11T18:45:10.665Z". A
    // space sorts below "T", so a clamp built on `datetime('now')` would find
    // every ISO timestamp larger and clamp nothing at all. A date with no time
    // has to survive the same comparison.
    const contactId = await makeContact();
    const interactionId = logInteraction(contactId);
    forceInteractionDate(interactionId, "2020-06-01");

    logInteraction(contactId);
    forceInteractionDate(interactionId, "2020-06-01");
    interactionService.deleteInteraction(
      scope,
      (
        sqlite
          .prepare(
            "SELECT id FROM interactions WHERE contactId = ? AND id != ? LIMIT 1",
          )
          .get(contactId, interactionId) as { id: string }
      ).id,
    );

    expect(lastContactedAt(contactId)).toBe("2020-06-01");
  });
});

describe("the score consequence", () => {
  /** The recency signal alone, out of 100. */
  const recencyOf = (contactId: string) =>
    relationshipService
      .explainScore(contactId)!
      .components.find((c) => c.key === "recency")!.value;

  // The cliff, measured rather than fixed. `computeBreakdown` floors
  // `daysSince` at zero, so a future stamp lands on `recencyScore`'s
  // `daysSince <= 0` branch and takes full marks. At the 30-day cadence the
  // sigmoid underneath gives 91.68 for any positive gap, so the step is more
  // than eight points on a signal weighted at 40 percent.
  //
  // Nothing below is stamped "now". That is deliberate: two reads of a contact
  // stamped at the current instant disagree depending on whether they land in
  // the same millisecond, which is how this was found and what made one test
  // in twenty fail. Every stamp here is a day or more from the boundary.
  it("takes a contact off the cliff on the next interaction", async () => {
    const contactId = await makeContact("Cliff Walker");
    sqlite
      .prepare("UPDATE contacts SET cadenceDays = 30 WHERE id = ?")
      .run(contactId);
    forceLastContacted(
      contactId,
      new Date(Date.now() + 86_400_000).toISOString(),
    );

    expect(recencyOf(contactId)).toBe(100);

    logInteraction(contactId);

    // The column is behind now, which is the guarantee. The score that follows
    // from it is whatever the formula says, and the formula is unchanged.
    expect(new Date(lastContactedAt(contactId)!).getTime()).toBeLessThanOrEqual(
      Date.now() + 1000,
    );
  });

  it("keeps a real gap well clear of the boundary", async () => {
    // The comparison the test above cannot make safely: ten days ago against a
    // future stamp, at the cadence where the step is visible.
    const recent = await makeContact("Ten Days Ago");
    const ahead = await makeContact("A Day Ahead");
    for (const id of [recent, ahead]) {
      sqlite
        .prepare("UPDATE contacts SET cadenceDays = 30 WHERE id = ?")
        .run(id);
    }
    forceLastContacted(
      recent,
      new Date(Date.now() - 10 * 86_400_000).toISOString(),
    );
    forceLastContacted(ahead, new Date(Date.now() + 86_400_000).toISOString());

    expect(recencyOf(ahead)).toBe(100);
    expect(recencyOf(recent)).toBeLessThan(90);
  });
});
