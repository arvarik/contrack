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
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";
import type {
  RecordedResponses,
  AnswerBaseline,
} from "../tests/eval/answer-harness.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const FIXTURE_DIR = path.join(REPO, "tests/fixtures/answer-eval");
const BASELINE_PATH = path.join(REPO, "tests/eval/answer.baseline.json");

// Ensure throwaway database directory for evaluation
process.env.DATA_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "contrack-answer-eval-"),
);
process.env.DISABLE_BACKGROUND_JOBS = "true";
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

async function main(): Promise<void> {
  const isRecord = process.argv.includes("--record");
  const isLive = process.argv.includes("--live") || !isRecord;

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
  const { scopeForOwnerId } = await import("../server/tenancy/scope.ts");
  const localEmbeddings =
    await import("../server/services/search/localEmbeddings.ts");
  const { seedAnswerCorpus, measureAnswerPipeline, EVAL_DIMENSION } =
    await import("../tests/eval/answer-harness.ts");
  const { resolveCapability } = await import("../server/ai/capabilities.ts");

  const activeCapability = resolveCapability("quick");
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

  // If recording, pre-load existing model completions for offline replay
  const recordedResponsesPath = path.join(
    FIXTURE_DIR,
    "recorded-responses.json",
  );
  const recordedResponses: RecordedResponses = {
    queryParse: {},
    rerank: {},
    synthesis: {},
  };

  if (fs.existsSync(recordedResponsesPath)) {
    try {
      const existing = JSON.parse(
        fs.readFileSync(recordedResponsesPath, "utf8"),
      ) as RecordedResponses;
      Object.assign(recordedResponses.queryParse, existing.queryParse ?? {});
      Object.assign(recordedResponses.rerank, existing.rerank ?? {});
      Object.assign(recordedResponses.synthesis, existing.synthesis ?? {});
      console.log(
        `Loaded existing recorded responses: ` +
          `${Object.keys(recordedResponses.queryParse).length} queryParse, ` +
          `${Object.keys(recordedResponses.rerank).length} rerank, ` +
          `${Object.keys(recordedResponses.synthesis).length} synthesis`,
      );
    } catch {
      // ignore
    }
  }

  const allContactsByKey = new Map(contacts.map((c) => [c.key, c]));

  if (isRecord) {
    console.log("\nRecording live LLM responses for offline CI fixture...");
    fs.mkdirSync(FIXTURE_DIR, { recursive: true });

    if (activeCapability) {
      const origGenerate = activeCapability.provider.generate.bind(
        activeCapability.provider,
      );

      activeCapability.provider.generate = async (options) => {
        const prompt = options.prompt ?? "";
        const system = options.systemPrompt ?? "";

        let op: "queryParse" | "rerank" | "synthesis" | null = null;
        let queryKey = "";

        if (system.includes("query planner") || prompt.startsWith("Query: ")) {
          op = "queryParse";
          const qMatch = prompt.match(/Query:\s*"([^"]+)"/i);
          if (qMatch) queryKey = qMatch[1].toLowerCase().trim();
        } else if (
          system.includes("data analyst") ||
          prompt.includes("CANDIDATES (")
        ) {
          op = "rerank";
          const qMatch = prompt.match(/QUERY:\s*"([^"]+)"/i);
          if (qMatch) queryKey = qMatch[1].toLowerCase().trim();
        } else if (
          system.includes("executive brief") ||
          prompt.includes("MATCHING CONTACTS (")
        ) {
          op = "synthesis";
          const qMatch = prompt.match(/QUERY:\s*"([^"]+)"/i);
          if (qMatch) queryKey = qMatch[1].toLowerCase().trim();
        }

        // If we already recorded this response, replay it directly to avoid rate limits
        if (op && queryKey && recordedResponses[op][queryKey]) {
          return {
            text: recordedResponses[op][queryKey],
            model: "recorded-replay",
            latencyMs: 5,
          };
        }

        // Call live model with exponential backoff on 429 / quota errors
        let attempts = 0;
        let lastErr: unknown;
        while (attempts < 5) {
          attempts++;
          try {
            const res = await origGenerate(options);
            if (op && queryKey && res.text) {
              recordedResponses[op][queryKey] = res.text;
              write(recordedResponsesPath, recordedResponses);
            }
            // Pacing to stay comfortably under API rate limits
            await new Promise((resolve) => setTimeout(resolve, 2500));
            return res;
          } catch (err) {
            lastErr = err;
            const msg = String(err);
            if (
              msg.includes("429") ||
              msg.includes("quota") ||
              msg.includes("RESOURCE_EXHAUSTED") ||
              msg.includes("circuit breaker") ||
              msg.includes("retries")
            ) {
              const waitSec = attempts * 15;
              console.log(
                `Rate limit encountered. Backing off for ${waitSec}s (attempt ${attempts}/5)...`,
              );
              await new Promise((resolve) =>
                setTimeout(resolve, waitSec * 1000),
              );
            } else {
              throw err;
            }
          }
        }
        throw lastErr;
      };
    }
  }

  console.log("\nRunning Answer Pipeline Measurement...");
  const measurement = await measureAnswerPipeline(
    scope,
    queries,
    idByKey,
    keyById,
    allContactsByKey,
  );

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

  if (isRecord) {
    console.log(`\nWriting fixtures to ${FIXTURE_DIR}...`);
    write(path.join(FIXTURE_DIR, "contacts.json"), contacts);
    write(path.join(FIXTURE_DIR, "queries.json"), queries);
    write(path.join(FIXTURE_DIR, "recorded-responses.json"), recordedResponses);

    const allVectors = [...contactVectors, ...queryVectors];
    writeVectors(
      path.join(FIXTURE_DIR, "vectors.bin"),
      allVectors,
      EVAL_DIMENSION,
    );
    write(path.join(FIXTURE_DIR, "vectors.json"), {
      model: "Xenova/all-MiniLM-L6-v2",
      dimension: EVAL_DIMENSION,
      contacts: contacts.length,
      queries: queries.length,
      recordedAt: new Date().toISOString(),
    });

    const baseline: AnswerBaseline = {
      recordedAt: new Date().toISOString(),
      provider: activeCapability?.providerId ?? "gemini",
      model: activeCapability?.model ?? "default",
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
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Evaluation failed:", err);
    process.exit(1);
  });
