// =============================================================================
// Integration Tests — what counts as one person
// =============================================================================
// The dedupe engine has two rules that act without asking anybody: a shared
// email address scores 0.98 and a shared phone number scores 0.95, both above
// the 0.93 auto-merge threshold. Everything else reaches a person first.
//
// So the rules that decide "this address identifies one person" are the ones
// worth testing at the level of the real pipeline rather than the matcher. An
// error here does not produce a bad suggestion, it deletes somebody.
//
// Two changes are covered:
//
// 1. A SHARED MAILBOX IS NOT AN IDENTITY. `team.northwind@example.net` is an
//    employer's inbox and `haddad.family@example.net` is a household's. The
//    eval corpus measured 15 of 45 unasked merges coming from exactly this.
//    The pair must still be COMPARED, because two colleagues can also be two
//    records of one person, so the test checks that it survives as a
//    suggestion rather than that it disappears.
//
// 2. A MIDDLE NAME IS A DUPLICATE. "Anton Kovacs" and "Anton Peter Kovacs"
//    scored 0.643 to 0.750, which is the band a provider verifies, so with no
//    provider configured the engine found 1 of 15. It is now a rule of its
//    own at 0.88, which is below auto: found, and still reviewed.
//
// Both paths matter, and they are separate code: `runScan` for a scan somebody
// asks for, `runImportScan` for the check every import runs.
// =============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { sqlite, ensureLocalOwner } from "../../server/db.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";
import { contactService } from "../../server/services/contactService.ts";
import { dedupeService } from "../../server/services/dedupe/index.ts";
import { DEFAULT_AUTO_MERGE_THRESHOLD } from "../../server/services/dedupe/engine.ts";
import { dedupeQueue } from "../../server/services/dedupe/jobQueue.ts";

const scope = scopeForOwnerId(ensureLocalOwner());

interface SuggestionRow {
  contactIdA: string;
  contactIdB: string;
  matchType: string;
  confidence: number;
}

function suggestions(): SuggestionRow[] {
  return sqlite
    .prepare(
      `SELECT contactIdA, contactIdB, matchType, confidence
         FROM dedupe_suggestions WHERE ownerId = ?
        ORDER BY confidence DESC`,
    )
    .all(scope.ownerId) as SuggestionRow[];
}

/** Whether the two contacts ended up merged without anybody being asked. */
function wasMerged(ids: string[]): boolean {
  const rows = sqlite
    .prepare(
      `SELECT canonicalId FROM contacts WHERE id IN (${ids.map(() => "?").join(",")})`,
    )
    .all(...ids) as { canonicalId: string | null }[];
  return rows.some((r) => r.canonicalId !== null);
}

async function seed(
  contacts: Parameters<typeof contactService.bulkCreateContacts>[1],
): Promise<string[]> {
  const { createdIds } = await contactService.bulkCreateContacts(
    scope,
    contacts,
  );
  return createdIds;
}

/** A deterministic scan, with auto-merge on at the shipped threshold. */
async function scan(): Promise<void> {
  const scan = dedupeQueue.createScan(scope, "deterministic");
  await dedupeService.runScan(
    scope,
    scan.scanId,
    "deterministic",
    "test",
    DEFAULT_AUTO_MERGE_THRESHOLD,
  );
}

function reset(): void {
  sqlite.exec("DELETE FROM dedupe_suggestions");
  sqlite.exec("DELETE FROM dedupe_exclusions");
  sqlite.exec("DELETE FROM dedupe_merge_log");
  sqlite.exec("DELETE FROM contacts");
}

beforeEach(() => reset());

