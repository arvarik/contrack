// =============================================================================
// The dedupe precision and recall gate
// =============================================================================
// `tests/unit/nlp.*.test.ts` check the matchers one at a time. Nothing checked
// the engine, so a change to blocking, to a threshold, or to the order the
// passes run in could move which pairs come out and no test would notice.
//
// This runs the passes over a corpus whose answers are written down and
// compares precision and recall with a committed baseline. It fails in both
// directions. A number that goes up is as much a reason to look as a number
// that goes down, because a rearrangement that was supposed to change nothing
// and changed something is the case this exists to catch.
//
// Two things to know before reading a number here:
//
// 1. AI IS OFF. A third of what the funnel produces normally goes to a model
//    for verification, and a model is not reproducible. So these are the
//    deterministic numbers. With a provider configured, recall is higher than
//    anything in this file.
//
// 2. THE CORPUS IS ADVERSARIAL. A third of the labelled pairs are hard
//    negatives written to be as confusing as they can be: a father and a son
//    at one firm, a couple on one phone line, two people on a team alias.
//    Precision here is precision against that, not precision on somebody's
//    real address book.
//
// Re-record with `npm run eval:record:dedupe` when a change to the matchers is
// intended, and put the baseline diff in the pull request.
// =============================================================================

import fs from "fs";
import { describe, it, expect, beforeAll } from "vitest";
import { ensureLocalOwner, sqlite } from "../../server/db.ts";
import { scopeForOwnerId, type Scope } from "../../server/tenancy/scope.ts";
import {
  AUTO_MERGE_THRESHOLD,
  BASELINE_PATH,
  THRESHOLDS,
  PASSES,
  buildCorpus,
  measure,
  pairId,
  reachRoutes,
  seedCorpus,
  type Baseline,
  type Measurement,
  type SeededCorpus,
} from "./dedupe-harness.ts";

/**
 * How far a number may move before the gate fails.
 *
 * 0.01 on 221 duplicate pairs is about two pairs. Smaller than that and the
 * gate would fail on nothing; larger and a real regression could hide inside
 * the tolerance.
 */
const TOLERANCE = 0.01;

const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")) as Baseline;

let scope: Scope;
let seeded: SeededCorpus;
let measurement: Measurement;

beforeAll(async () => {
  scope = scopeForOwnerId(ensureLocalOwner());
  seeded = await seedCorpus(scope, buildCorpus());
  measurement = await measure(scope, seeded);
}, 120_000);

// ---------------------------------------------------------------------------
// The corpus is really there
// ---------------------------------------------------------------------------
// Four assertions that would catch an empty or truncated corpus. Without
// them, a seeding failure reports perfect precision over nothing, which is
// the trap an earlier audit script in this repository fell into.

