#!/usr/bin/env tsx
// =============================================================================
// Record the search evaluation fixture and baseline
// =============================================================================
// Run this when a ranking change is intended:
//
//   npm run eval:record
//
// It writes four files and every one of them is committed:
//
//   tests/fixtures/search-eval/contacts.json   the 300 contact corpus
//   tests/fixtures/search-eval/queries.json    the 50 golden queries
//   tests/fixtures/search-eval/vectors.bin     one recorded vector per row
//   tests/eval/search.baseline.json            recall@10 and MRR per channel
//
// The baseline diff is the evidence that goes in the pull request. A change
// that improves ranking shows as numbers going up; a change that was supposed
// to be neutral and is not shows as numbers moving at all. That is the whole
// point of the gate: `tests/eval/search.eval.test.ts` fails in both
// directions, so nobody can improve or damage ranking without saying so.
//
// The vectors are recorded, not computed at test time, so the gate needs no
// model, no download and no network. They come out of the real backfill, so
// they are exactly what this instance would have stored.
// =============================================================================

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
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "warn";

// The model cache would otherwise land inside the throwaway DATA_DIR, so
// every run would download it again. Keep it beside the dependencies that
// need it instead.
process.env.TRANSFORMERS_CACHE =
  process.env.TRANSFORMERS_CACHE ??
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../node_modules/.cache/transformers",
  );

async function main(): Promise<void> {
  const { buildCorpus } = await import("./search-eval/corpus.ts");
  const { ensureLocalOwner, sqlite } = await import("../server/db.ts");
  const { scopeForOwnerId } = await import("../server/tenancy/scope.ts");
  const localEmbeddings =
    await import("../server/services/search/localEmbeddings.ts");
  const { seedCorpus, measure, CHANNELS, EVAL_DIMENSION } =
    await import("../tests/eval/harness.ts");

  const { contacts, queries } = buildCorpus();
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  write(path.join(FIXTURE_DIR, "contacts.json"), contacts);
  write(path.join(FIXTURE_DIR, "queries.json"), queries);
  console.log(`corpus: ${contacts.length} contacts, ${queries.length} queries`);

  const scope = scopeForOwnerId(ensureLocalOwner());
  const { idByKey } = await seedCorpus(scope, contacts);
  console.log("corpus seeded");

  await localEmbeddings.initLocalEmbeddings();
  if (!localEmbeddings.isLocalEmbeddingReady()) {
    throw new Error(
      "The local embedding model did not load. The fixture cannot be recorded without it.",
    );
  }
  const embedded = await localEmbeddings.backfillSearchEmbeddings();
  console.log(`embedded ${embedded} contacts`);

  // One vector per contact, read back out of the store the backfill wrote, in
  // corpus order. Reading them back rather than keeping what was sent means
  // the fixture is what the database holds, including anything vec0 does to a
  // vector on the way in.
  const readVector = sqlite.prepare(
    "SELECT embedding FROM search_embeddings WHERE contactId = ?",
  );
  const rows: Float32Array[] = [];
  for (const contact of contacts) {
    const id = idByKey.get(contact.key)!;
    const row = readVector.get(id) as { embedding: Buffer } | undefined;
    if (!row) throw new Error(`No vector was stored for ${contact.key}`);
    rows.push(toFloat32(row.embedding));
  }

  for (const query of queries) {
    const vector = await localEmbeddings.embedText(query.q);
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

  // Measured with the model loaded, which is the same arithmetic the gate
  // runs with the recorded vectors: the gate's `embedText` returns the rows
  // written above, so both sides see identical inputs.
  const measurement = await measure(scope, queries, idByKey);
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

function toFloat32(buf: Buffer): Float32Array {
  return new Float32Array(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  );
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
