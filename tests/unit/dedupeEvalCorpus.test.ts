// =============================================================================
// The eval corpus checks itself
// =============================================================================
// `scripts/dedupe-eval/corpus.ts` is the ground truth the dedupe gate measures
// against, so a defect in it does not fail a test, it changes what every
// number means. That happened: the generator gave both people in a hard
// negative the same first name for 26 of 111 pairs, and the gate counted every
// one of them as an engine error no engine change could remove. A-01 read 58
// when the honest figure was 32.
//
// `validateCorpus` is the guard, and this file is the guard's test. Each case
// below is a shape that got past an earlier version of it.
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  buildCorpus,
  validateCorpus,
  type Corpus,
} from "../../scripts/dedupe-eval/corpus.ts";

/** The real corpus, built once. Building it runs `validateCorpus`. */
const corpus = buildCorpus();

/** A copy with one contact renamed, so a case can break one thing only. */
function withRenamed(key: string, name: string): Corpus {
  return {
    ...corpus,
    contacts: corpus.contacts.map((c) => (c.key === key ? { ...c, name } : c)),
  };
}

describe("the shipped corpus", () => {
  it("builds and validates", () => {
    expect(corpus.contacts.length).toBeGreaterThan(700);
    expect(corpus.duplicates.length).toBeGreaterThan(200);
    expect(corpus.negatives.length).toBeGreaterThan(100);
  });

  it("gives two different names to every negative that is not built to share one", () => {
    // The three that are: a namesake and two strangers with a common name are
    // built to carry one name, and a father and a son normalize to one once
    // the tokenizer drops Sr. and Jr. Every other kind names two people, and
    // this assertion is the one that was missing.
    const sameNameKinds = new Set([
      "namesake",
      "same-common-name",
      "father-and-son",
    ]);
    const byKey = new Map(corpus.contacts.map((c) => [c.key, c]));
    const offenders = corpus.negatives
      .filter((n) => !sameNameKinds.has(n.kind))
      .filter((n) => byKey.get(n.a)!.name === byKey.get(n.b)!.name)
      .map((n) => `${n.kind}: ${byKey.get(n.a)!.name}`);
    expect(offenders).toEqual([]);
  });

  it("builds sibling names that share a prefix without rebuilding the original", () => {
    // The specific defect. "Edw" plus Gaspard's "ard" spelled "Edward" back,
    // so a sibling pair was two records of one person.
    const byKey = new Map(corpus.contacts.map((c) => [c.key, c]));
    const siblings = corpus.negatives.filter((n) => n.kind === "siblings");
    expect(siblings.length).toBeGreaterThan(10);
    for (const pair of siblings) {
      const a = byKey.get(pair.a)!.name.split(" ")[0];
      const b = byKey.get(pair.b)!.name.split(" ")[0];
      expect(a, `${a} / ${b}`).not.toBe(b);
      expect(b.slice(0, 3), `${a} / ${b}`).toBe(a.slice(0, 3));
    }
  });
});

describe("validateCorpus", () => {
  it("refuses a negative that carries one name twice", () => {
    const landline = corpus.negatives.find(
      (n) => n.kind === "shared-landline",
    )!;
    const byKey = new Map(corpus.contacts.map((c) => [c.key, c]));
    const broken = withRenamed(landline.b, byKey.get(landline.a)!.name);
    expect(() => validateCorpus(broken)).toThrow(/gives both people the name/);
  });

  it("allows a namesake to carry one name twice", () => {
    // The same shape, under a label that means it.
    const namesake = corpus.negatives.find((n) => n.kind === "namesake")!;
    const byKey = new Map(corpus.contacts.map((c) => [c.key, c]));
    expect(byKey.get(namesake.a)!.name).toBe(byKey.get(namesake.b)!.name);
    expect(() => validateCorpus(corpus)).not.toThrow();
  });

  it("still refuses an unlabelled name collision between two groups", () => {
    // The older check, which the one above does not replace.
    const distractor = corpus.contacts.find((c) =>
      c.key.startsWith("distractor-"),
    )!;
    const other = corpus.contacts.find(
      (c) => c.key.startsWith("recipe-typo-") && c.name !== distractor.name,
    )!;
    const broken = withRenamed(distractor.key, other.name);
    expect(() => validateCorpus(broken)).toThrow(/share the name/);
  });

  it("refuses a corpus with a duplicate contact key", () => {
    const broken: Corpus = {
      ...corpus,
      contacts: [...corpus.contacts, corpus.contacts[0]],
    };
    expect(() => validateCorpus(broken)).toThrow(/duplicate contact key/);
  });

  it("refuses a contact with no name", () => {
    const broken = withRenamed(corpus.contacts[0].key, "   ");
    expect(() => validateCorpus(broken)).toThrow(/has no name/);
  });
});
