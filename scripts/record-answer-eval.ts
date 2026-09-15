#!/usr/bin/env tsx
// =============================================================================
// Record / Live Evaluation for the Complete AI Answer Pipeline
// =============================================================================
// Usage:
//   npm run eval:record:answer   # Re-records vectors, AI responses & writes baseline
//   npm run eval:answer:live     # Runs live evaluation against configured AI provider
//
// Arguments:
//   --record   Record embeddings, LLM completions, and write answer.baseline.json
//   --live     Evaluate live AI provider without overwriting baseline
// =============================================================================

import fs from "fs";
import { setTimeout as delay } from "node:timers/promises";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";
import { installAnswerRecorder } from "./answer-eval/recording.ts";
import { validateAnswerFixture } from "./answer-eval/fixtureValidation.ts";
import type { AnswerBaseline } from "../tests/eval/answer-harness.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const FIXTURE_DIR = path.join(REPO, "tests/fixtures/answer-eval");
const BASELINE_PATH = path.join(REPO, "tests/eval/answer.baseline.json");

// Ensure throwaway database directory for evaluation
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "contrack-answer-eval-"));
process.env.DATA_DIR = dataDir;
process.env.DISABLE_BACKGROUND_JOBS = "true";
let closeDatabase: (() => void) | undefined;
process.env.AUTH_REQUIRED = "";
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "warn";
process.env.AI_GATEWAY_TIMEOUT_OVERRIDE = "90000";

// Transformers model cache
process.env.TRANSFORMERS_CACHE =
  process.env.TRANSFORMERS_CACHE ??
  path.join(REPO, "node_modules/.cache/transformers");

