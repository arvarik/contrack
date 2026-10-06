#!/usr/bin/env node
// Record the search evaluation fixture and baseline
// Run this when a ranking change is intended:
//
//   npm run eval:record
//
// It writes five files and every one of them is committed:
//
//   tests/fixtures/search-eval/contacts.json        the 300 contact corpus
//   tests/fixtures/search-eval/queries.json         the 79 golden queries
//   tests/fixtures/search-eval/vectors.bin          one recorded vector per row
//   tests/fixtures/search-eval/rerank-scores.json   the cross-encoder's scores
//   tests/eval/search.baseline.json                 recall@10 and MRR per channel
//
// The baseline diff goes in the pull request. `tests/eval/search.eval.test.ts`
// fails when the numbers move either way, so no change improves or damages
// ranking without saying so.
//
// The vectors and scores are recorded, so the gate needs no model and no
// network. The gate and this script both write the vectors through the
// product's int8 write path, in one batch, so both search the same bytes. The
// scores are every (question, profile) pair the cross-encoder reads while the
// baseline is measured.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const FIXTURE_DIR = path.join(REPO, "tests/fixtures/search-eval");
const BASELINE = path.join(REPO, "tests/eval/search.baseline.json");

// The database has to be a throwaway. Set before anything imports server/db.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "contrack-eval-"));
process.env.DISABLE_BACKGROUND_JOBS = "true";
process.env.AI_PROVIDER = "gemini";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";
process.env.ANTHROPIC_API_KEY = "";
process.env.AUTH_REQUIRED = "";

// Keep the model cache beside the dependencies, not in the throwaway
// DATA_DIR, so a run does not download it again.
process.env.TRANSFORMERS_CACHE =
  process.env.TRANSFORMERS_CACHE ??
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../node_modules/.cache/transformers",
  );

async function main(): Promise<void> {
  const { buildCorpus } = await import("./search-eval/corpus.ts");
  const { ensureLocalOwner } = await import("../server/db.ts");
  const { scopeForOwnerId } = await import("../server/tenancy/scope.ts");
  const vectorIndex = await import("../server/services/search/vectorIndex.ts");
  const embedder = await import("../server/ai/embedder.ts");
  const reranker = await import("../server/ai/reranker.ts");
  const {
    seedCorpus,
    seedVectors,
    measure,
    recordingReranker,
    CHANNELS,
    EVAL_DIMENSION,
    RERANK_SCORES_PATH,
  } = await import("../tests/eval/harness.ts");

  const { contacts, queries } = buildCorpus();
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  write(path.join(FIXTURE_DIR, "contacts.json"), contacts);
  write(path.join(FIXTURE_DIR, "queries.json"), queries);
  console.log(`corpus: ${contacts.length} contacts, ${queries.length} queries`);

  const scope = scopeForOwnerId(ensureLocalOwner());
  const { idByKey } = await seedCorpus(scope, contacts);
  console.log("corpus seeded");

  await embedder.initBuiltinEmbedder();
  if (embedder.currentEmbedder() !== embedder.builtinEmbedder) {
    throw new Error(
      "The fixture records the built-in embedding model. Unset AI_EMBEDDINGS_MODEL and record again.",
    );
  }
  if (!embedder.builtinEmbedder.ready()) {
    throw new Error(
      "The local embedding model did not load. The fixture cannot be recorded without it.",
    );
  }

  // One vector per contact, in corpus order: the model's floats for the text
  // the backfill embeds. The store keeps int8 bytes, which are not the
  // model's output, so the fixture takes the floats and the gate quantizes
  // them the way the product does.
  const texts = contacts.map((contact) => {
    const text = vectorIndex.currentSearchText(idByKey.get(contact.key)!);
    if (!text) throw new Error(`No search text for ${contact.key}`);
    return text;
  });
  const rows: Float32Array[] = (await vectorIndex.embedBatch(texts)).map(
    (vector, i) => {
      if (!vector) throw new Error(`No vector for ${contacts[i].key}`);
      return vector;
    },
  );
  seedVectors(contacts, rows, idByKey);
  console.log(`embedded ${rows.length} contacts`);

  for (const query of queries) {
    const vector = await vectorIndex.embedText(query.q);
    if (!vector)
      throw new Error(`The model returned no vector for ${query.id}`);
    rows.push(vector);
  }

  const dimension = rows[0].length;
  if (dimension !== EVAL_DIMENSION) {
    throw new Error(
      `The model produced ${dimension}-dimension vectors, but the harness expects ${EVAL_DIMENSION}.`,
    );
  }
  writeVectors(path.join(FIXTURE_DIR, "vectors.bin"), rows, dimension);
  write(path.join(FIXTURE_DIR, "vectors.json"), {
    model: "Xenova/all-MiniLM-L6-v2",
    dimension,
    contacts: contacts.length,
    queries: queries.length,
    recordedAt: new Date().toISOString(),
  });
  console.log(`vectors: ${rows.length} rows at ${dimension} dimensions`);

  // The cross-encoder runs on the worker, and every pair it scores while the
  // baseline is measured is recorded. The budget is lifted: the recording
  // must hold every pair, whatever this machine's speed.
  const model = reranker.rerankModel();
  if (!model || !(await reranker.initCrossEncoder(model))) {
    throw new Error(
      `The cross-encoder ${model} did not load. The fixture cannot be recorded without it.`,
    );
  }
  process.env.SEARCH_RERANK_BUDGET_MS = "60000";
  const scores: Record<string, Record<string, number>> = {};
  reranker.setReranker(recordingReranker(reranker.crossEncoder(model), scores));

  // Measured with the models loaded. The gate's `embedText` and reranker
  // return the recordings written here, so both sides see the same inputs.
  const measurement = await measure(scope, queries, idByKey);
  const pairs = Object.values(scores).reduce(
    (sum, byDoc) => sum + Object.keys(byDoc).length,
    0,
  );
  write(RERANK_SCORES_PATH, {
    model,
    recordedAt: new Date().toISOString(),
    pairs,
    scores,
  });
  console.log(`cross-encoder: ${pairs} pairs recorded`);
  write(BASELINE, {
    recordedAt: new Date().toISOString(),
    model: "Xenova/all-MiniLM-L6-v2",
    corpus: { contacts: contacts.length, queries: queries.length },
    channels: measurement.channels,
    byKind: measurement.byKind,
  });

  console.log("");
  console.log("baseline");
  for (const channel of CHANNELS) {
    const s = measurement.channels[channel];
    console.log(
      `  ${channel.padEnd(7)} recall@10 ${s.recallAt10.toFixed(4)}  MRR ${s.mrr.toFixed(4)}`,
    );
    for (const [kind, ks] of Object.entries(measurement.byKind[channel])) {
      console.log(
        `    ${kind.padEnd(18)} recall@10 ${ks.recallAt10.toFixed(4)}  MRR ${ks.mrr.toFixed(4)}`,
      );
    }
  }
}

function write(file: string, value: unknown): void {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeVectors(
  file: string,
  rows: Float32Array[],
  dimension: number,
): void {
  const buf = Buffer.allocUnsafe(rows.length * dimension * 4);
  rows.forEach((row, i) => {
    if (row.length !== dimension) {
      throw new Error(
        `Row ${i} has ${row.length} dimensions, expected ${dimension}`,
      );
    }
    Buffer.from(row.buffer, row.byteOffset, row.byteLength).copy(
      buf,
      i * dimension * 4,
    );
  });
  fs.writeFileSync(file, buf);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
