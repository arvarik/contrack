import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { buildAnswerCorpus } from "../../scripts/answer-eval/corpus.ts";
import { validateAnswerFixture } from "../../scripts/answer-eval/fixtureValidation.ts";

function fixture() {
  const corpus = structuredClone(buildAnswerCorpus());
  const manifest = {
    dimension: 384,
    contacts: corpus.contacts.length,
    queries: corpus.queries.length,
  };
  const vectors = Buffer.alloc(
    (manifest.contacts + manifest.queries) * 384 * 4,
  );
  return { corpus, manifest, vectors };
}

describe("answer fixture validation", () => {
  it("keeps the committed corpus and vectors consistent with the source", () => {
    const directory = new URL("../fixtures/answer-eval/", import.meta.url);
    const readJson = (name: string) =>
      JSON.parse(fs.readFileSync(new URL(name, directory), "utf8"));
    const corpus = {
      contacts: readJson("contacts.json"),
      queries: readJson("queries.json"),
    };
    expect(corpus).toEqual(buildAnswerCorpus());
    validateAnswerFixture(
      corpus,
      readJson("vectors.json"),
      fs.readFileSync(new URL("vectors.bin", directory)),
      384,
    );
  });
  it("accepts extra expanded query vectors with their exact input text", () => {
    const { corpus, manifest, vectors } = fixture();
    const queryInputs = [
      ...corpus.queries.map((query) => query.q),
      "expanded query",
    ];
    expect(() =>
      validateAnswerFixture(
        corpus,
        { ...manifest, queryInputs },
        Buffer.alloc(vectors.length + 384 * 4),
        384,
      ),
    ).not.toThrow();
  });
  it("rejects query inputs that omit an original query", () => {
    const { corpus, manifest, vectors } = fixture();
    expect(() =>
      validateAnswerFixture(
        corpus,
        {
          ...manifest,
          queryInputs: corpus.queries.slice(1).map((query) => query.q),
        },
        vectors,
        384,
      ),
    ).toThrow(/query inputs/);
  });
  it("rejects duplicate embedding input text", () => {
    const { corpus, manifest, vectors } = fixture();
    const queryInputs = [
      ...corpus.queries.map((query) => query.q),
      corpus.queries[0].q,
    ];
    expect(() =>
      validateAnswerFixture(corpus, { ...manifest, queryInputs }, vectors, 384),
    ).toThrow(/query inputs/);
  });
  it("accepts a consistent corpus and vector layout", () => {
    const { corpus, manifest, vectors } = fixture();
    expect(() =>
      validateAnswerFixture(corpus, manifest, vectors, 384),
    ).not.toThrow();
  });
  it.each(["dimension", "contacts", "queries"] as const)(
    "rejects a mismatched %s",
    (field) => {
      const { corpus, manifest, vectors } = fixture();
      manifest[field]++;
      expect(() =>
        validateAnswerFixture(corpus, manifest, vectors, 384),
      ).toThrow(/manifest/);
    },
  );
  it.each([-4, 4])("rejects vector byte length offset %s", (offset) => {
    const { corpus, manifest, vectors } = fixture();
    expect(() =>
      validateAnswerFixture(
        corpus,
        manifest,
        Buffer.alloc(vectors.length + offset),
        384,
      ),
    ).toThrow(/bytes/);
  });
  it.each([NaN, Infinity, -Infinity])(
    "rejects non-finite vector values: %s",
    (value) => {
      const { corpus, manifest, vectors } = fixture();
      vectors.writeFloatLE(value, 0);
      expect(() =>
        validateAnswerFixture(corpus, manifest, vectors, 384),
      ).toThrow(/non-finite/);
    },
  );
  it("rejects duplicate stable contact keys", () => {
    const { corpus, manifest, vectors } = fixture();
    corpus.contacts[1].key = corpus.contacts[0].key;
    expect(() => validateAnswerFixture(corpus, manifest, vectors, 384)).toThrow(
      /unique/,
    );
  });
  it("rejects duplicate normalized query texts", () => {
    const { corpus, manifest, vectors } = fixture();
    corpus.queries[1].q = ` ${corpus.queries[0].q.toUpperCase()} `;
    expect(() => validateAnswerFixture(corpus, manifest, vectors, 384)).toThrow(
      /unique/,
    );
  });
  it("rejects unknown expected contacts", () => {
    const { corpus, manifest, vectors } = fixture();
    corpus.queries[0].expectedMatches = ["unknown"];
    expect(() => validateAnswerFixture(corpus, manifest, vectors, 384)).toThrow(
      /unknown/,
    );
  });
  it("rejects contradictory empty-answer expectations", () => {
    const { corpus, manifest, vectors } = fixture();
    corpus.queries[0].expectEmpty = true;
    expect(() => validateAnswerFixture(corpus, manifest, vectors, 384)).toThrow(
      /conflicting/,
    );
  });
  it("rejects expected contacts that are also forbidden", () => {
    const { corpus, manifest, vectors } = fixture();
    corpus.queries[0].forbiddenMatches = [...corpus.queries[0].expectedMatches];
    expect(() => validateAnswerFixture(corpus, manifest, vectors, 384)).toThrow(
      /conflicting/,
    );
  });
});