function write(file: string, value: unknown): void {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function encodeVectors(rows: Float32Array[], dimension: number): Buffer {
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
  return buf;
}

function toFloat32(buf: Buffer): Float32Array {
  return new Float32Array(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  );
}

async function main(): Promise<void> {
  const isRecord = process.argv.includes("--record");
  const reportIndex = process.argv.indexOf("--report");
  const reportPath =
    reportIndex < 0 ? undefined : process.argv[reportIndex + 1];
  if (reportIndex >= 0 && (!reportPath || reportPath.startsWith("--")))
    throw new Error("--report requires a file path");
  if (isRecord && process.argv.includes("--live")) {
    throw new Error("Choose either --record or --live, not both.");
  }
  const delayIndex = process.argv.indexOf("--query-delay-ms");
  const queryDelayMs =
    delayIndex < 0 ? 0 : Number(process.argv[delayIndex + 1]);
  if (
    !Number.isInteger(queryDelayMs) ||
    queryDelayMs < 0 ||
    queryDelayMs > 60_000
  )
    throw new Error("--query-delay-ms must be an integer from 0 to 60000");
  const isLive = !isRecord;

  console.log(
    "===============================================================",
  );
  console.log(
    `Contrack AI Answer Pipeline Evaluator [${isRecord ? "RECORD MODE" : isLive ? "LIVE EVALUATION" : "EVALUATION"}]`,
  );
  console.log(
    "===============================================================",
  );

  const { buildAnswerCorpus } = await import("./answer-eval/corpus.ts");
  const { ensureLocalOwner, sqlite } = await import("../server/db.ts");
  closeDatabase = () => sqlite.close();
  const { buildSearchEmbeddingInput } =
    await import("../server/services/search/hybridRetrieval.ts");
  const { scopeForOwnerId } = await import("../server/tenancy/scope.ts");
  const localEmbeddings =
    await import("../server/services/search/localEmbeddings.ts");
  const {
    seedAnswerCorpus,
    measureAnswerPipeline,
    EVAL_DIMENSION,
    ANSWER_SCORING_VERSION,
  } = await import("../tests/eval/answer-harness.ts");
  const { resolveCapability } = await import("../server/ai/capabilities.ts");

  const { resolveEmbeddings } = await import("../server/ai/embeddings.ts");
  if (resolveEmbeddings().kind !== "builtin") {
    throw new Error(
      "Answer evaluation requires the built-in embedding model. Unset AI_EMBEDDINGS_MODEL before running it.",
    );
  }

  const activeCapability = resolveCapability("quick");
  if (!activeCapability) {
    throw new Error(
      "Configure an AI provider for the quick capability before live evaluation or recording.",
    );
  }
  console.log(
    `AI Provider: ${activeCapability?.providerId ?? "none"} (${activeCapability?.model ?? "default"})`,
  );

  const { contacts, queries } = buildAnswerCorpus();
  console.log(
    `Loaded corpus: ${contacts.length} contacts (${contacts.filter((c) => c.isAdversarial).length} adversarial), ${queries.length} evaluation queries`,
  );

  const scope = scopeForOwnerId(ensureLocalOwner());
  const { idByKey, keyById } = await seedAnswerCorpus(scope, contacts);
  console.log("Corpus seeded into SQLite database.");

  // Vector embeddings
  console.log("Initializing vector embeddings model...");
  await localEmbeddings.initLocalEmbeddings();
  if (!localEmbeddings.isLocalEmbeddingReady()) {
    throw new Error("Local embedding model failed to initialize.");
  }
  const embeddedCount = await localEmbeddings.backfillSearchEmbeddings();
  console.log(`Backfilled ${embeddedCount} contact search embeddings.`);

  const readVector = sqlite.prepare(
    "SELECT embedding FROM search_embeddings WHERE contactId = ?",
  );
  const contactVectors: Float32Array[] = [];
  for (const c of contacts) {
    const id = idByKey.get(c.key)!;
    const row = readVector.get(id) as { embedding: Buffer } | undefined;
    if (!row) throw new Error(`Missing embedding for contact "${c.key}"`);
    contactVectors.push(toFloat32(row.embedding));
  }

  const queryVectors: Float32Array[] = [];
  for (const q of queries) {
    const v = await localEmbeddings.embedText(q.q);
    if (!v) throw new Error(`Failed to embed query "${q.q}"`);
    queryVectors.push(v);
  }

  const allContactsByKey = new Map(contacts.map((c) => [c.key, c]));
  const recorder = installAnswerRecorder(activeCapability.provider);
  const embeddingVectors = new Map(
    queries.map((query, index) => [query.q, queryVectors[index]]),
  );
  const embeddingInputs = new Set<string>();
  let measurement;
  try {
    console.log("\nRunning Answer Pipeline Measurement...");
    measurement = await measureAnswerPipeline(
      scope,
      queries,
      idByKey,
      keyById,
      allContactsByKey,
      async (query, plan) => {
        embeddingInputs.add(buildSearchEmbeddingInput(query.q, plan));
        console.log(`Evaluating ${query.id}: ${query.q}`);
        // Pace independent queries outside the production search deadline.
        if (queryDelayMs) await delay(queryDelayMs);
      },
    );
    recorder.assertComplete();
  } finally {
    recorder.restore();
  }
  const recordedResponses = recorder.responses;
  for (const input of embeddingInputs) {
    if (embeddingVectors.has(input)) continue;
    const vector = await localEmbeddings.embedText(input);
    if (!vector) throw new Error(`Failed to embed pipeline query "${input}"`);
    embeddingVectors.set(input, vector);
  }

  console.log(
    "\n===============================================================",
  );
  console.log("Evaluation Results Summary");
  console.log(
    "===============================================================",
  );
  console.log(
    `Filter Interpretation:  Precision=${measurement.filterScore.precision.toFixed(4)} Recall=${measurement.filterScore.recall.toFixed(4)} F1=${measurement.filterScore.f1.toFixed(4)} (Conf Match=${(measurement.filterScore.confidenceAccuracy * 100).toFixed(1)}%)`,
  );
  console.log(
    `Final Results Quality:  Precision=${measurement.resultScore.precision.toFixed(4)} Recall=${measurement.resultScore.recall.toFixed(4)} F1=${measurement.resultScore.f1.toFixed(4)} (TP=${measurement.resultScore.truePositives}, FP=${measurement.resultScore.falsePositives}, FN=${measurement.resultScore.falseNegatives})`,
  );
  console.log(
    `Empty Answer Accuracy:  ${(measurement.emptyAnswerScore.accuracy * 100).toFixed(1)}% (${measurement.emptyAnswerScore.correctEmptyQueries}/${measurement.emptyAnswerScore.totalEmptyQueries} queries correctly empty)`,
  );
  console.log(
    `Injection Resistance:  ${(measurement.injectionScore.resistanceRate * 100).toFixed(1)}% (${measurement.injectionScore.blockedAttempts}/${measurement.injectionScore.totalAttempts} attacks neutralized)`,
  );
  console.log(
    `Synthesis Faithfulness: ${(measurement.synthesisScore.faithfulnessScore * 100).toFixed(1)}% (Unsupported claims=${measurement.synthesisScore.unsupportedClaims})`,
  );

  console.log("\nPerformance By Query Category:");
  for (const [cat, s] of Object.entries(measurement.byCategory)) {
    console.log(
      `  ${cat.padEnd(24)} FilterF1=${s.filterF1.toFixed(2)}  ResultF1=${s.resultF1.toFixed(2)}  EmptyAcc=${(s.emptyAccuracy * 100).toFixed(0)}%  InjResist=${(s.injectionResistance * 100).toFixed(0)}%  Faithful=${(s.faithfulness * 100).toFixed(0)}%`,
    );
  }

  if (reportPath)
    write(path.resolve(reportPath), {
      scoringVersion: ANSWER_SCORING_VERSION,
      corpus: { contacts: contacts.length, queries: queries.length },
      recordedAt: new Date().toISOString(),
      provider: activeCapability.providerId,
      models: [...recorder.models],
      measurement,
    });

  if (isRecord) {
    const vectors = encodeVectors(
      [...contactVectors, ...embeddingVectors.values()],
      EVAL_DIMENSION,
    );
    const manifest = {
      model: "Xenova/all-MiniLM-L6-v2",
      dimension: EVAL_DIMENSION,
      contacts: contacts.length,
      queries: queries.length,
      queryInputs: [...embeddingVectors.keys()],
      recordedAt: new Date().toISOString(),
    };
    validateAnswerFixture(
      { contacts, queries },
      manifest,
      vectors,
      EVAL_DIMENSION,
    );
    console.log(`\nWriting fixtures to ${FIXTURE_DIR}...`);
    fs.mkdirSync(FIXTURE_DIR, { recursive: true });
    write(path.join(FIXTURE_DIR, "contacts.json"), contacts);
    write(path.join(FIXTURE_DIR, "queries.json"), queries);
    write(path.join(FIXTURE_DIR, "recorded-responses.json"), recordedResponses);
    fs.writeFileSync(path.join(FIXTURE_DIR, "vectors.bin"), vectors);
    write(path.join(FIXTURE_DIR, "vectors.json"), manifest);

    const baseline: AnswerBaseline = {
      scoringVersion: ANSWER_SCORING_VERSION,
      measurementSource: "provider-recording",
      measuredAt: new Date().toISOString(),
      recordedAt: new Date().toISOString(),
      provider: activeCapability.providerId,
      model: [...recorder.models].sort().join(", "),
      corpus: {
        contacts: contacts.length,
        queries: queries.length,
        adversarialContacts: contacts.filter((c) => c.isAdversarial).length,
      },
      filterScore: measurement.filterScore,
      resultScore: measurement.resultScore,
      emptyAnswerScore: measurement.emptyAnswerScore,
      injectionScore: measurement.injectionScore,
      synthesisScore: measurement.synthesisScore,
      byCategory: measurement.byCategory,
    };

    write(BASELINE_PATH, baseline);
    console.log(`Updated baseline written to ${BASELINE_PATH}`);
  }

  console.log("\nFinished successfully.");
}

main()
  .finally(() => {
    try {
      closeDatabase?.();
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  })
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Evaluation failed:", err);
    process.exit(1);
  });
