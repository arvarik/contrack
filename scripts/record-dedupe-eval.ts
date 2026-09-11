#!/usr/bin/env tsx
// =============================================================================
// Record the dedupe precision and recall baseline
// =============================================================================
// Run this when a change to the matchers, the thresholds or the passes is
// intended:
//
//   npm run eval:record:dedupe
//
// It writes one committed file:
//
//   tests/eval/dedupe.baseline.json   precision and recall per pass
//
// The baseline diff is the evidence that goes in the pull request. A change
// that improves matching shows as numbers going up; a change that was meant
// to be a rearrangement and is not shows as numbers moving at all.
// `tests/eval/dedupe.eval.test.ts` fails in both directions, so nobody can
// improve or damage matching without saying so.
//
// Unlike the search recorder this writes no fixture. The corpus is built from
// `scripts/dedupe-eval/corpus.ts` at run time by both the recorder and the
// gate, and there is no model in the loop, so there is nothing to record that
// the source does not already say.
// =============================================================================

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const BASELINE = path.join(REPO, "tests/eval/dedupe.baseline.json");

// The database has to be a throwaway. Set before anything imports server/db.
process.env.DATA_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "contrack-dedupe-eval-"),
);
process.env.DISABLE_BACKGROUND_JOBS = "true";
process.env.AI_PROVIDER = "gemini";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";
process.env.ANTHROPIC_API_KEY = "";
process.env.AUTH_REQUIRED = "";

async function main(): Promise<void> {
  const { buildCorpus } = await import("./dedupe-eval/corpus.ts");
  const { ensureLocalOwner } = await import("../server/db.ts");
  const { scopeForOwnerId } = await import("../server/tenancy/scope.ts");
  const { seedCorpus, measure, PASSES } =
    await import("../tests/eval/dedupe-harness.ts");

  const corpus = buildCorpus();
  console.log(
    `corpus: ${corpus.contacts.length} contacts, ` +
      `${corpus.duplicates.length} duplicate pairs, ` +
      `${corpus.negatives.length} hard negatives`,
  );

  const scope = scopeForOwnerId(ensureLocalOwner());
  const seeded = await seedCorpus(scope, corpus);
  console.log("corpus seeded");

  const measurement = await measure(scope, seeded);

  const { THRESHOLDS } = await import("../tests/eval/dedupe-harness.ts");
  write(BASELINE, {
    recordedAt: new Date().toISOString(),
    corpus: {
      contacts: corpus.contacts.length,
      duplicatePairs: corpus.duplicates.length,
      hardNegatives: corpus.negatives.length,
    },
    thresholds: THRESHOLDS,
    passes: measurement,
  });

  console.log("");
  console.log("baseline");
  for (const pass of PASSES) {
    const { score, recallByKind, negativesMatchedByKind } = measurement[pass];
    console.log(
      `  ${pass.padEnd(14)} precision ${score.precision.toFixed(4)}  ` +
        `recall ${score.recall.toFixed(4)}  F1 ${score.f1.toFixed(4)}  ` +
        `mean conf ${score.meanConfidence.toFixed(4)}  ` +
        `(${score.truePositives} true, ${score.falsePositives} false, ` +
        `${score.falseNegatives} missed)`,
    );
    console.log(
      `  ${" ".repeat(14)} at auto-merge: ${score.autoProduced} pairs, ` +
        `precision ${score.autoPrecision.toFixed(4)} ` +
        `(${score.autoFalsePositives} would merge two different people)`,
    );
    const weakest = Object.entries(recallByKind)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 4)
      .map(([kind, value]) => `${kind} ${value.toFixed(2)}`)
      .join(", ");
    console.log(`  ${" ".repeat(14)} weakest kinds: ${weakest}`);
    const matched = Object.entries(negativesMatchedByKind)
      .filter(([, n]) => n > 0)
      .map(([kind, n]) => `${kind} ${n}`)
      .join(", ");
    console.log(
      `  ${" ".repeat(14)} hard negatives matched: ${matched || "none"}`,
    );
  }
}

function write(file: string, value: unknown): void {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
