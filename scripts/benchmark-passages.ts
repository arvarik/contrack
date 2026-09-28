#!/usr/bin/env node
import { seedPassageCorpus } from "../tests/fixtures/passage-eval/seed.ts";
// Run with --live to verify final answers with the configured AI provider.
// The database contains synthetic records and lives in a temporary directory.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  passageCases,
  passageNegatives,
} from "../tests/fixtures/passage-eval/cases.ts";

const args = process.argv.slice(2);
const value = (flag: string) => {
  const i = args.indexOf(flag);
  return i < 0 ? undefined : args[i + 1];
};
const record = args.includes("--record");
const live = args.includes("--live") || record;
const count = Number(value("--contacts") ?? 5000);
if (!Number.isInteger(count) || count < 100 || count > 50000)
  throw new Error("--contacts must be 100 to 50000");
const dataDir = mkdtempSync(path.join(tmpdir(), "contrack-passages-"));
process.env.DATA_DIR = dataDir;
process.env.DISABLE_BACKGROUND_JOBS = "true";
process.env.AUTH_REQUIRED = "";
if (!live)
  for (const key of ["GEMINI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"])
    process.env[key] = "";
const { installAnswerRecorder, identifyAnswerCall } =
  await import("./answer-eval/recording.ts");
const { log } = await import("../server/utils/logger.ts");
log._fmt = () => {};
const { sqlite, ensureLocalOwner } = await import("../server/db.ts");
const { scopeForOwnerId } = await import("../server/tenancy/scope.ts");
const {
  initLocalEmbeddings,
  ensureEmbeddingStore,
  embedText,
  findSearchNeighbors,
} = await import("../server/services/search/localEmbeddings.ts");
const { localRetrieval } =
  await import("../server/services/search/hybridRetrieval.ts");
const { searchService } = await import("../server/services/searchService.ts");
const { resolveCapability } = await import("../server/ai/capabilities.ts");
const { resolveEmbeddings } = await import("../server/ai/embeddings.ts");
const { stopCpuWorker } = await import("../server/workers/cpuHost.ts");
const { aiCache } = await import("../server/utils/aiCache.ts");
const { getSearchCoverage } =
  await import("../server/services/search/indexQueue.ts");
const { invalidateSearchCache } = await import("../server/utils/aiCache.ts");

const percentile = (xs: number[], p: number) =>
  [...xs].sort((a, b) => a - b)[
    Math.min(xs.length - 1, Math.ceil(xs.length * p) - 1)
  ] ?? 0;