describe("a shared mailbox is not an identity", () => {
  it("does not merge two colleagues who share a team alias", async () => {
    const ids = await seed([
      {
        name: "Petra Vogel",
        company: "Xylem Water",
        emails: ["team.xylem@example.net"],
      },
      {
        name: "Lukas Gruber",
        company: "Xylem Water",
        emails: ["team.xylem@example.net"],
      },
    ]);

    await scan();

    expect(wasMerged(ids)).toBe(false);
    const anchored = suggestions().filter(
      (s) => s.confidence >= DEFAULT_AUTO_MERGE_THRESHOLD,
    );
    expect(anchored).toEqual([]);
  });

  it("does not merge a couple who share a household address", async () => {
    const ids = await seed([
      { name: "Noor Haddad", emails: ["haddad.family@example.net"] },
      { name: "Sami Haddad", emails: ["haddad.family@example.net"] },
    ]);

    await scan();

    expect(wasMerged(ids)).toBe(false);
  });

  it("still compares the pair, rather than hiding it", async () => {
    // Two records of one person on a team alias is a real shape. The address
    // stops being proof and stays a blocking key, so the pair is still scored
    // on its name and its company.
    const ids = await seed([
      {
        name: "Anton Kovacs",
        company: "Xylem Water",
        emails: ["team.xylem@example.net"],
      },
      {
        name: "Anton Kovacs",
        company: "Xylem Water",
        emails: ["team.xylem@example.net"],
      },
    ]);

    await scan();

    const pair = suggestions().find(
      (s) =>
        (s.contactIdA === ids[0] && s.contactIdB === ids[1]) ||
        (s.contactIdA === ids[1] && s.contactIdB === ids[0]),
    );
    // The exact-name rule claims it, not the email rule.
    expect(pair?.matchType).toBe("name_company");
  });

  it("still treats a personal address as proof", async () => {
    // The rule this change must not have broken.
    const ids = await seed([
      { name: "Anton Kovacs", emails: ["anton.kovacs@example.net"] },
      { name: "A. Kovacs", emails: ["anton.kovacs@example.net"] },
    ]);

    await scan();

    expect(wasMerged(ids)).toBe(true);
  });

  it("does not claim a team alias during an import either", async () => {
    await seed([
      {
        name: "Petra Vogel",
        company: "Xylem Water",
        emails: ["team.xylem@example.net"],
      },
    ]);
    const imported = await seed([
      {
        name: "Lukas Gruber",
        company: "Xylem Water",
        emails: ["team.xylem@example.net"],
      },
    ]);

    await dedupeService.runImportScan(scope, imported, "test");

    expect(suggestions().filter((s) => s.matchType === "email")).toEqual([]);
  });
});

describe("a middle name added is a duplicate", () => {
  it("finds the pair a scan used to miss", async () => {
    const ids = await seed([
      { name: "Anton Kovacs", company: "Xylem Water" },
      { name: "Anton Peter Kovacs", company: "Xylem Water" },
    ]);

    await scan();

    const pair = suggestions().find(
      (s) =>
        (s.contactIdA === ids[0] && s.contactIdB === ids[1]) ||
        (s.contactIdA === ids[1] && s.contactIdB === ids[0]),
    );
    expect(pair?.matchType).toBe("middle_name");
    expect(pair?.confidence).toBe(0.88);
  });

  it("reaches a person rather than merging", async () => {
    // 0.88 is below the 0.93 threshold on purpose: a father and a son can
    // differ by exactly a middle name.
    const ids = await seed([
      { name: "Anton Kovacs", company: "Xylem Water" },
      { name: "Anton Peter Kovacs", company: "Xylem Water" },
    ]);

    await scan();

    expect(wasMerged(ids)).toBe(false);
  });

  it("finds it during an import as well", async () => {
    await seed([{ name: "Anton Kovacs", company: "Xylem Water" }]);
    const imported = await seed([
      { name: "Anton Peter Kovacs", company: "Xylem Water" },
    ]);

    await dedupeService.runImportScan(scope, imported, "test");

    const pair = suggestions().find((s) => s.matchType === "middle_name");
    expect(pair).toBeDefined();
    expect(pair?.confidence).toBe(0.88);
  });

  it("does not claim a dropped first name", async () => {
    // "Peter Kovacs" inside "Anton Peter Kovacs" is somebody going by their
    // middle name, or somebody else. Not this rule's business.
    await seed([
      { name: "Peter Kovacs", company: "Xylem Water" },
      { name: "Anton Peter Kovacs", company: "Xylem Water" },
    ]);

    await scan();

    expect(suggestions().filter((s) => s.matchType === "middle_name")).toEqual(
      [],
    );
  });

  it("does not claim two different middle names", async () => {
    await seed([
      { name: "Robert Lee Smith", company: "Xylem Water" },
      { name: "Robert Ann Smith", company: "Xylem Water" },
    ]);

    await scan();

    expect(suggestions().filter((s) => s.matchType === "middle_name")).toEqual(
      [],
    );
  });
});
