// The dedupe precision and recall gate.
// Unit tests check each matcher alone, so a change to blocking, a threshold
// or the pass order could move which pairs come out unseen. This runs the
// passes over a corpus with the answers written down and compares precision
// and recall with a committed baseline. It fails in both directions, because
// a change meant to change nothing that moves a number up is worth a look too.
//
// 1. AI IS OFF. A model is not reproducible, so these are the deterministic
//    numbers. With a provider, recall is higher than anything here.
//
// 2. THE CORPUS IS ADVERSARIAL. A third of the labeled pairs are hard
//    negatives: a father and a son at one firm, a couple on one phone line,
//    two people on a team alias. Precision here is against that, not against
//    a real address book.
//
// Re-record with `npm run eval:record:dedupe` when a matcher change is
// intended, and put the baseline diff in the pull request.

import fs from "fs";
import { describe, it, expect, beforeAll } from "vitest";
import { ensureLocalOwner, sqlite } from "../../server/db.ts";
import { scopeForOwnerId, type Scope } from "../../server/tenancy/scope.ts";
import {
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
 * How far a number may move before the gate fails: 0.01 on 221 duplicate
 * pairs is about two pairs.
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

// The corpus is really there. Without these, a seeding failure would report
// perfect precision over nothing.

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

    // A labeled duplicate the engine has no route to would lower recall for
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

// The gate

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

      // Precision and recall are computed over the set of pairs, so a change
      // that rescores every pair without adding or removing one, such as
      // lowering `THRESHOLD_AUTO`, moves neither.
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
      // is one more household offered as a duplicate.
      expect(now).toEqual(then);
    });

    it(`${pass} keeps its count of hard negatives at auto-merge`, () => {
      const now = measurement[pass].autoNegativesByKind;
      const then = baseline.passes[pass].autoNegativesByKind;

      // The subset above that loses data: a wrong merge with nobody asked.
      // Exact, per kind, so a failure names the household it would merge.
      expect(now).toEqual(then);
    });
  }
});

// The auto-merge threshold

describe("what would merge with nobody asked", () => {
  it("holds the three thresholds the baseline was recorded at", () => {
    // The "at auto-merge" half of the baseline depends on these, so a preset
    // change fails here by name.
    expect(THRESHOLDS).toEqual(baseline.thresholds);
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
        `${pass}: pairs at or above ${THRESHOLDS.autoMerge} that are two different people`,
      ).toBeLessThanOrEqual(then.autoFalsePositives);
      expect(
        now.autoTruePositives,
        `${pass}: pairs at or above ${THRESHOLDS.autoMerge} that are one person`,
      ).toBeGreaterThanOrEqual(then.autoTruePositives);
    });
  }
});

// Floors
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

  it("never claims two people who share a mailbox", () => {
    // A team alias and a household address are not identities. Both the scan
    // and the import path skip them, so no pass may match this kind at all.
    // Before that, 15 of the 45 pairs the engine merged with nobody asked were
    // two colleagues on one inbox.
    for (const pass of PASSES) {
      expect(
        measurement[pass].negativesMatchedByKind["shared-inbox"],
        pass,
      ).toBe(0);
    }
  });

  it("finds every duplicate that differs by a middle name", () => {
    // A rule of its own at 0.88, below the auto threshold. Jaro-Winkler put
    // these between the discard and auto cuts, so with no provider configured
    // the funnel found 1 of 15.
    expect(measurement.combined.recallByKind["middle-name"]).toBe(1);
  });

  it("keeps two siblings apart", () => {
    // Reachable only since the corpus stopped giving both siblings the same
    // first name. While it did, 13 pairs were two records of one person and no
    // engine change could have separated them.
    expect(measurement.combined.negativesMatchedByKind["siblings"]).toBe(0);
  });

  it("never merges a household on one phone line with nobody asked", () => {
    // Two people on one number, with two different first names. The policy
    // caps a contradicted anchor at 0.85, below every preset, on every path.
    // Before that, all 16 merged at 0.95 in a scan and at 0.99 in an import.
    // The pair is still produced, so a person sees it.
    for (const pass of PASSES) {
      expect(
        measurement[pass].autoNegativesByKind["shared-landline"],
        pass,
      ).toBe(0);
    }
    expect(
      measurement.combined.negativesMatchedByKind["shared-landline"],
    ).toBeGreaterThan(0);
  });

  it("never merges a father and a son with nobody asked", () => {
    // "Sr." beside "Jr." is two people by definition. The scan's exact-name
    // rule keys on the raw name, and the import path reads the suffix rather
    // than the stripped tokens.
    for (const pass of PASSES) {
      expect(
        measurement[pass].autoNegativesByKind["father-and-son"],
        pass,
      ).toBe(0);
    }
  });

  it("never merges two strangers who share a common name with nobody asked", () => {
    // One name, two lives, two sources. The import path scored this 0.95 as
    // a cross-source match and merged it; the scan always asked at 0.92, and
    // now both do.
    for (const pass of PASSES) {
      expect(
        measurement[pass].autoNegativesByKind["same-common-name"],
        pass,
      ).toBe(0);
    }
  });

  it("puts the same hard negatives at auto-merge whichever path finds them", () => {
    // The point of one policy: a scan and an import agree on which two
    // different people to merge with nobody asked. Namesakes are the one
    // kind still at auto on both, because nothing separates them. The true
    // pairs are not compared, because the import path reaches more of them
    // at auto (125 against 109 in the baseline).
    expect(measurement.incremental.autoNegativesByKind).toEqual(
      measurement.combined.autoNegativesByKind,
    );
  });

  it("produces something at all, on every pass", () => {
    for (const pass of PASSES) {
      expect(measurement[pass].score.produced, pass).toBeGreaterThan(50);
      expect(measurement[pass].score.truePositives, pass).toBeGreaterThan(50);
    }
  });
});