describe("the corpus", () => {
  it("holds the number of contacts the baseline was recorded against", () => {
    expect(seeded.corpus.contacts.length).toBe(baseline.corpus.contacts);
    expect(seeded.corpus.duplicates.length).toBe(
      baseline.corpus.duplicatePairs,
    );
    expect(seeded.corpus.negatives.length).toBe(baseline.corpus.hardNegatives);
  });

  it("reached the database, with its emails, phones and sources", () => {
    const counts = sqlite
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM contacts WHERE ownerId = ?) AS contacts,
           (SELECT COUNT(*) FROM contact_emails ce JOIN contacts c ON c.id = ce.contactId WHERE c.ownerId = ?) AS emails,
           (SELECT COUNT(*) FROM contact_phones cp JOIN contacts c ON c.id = cp.contactId WHERE c.ownerId = ?) AS phones,
           (SELECT COUNT(*) FROM contact_sources cs JOIN contacts c ON c.id = cs.contactId WHERE c.ownerId = ?) AS sources`,
      )
      .get(scope.ownerId, scope.ownerId, scope.ownerId, scope.ownerId) as {
      contacts: number;
      emails: number;
      phones: number;
      sources: number;
    };

    expect(counts.contacts).toBe(seeded.corpus.contacts.length);
    expect(counts.emails).toBeGreaterThan(100);
    expect(counts.phones).toBeGreaterThan(100);
    expect(counts.sources).toBeGreaterThan(500);
  });

  it("labels every duplicate pair with a route a pass could reach it by", () => {
    const byKey = new Map(seeded.corpus.contacts.map((c) => [c.key, c]));
    const unreachable = seeded.corpus.duplicates.filter(
      (pair) =>
        reachRoutes(byKey.get(pair.a)!, byKey.get(pair.b)!).length === 0,
    );

    // A labelled duplicate the engine has no route to would lower recall for
    // ever and name no bug.
    expect(unreachable.map((p) => `${p.a} ↔ ${p.b}`)).toEqual([]);
  });

  it("names no pair twice, and no pair as both a duplicate and a negative", () => {
    const seen = new Set<string>();
    const repeated: string[] = [];
    for (const pair of [
      ...seeded.corpus.duplicates,
      ...seeded.corpus.negatives,
    ]) {
      const id = pairId(pair.a, pair.b);
      if (seen.has(id)) repeated.push(id);
      seen.add(id);
    }

    expect(repeated).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

describe("precision and recall per pass", () => {
  for (const pass of PASSES) {
    it(`${pass} matches the baseline`, () => {
      const now = measurement[pass].score;
      const then = baseline.passes[pass].score;

      expect(now.precision, `${pass} precision`).toBeCloseTo(then.precision, 2);
      expect(now.recall, `${pass} recall`).toBeCloseTo(then.recall, 2);
      expect(
        Math.abs(now.f1 - then.f1),
        `${pass} F1 moved from ${then.f1} to ${now.f1}`,
      ).toBeLessThanOrEqual(TOLERANCE);
    });

    it(`${pass} keeps the confidences it puts on the pairs`, () => {
      const now = measurement[pass].score.meanConfidence;
      const then = baseline.passes[pass].score.meanConfidence;

      // Precision and recall are both computed over the set of pairs, so a
      // change that rescores every pair without adding or removing one moves
      // neither. That is not hypothetical: it is what lowering
      // `THRESHOLD_AUTO` does, and the first version of this file passed it.
      expect(
        Math.abs(now - then),
        `${pass} mean confidence moved from ${then} to ${now}`,
      ).toBeLessThanOrEqual(TOLERANCE);
    });

    it(`${pass} keeps its recall per duplicate kind`, () => {
      const now = measurement[pass].recallByKind;
      const then = baseline.passes[pass].recallByKind;

      // Per kind, so a change that breaks nicknames and leaves everything else
      // alone names the kind rather than moving the total by a hundredth.
      const moved = Object.keys(then)
        .filter((kind) => Math.abs((now[kind] ?? 0) - then[kind]) > TOLERANCE)
        .map((kind) => `${kind}: ${then[kind]} → ${now[kind] ?? 0}`);

      expect(moved).toEqual([]);
    });

    it(`${pass} keeps its count of hard negatives matched`, () => {
      const now = measurement[pass].negativesMatchedByKind;
      const then = baseline.passes[pass].negativesMatchedByKind;

      // An exact count, not a tolerance. One more father-and-son pair matched
      // is one more household merged into one person.
      expect(now).toEqual(then);
    });
  }
});

// ---------------------------------------------------------------------------
// The auto-merge threshold
// ---------------------------------------------------------------------------

describe("what would merge with nobody asked", () => {
  it("holds the three thresholds the baseline was recorded at", () => {
    // The whole "at auto-merge" half of the baseline is meaningless if these
    // moved, so a preset change fails here by name rather than showing up as
    // an unexplained shift in precision somewhere else.
    expect(THRESHOLDS).toEqual(baseline.thresholds);
    expect(AUTO_MERGE_THRESHOLD).toBe(baseline.thresholds.autoMerge);
  });

  for (const pass of PASSES) {
    it(`${pass} merges no more pairs than the baseline, and no fewer correct ones`, () => {
      const now = measurement[pass].score;
      const then = baseline.passes[pass].score;

      // Two separate assertions on purpose. More false merges is a
      // regression. Fewer correct merges is also a regression, and a change
      // that traded one for the other would pass a single F1 check.
      expect(
        now.autoFalsePositives,
        `${pass}: pairs at or above ${AUTO_MERGE_THRESHOLD} that are two different people`,
      ).toBeLessThanOrEqual(then.autoFalsePositives);
      expect(
        now.autoTruePositives,
        `${pass}: pairs at or above ${AUTO_MERGE_THRESHOLD} that are one person`,
      ).toBeGreaterThanOrEqual(then.autoTruePositives);
    });
  }
});

// ---------------------------------------------------------------------------
// Floors
// ---------------------------------------------------------------------------
// The baseline comparisons above pin the numbers to what they were. These pin
// them to what they have to be, so that re-recording a baseline cannot quietly
// accept a collapse.

describe("floors that a re-recorded baseline cannot lower", () => {
  it("finds most of the duplicates a real scan would see", () => {
    expect(measurement.combined.score.recall).toBeGreaterThan(0.7);
  });

  it("finds the pairs that share an email or a phone number", () => {
    // These are the two identity anchors. Anything less than everything means
    // a matcher stopped running rather than got worse.
    expect(measurement.combined.recallByKind["shared-email"]).toBe(1);
    expect(measurement.combined.recallByKind["shared-phone"]).toBe(1);
  });

  it("keeps two colleagues with close names apart", () => {
    // The one hard-negative kind the engine gets right today. It is a floor
    // rather than a target: if this starts matching, the fuzzy threshold
    // moved.
    expect(measurement.combined.negativesMatchedByKind["colleagues"]).toBe(0);
  });

  it("produces something at all, on every pass", () => {
    for (const pass of PASSES) {
      expect(measurement[pass].score.produced, pass).toBeGreaterThan(50);
      expect(measurement[pass].score.truePositives, pass).toBeGreaterThan(50);
    }
  });
});
