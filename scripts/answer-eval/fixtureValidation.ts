import type { AnswerCorpus } from "./corpus.ts";

/** Reject fixture corruption before it can alter retrieval or evaluation scores. */
export function validateAnswerFixture(
  corpus: AnswerCorpus,
  manifest: {
    dimension: number;
    contacts: number;
    queries: number;
    queryInputs?: string[];
  },
  vectors: Buffer,
  expectedDimension: number,
): void {
  if (
    manifest.dimension !== expectedDimension ||
    manifest.contacts !== corpus.contacts.length ||
    manifest.queries !== corpus.queries.length
  ) {
    throw new Error(
      "Answer fixture manifest does not match the corpus or model dimension.",
    );
  }
  const queryInputs =
    manifest.queryInputs ?? corpus.queries.map((query) => query.q);
  if (
    queryInputs.some((input) => typeof input !== "string" || !input.trim()) ||
    new Set(queryInputs).size !== queryInputs.length ||
    corpus.queries.some((query) => !queryInputs.includes(query.q))
  ) {
    throw new Error(
      "Answer fixture query inputs must be unique and include every original query.",
    );
  }
  const expectedBytes =
    (corpus.contacts.length + queryInputs.length) * expectedDimension * 4;
  if (vectors.byteLength !== expectedBytes) {
    throw new Error(
      `Answer fixture vectors contain ${vectors.byteLength} bytes, expected ${expectedBytes}.`,
    );
  }
  for (let offset = 0; offset < vectors.byteLength; offset += 4) {
    if (!Number.isFinite(vectors.readFloatLE(offset))) {
      throw new Error(
        `Answer fixture vector contains a non-finite value at byte ${offset}.`,
      );
    }
  }
  const keys = new Set(corpus.contacts.map((contact) => contact.key));
  const ids = new Set(corpus.queries.map((query) => query.id));
  const texts = new Set(
    corpus.queries.map((query) => query.q.toLowerCase().trim()),
  );
  if (
    keys.size !== corpus.contacts.length ||
    ids.size !== corpus.queries.length ||
    texts.size !== corpus.queries.length ||
    keys.has("") ||
    ids.has("") ||
    texts.has("")
  ) {
    throw new Error(
      "Answer fixture keys, query IDs, and query texts must be unique and nonempty.",
    );
  }
  for (const query of corpus.queries) {
    const expected = new Set(query.expectedMatches);
    const forbidden = query.forbiddenMatches ?? [];
    const referenced = [
      ...expected,
      ...forbidden,
      ...(query.adversarialTargetKeys ?? []),
    ];
    if (referenced.some((key) => !keys.has(key))) {
      throw new Error(
        `Answer fixture query ${query.id} references an unknown contact.`,
      );
    }
    if (
      expected.size !== query.expectedMatches.length ||
      forbidden.some((key) => expected.has(key)) ||
      (query.expectEmpty && expected.size > 0)
    ) {
      throw new Error(
        `Answer fixture query ${query.id} contains conflicting result expectations.`,
      );
    }
  }
}