const stats = (xs: number[]) => ({
  p50: percentile(xs, 0.5),
  p95: percentile(xs, 0.95),
  samples: xs.length,
});
try {
  if (resolveEmbeddings().kind !== "builtin")
    throw new Error("Use built-in embeddings for this benchmark");
  if (live && !resolveCapability("quick"))
    throw new Error("Configure an AI provider for --live");
  const capability = resolveCapability("quick");
  const recorder =
    live && capability ? installAnswerRecorder(capability.provider) : null;
  const prompts = new Map<string, string>();
  if (recorder && capability) {
    const generate = capability.provider.generate.bind(capability.provider);
    capability.provider.generate = async (options) => {
      const call = identifyAnswerCall(options);
      if (call?.operation === "rerank")
        prompts.set(call.queryKey, options.prompt);
      return generate(options);
    };
  }
  const ownerId = ensureLocalOwner();
  const scope = scopeForOwnerId(ownerId);
  seedPassageCorpus(sqlite, ownerId, count);
  await initLocalEmbeddings();
  const indexingStart = performance.now();
  await ensureEmbeddingStore();
  const indexingMs = performance.now() - indexingStart;
  const timings: number[] = [];
  const rows = [];
  for (const item of passageCases) {
    const vector = await embedText(item.query);
    if (!vector)
      throw new Error("The embedding model did not return a query vector");
    const baseline = findSearchNeighbors(scope, vector, 10).map(
      (row) => row.contactId,
    );
    let result;
    for (let run = 0; run < 4; run++) {
      const start = performance.now();
      result = await localRetrieval(scope, item.query, { queryVector: vector });
      if (run) timings.push(performance.now() - start);
    }
    const rank =
      result!.candidates.findIndex((row) => row.contactId === item.id) + 1;
    rows.push({
      id: item.id,
      query: item.query,
      baselineDenseHit: baseline.includes(item.id),
      rank,
    });
  }
  const answers = [];
  if (live)
    for (const item of [
      ...passageCases.map((item) => ({
        query: item.query,
        expected: [item.id] as string[],
      })),
      ...passageNegatives.map((query) => ({ query, expected: [] as string[] })),
    ]) {
      aiCache.invalidateAll();
      invalidateSearchCache();
      const start = performance.now();
      const result = await searchService.semanticSearch(
        scope,
        item.query,
        "passage-benchmark",
      );
      answers.push({
        ...item,
        ids: result.matches.map((row) => row.id),
        fallback: result.fallback,
        ms: performance.now() - start,
        evidence: result.matches.map((row) => row.aiEvidence ?? null),
      });
      process.stderr.write(
        `Verified ${answers.length}/${passageCases.length + passageNegatives.length}: ${result.fallback ? "fallback" : result.matches.map((row) => row.id).join(",") || "empty"}\n`,
      );
      await delay(1000);
    }
  let tp = 0,
    fp = 0,
    fn = 0;
  for (const answer of answers) {
    tp += answer.ids.filter((id) => answer.expected.includes(id)).length;
    fp += answer.ids.filter((id) => !answer.expected.includes(id)).length;
    fn += answer.expected.filter((id) => !answer.ids.includes(id)).length;
  }
  const report = {
    contacts: count,
    model: resolveEmbeddings().signature,
    aiModel: resolveCapability("quick")?.model,
    coverage: getSearchCoverage(scope),
    indexingMs,
    passages: (
      sqlite
        .prepare("SELECT COUNT(*) AS n FROM search_passages WHERE ownerId = ?")
        .get(ownerId) as { n: number }
    ).n,
    databaseBytes:
      Number(sqlite.pragma("page_count", { simple: true })) *
      Number(sqlite.pragma("page_size", { simple: true })),
    retrievalMs: stats(timings),
    prefixDenseRecallAt10:
      rows.filter((row) => row.baselineDenseHit).length / rows.length,
    passageHybridRecallAt10:
      rows.filter((row) => row.rank > 0 && row.rank <= 10).length / rows.length,
    final: live
      ? {
          tp,
          fp,
          fn,
          precision: tp / Math.max(1, tp + fp),
          recall: tp / Math.max(1, tp + fn),
          latencyMs: stats(answers.map((row) => row.ms)),
          fallbacks: answers.filter((row) => row.fallback).length,
        }
      : null,
    queries: rows,
    answers,
    responses: recorder?.responses,
  };
  try {
    recorder?.assertComplete();
  } catch (error) {
    if (value("--report"))
      writeFileSync(
        value("--report")!,
        JSON.stringify({ ...report, providerError: String(error) }, null, 2) +
          "\n",
      );
    throw error;
  }
  recorder?.restore();
  if (record) {
    if (count !== 100)
      throw new Error(
        "--record requires --contacts 100 to keep the CI fixture small",
      );
    const { currentSearchText, embedBatch } =
      await import("../server/services/search/localEmbeddings.ts");
    const { passageSnapshot } =
      await import("../server/services/search/passages.ts");
    const { buildSearchEmbeddingInput } =
      await import("../server/services/search/hybridRetrieval.ts");
    const texts = new Set<string>();
    for (const row of sqlite
      .prepare("SELECT id FROM contacts WHERE ownerId = ? ORDER BY rowid")
      .all(ownerId) as { id: string }[]) {
      texts.add(currentSearchText(row.id)!);
      for (const passage of passageSnapshot(row.id)!.passages)
        texts.add(`${passage.context.slice(0, 200)} | ${passage.text}`);
    }
    for (const answer of answers) {
      texts.add(answer.query);
      const raw =
        recorder?.responses.queryParse[answer.query.toLowerCase().trim()];
      if (raw)
        texts.add(buildSearchEmbeddingInput(answer.query, JSON.parse(raw)));
    }
    const inputs = [...texts];
    const vectors: Float32Array[] = [];
    for (let i = 0; i < inputs.length; i += 32) {
      const batch = await embedBatch(inputs.slice(i, i + 32));
      if (batch.some((row) => !row))
        throw new Error("Missing recording vector");
      vectors.push(...(batch as Float32Array[]));
    }
    const folder = new URL("../tests/fixtures/passage-eval/", import.meta.url);
    writeFileSync(
      new URL("vectors.bin", folder),
      Buffer.concat(
        vectors.map((row) =>
          Buffer.from(row.buffer, row.byteOffset, row.byteLength),
        ),
      ),
    );
    writeFileSync(
      new URL("vectors.json", folder),
      JSON.stringify(
        { dimension: 384, model: resolveEmbeddings().signature, inputs },
        null,
        2,
      ) + "\n",
    );
    for (const [key, raw] of Object.entries(recorder!.responses.rerank)) {
      const listed = JSON.parse(
        prompts
          .get(key)!
          .match(
            /<untrusted_data label="candidate contacts JSON">\n([\s\S]*?)\n<\/untrusted_data>/,
          )![1],
      ) as {
        id: string;
        name: string;
        passages?: {
          id: string;
          field: string;
          text: string;
          context: string;
        }[];
      }[];
      const matches = JSON.parse(raw) as {
        contact_id: string;
        passage_id?: string;
      }[];
      for (const match of matches) {
        const candidate = listed.find(
          (candidate) => candidate.id === match.contact_id,
        );
        if (!candidate) continue;
        const contact = sqlite
          .prepare("SELECT id FROM contacts WHERE ownerId = ? AND name = ?")
          .get(ownerId, candidate.name) as { id: string } | undefined;
        if (!contact)
          throw new Error("Cannot bind a recorded candidate to its source");
        match.contact_id = contact.id;
        const quoted = candidate.passages?.find(
          (passage) => passage.id === match.passage_id,
        );
        if (quoted) {
          const passage = passageSnapshot(contact.id)!.passages.find(
            (passage) =>
              passage.field === quoted.field &&
              passage.text === quoted.text &&
              passage.context === quoted.context,
          );
          if (!passage)
            throw new Error("Cannot bind a recorded passage to its source");
          match.passage_id = passage.id;
        }
      }
      recorder!.responses.rerank[key] = JSON.stringify(matches);
    }
    writeFileSync(
      new URL("recorded-responses.json", folder),
      JSON.stringify(recorder?.responses, null, 2) + "\n",
    );
  }
  const output = JSON.stringify(report, null, 2) + "\n";
  if (value("--report")) writeFileSync(value("--report")!, output);
  console.log(output);
  if (
    report.passageHybridRecallAt10 < 0.9 ||
    (live &&
      (report.final!.precision < 0.95 ||
        report.final!.recall < 0.9 ||
        report.final!.fallbacks > 0))
  )
    process.exitCode = 1;
} finally {
  await stopCpuWorker();
  sqlite.close();
  rmSync(dataDir, { recursive: true, force: true });
}
