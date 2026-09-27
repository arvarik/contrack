#!/usr/bin/env node
// =============================================================================
// Ask Contrack search benchmark
// =============================================================================
// Three modes. Each one works in a temporary database and never opens the
// owner's own.
//
//   node scripts/benchmark-search.ts
//       10,000 simple rows: the cost of a contact edit and of one keyword
//       search against the FTS index. The numbers docs/search-hardening.md
//       quotes.
//
//   node scripts/benchmark-search.ts --contacts 5000
//       The search-gate corpus (300 contacts) plus generated contacts up to
//       N (default 5,000), 70 percent with an email, 50 percent with a phone,
//       600 with a last-contact date. Real MiniLM vectors when the model is
//       available. Prints p50 and p95 for the sidebar search with and
//       without a facet, lexical search, the query embedding, the KNN,
//       `localRetrieval` per query kind, and the local answer as a person
//       gets it (a local kind's final answer, a facet answer, or the instant
//       chunk with hydration), then recall@10 and MRR per channel for the
//       golden queries.
//
//   node scripts/benchmark-search.ts --live
//       The same database, then the Ask pipeline with the configured
//       provider: ten queries, three cold runs each, each model stage from
//       the adapter's own latency, then one query again while two 15 s
//       background jobs hold both shared AI slots. Needs a provider key in
//       the environment:
//         (set -a; . ../contrack/.env; set +a; node scripts/benchmark-search.ts --live)
//       A run costs a few cents.
//
// Flags: --json prints one JSON document instead of the report. --runs N sets
// the timed repetitions per query (default 5, 3 for --live). --rrf-k N sets
// the fusion constant for the k sweep (default: the code's RRF_K).
// --verbose keeps the server's log lines. The script never prints a key.
// =============================================================================

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string): string | undefined => {
  const index = args.indexOf(name);
  const value = args[index + 1];
  return index >= 0 && value && !value.startsWith("--") ? value : undefined;
};
const live = flag("--live");
const json = flag("--json");
const verbose = flag("--verbose");
const corpusMode = live || flag("--contacts");
const contactCount = Number(option("--contacts") ?? 5_000);
const runs = Number(option("--runs") ?? (live ? 3 : 5));
const rrfK =
  option("--rrf-k") === undefined ? undefined : Number(option("--rrf-k"));
if (!Number.isInteger(contactCount) || contactCount < 300)
  throw new Error("--contacts needs a whole number of at least 300");
if (!Number.isInteger(runs) || runs < 1 || runs > 50)
  throw new Error("--runs needs a whole number from 1 to 50");
if (rrfK !== undefined && (!Number.isInteger(rrfK) || rrfK < 1 || rrfK > 1000))
  throw new Error("--rrf-k needs a whole number from 1 to 1000");

// Each run uses synthetic data in a temporary database, including when comparing branches.
const dataDir = mkdtempSync(path.join(tmpdir(), "contrack-search-bench-"));
process.env.DATA_DIR = dataDir;
process.env.DISABLE_BACKGROUND_JOBS = "true";
process.env.AUTH_REQUIRED = "";
if (!live) {
  // Blank, not deleted: loadEnv fills only unset variables, and a key from
  // .env would make a local benchmark call a provider.
  process.env.GEMINI_API_KEY = "";
  process.env.OPENAI_API_KEY = "";
  process.env.ANTHROPIC_API_KEY = "";
}
// The model files sit beside the dependency, so a run needs no download.
const bundledModels = path.join(
  REPO,
  "node_modules/@huggingface/transformers/.cache",
);
if (!process.env.TRANSFORMERS_CACHE && existsSync(bundledModels))
  process.env.TRANSFORMERS_CACHE = bundledModels;

const load = <T>(file: string): Promise<T> =>
  import(pathToFileURL(path.join(REPO, file)).href) as Promise<T>;

if (!verbose) {
  const { log } = await load<typeof import("../server/utils/logger.ts")>(
    "server/utils/logger.ts",
  );
  log._fmt = () => {};
}
type Db = typeof import("../server/db.ts");
const { sqlite } = await load<Db>("server/db.ts");

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

interface Stat {
  p50: number;
  p95: number;
  samples: number;
}

/** Nearest-rank percentiles, in milliseconds to two decimals. */
function stat(values: number[]): Stat {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) =>
    sorted.length
      ? +sorted[
          Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)
        ].toFixed(2)
      : 0;
  return { p50: at(0.5), p95: at(0.95), samples: sorted.length };
}

async function timed<T>(work: () => T | Promise<T>): Promise<[T, number]> {
  const start = performance.now();
  const value = await work();
  return [value, performance.now() - start];
}

const ms = (value: number) => `${value.toFixed(1)} ms`;
/** Seconds, or milliseconds under one second. */
const seconds = (value: number) =>
  value < 1000 ? ms(value) : `${(value / 1000).toFixed(2)} s`;
const pad = (text: string, width: number) => text.padEnd(width);

// ---------------------------------------------------------------------------
// Mode 1: edits and keyword searches on 10,000 simple rows
// ---------------------------------------------------------------------------

async function simpleRows() {
  const count = 10_000;
  // Every contact has an owner since the tenancy work, and the insert
  // trigger refuses a row without one.
  const { ensureLocalOwner } = await load<Db>("server/db.ts");
  const ownerId = ensureLocalOwner();
  const insert = sqlite.prepare(
    "INSERT INTO contacts(id, ownerId, name, company, role) VALUES (?, ?, ?, ?, ?)",
  );
  sqlite.transaction(() => {
    for (let i = 0; i < count; i++)
      insert.run(
        `bench-${i}`,
        ownerId,
        `Contact ${i}`,
        `Company ${i % 100}`,
        "Engineer",
      );
  })();
  const update = sqlite.prepare("UPDATE contacts SET role = ? WHERE id = ?");
  const query = sqlite.prepare(
    "SELECT contactId FROM contacts_fts WHERE contacts_fts MATCH ? ORDER BY rank LIMIT 20",
  );
  const edits: number[] = [];
  const searches: number[] = [];
  for (let i = 0; i < 100; i++) {
    let start = performance.now();
    update.run(i % 2 ? "Engineer" : "Designer", `bench-${i}`);
    edits.push(performance.now() - start);
    start = performance.now();
    query.all(`"Company ${i % 100}"`);
    searches.push(performance.now() - start);
  }
  const result = {
    contacts: count,
    samples: 100,
    edit: stat(edits),
    search: stat(searches),
  };
  console.log(
    json
      ? JSON.stringify(result)
      : `10,000 rows, 100 samples each\n` +
          `  contact edit     p50 ${ms(result.edit.p50)}  p95 ${ms(result.edit.p95)}\n` +
          `  keyword search   p50 ${ms(result.search.p50)}  p95 ${ms(result.search.p95)}`,
  );
}

// ---------------------------------------------------------------------------
// The corpus: the search gate's 300 contacts plus generated ones
// ---------------------------------------------------------------------------

const INDUSTRIES = [
  "Fintech",
  "Healthcare",
  "Logistics",
  "Education",
  "Media",
  "Climate",
  "Retail",
  "Biotech",
  "Security",
  "Gaming",
  "Real Estate",
  "Consulting",
];
const TAGS = [
  "founder",
  "mentor",
  "alumni",
  "client",
  "friend",
  "speaker",
  "advisor",
];
const INTERESTS = [
  "running",
  "chess",
  "jazz",
  "photography",
  "cycling",
  "cooking",
  "sailing",
  "hiking",
  "poetry",
  "gardening",
];

async function seedCorpus() {
  const { faker } = await import("@faker-js/faker");
  const { ensureLocalOwner } = await load<Db>("server/db.ts");
  const { scopeForOwnerId } = await load<
    typeof import("../server/tenancy/scope.ts")
  >("server/tenancy/scope.ts");
  const { contactService } = await load<
    typeof import("../server/services/contactService.ts")
  >("server/services/contactService.ts");
  const { buildCorpus } = await load<typeof import("./search-eval/corpus.ts")>(
    "scripts/search-eval/corpus.ts",
  );
  const harness = await load<typeof import("../tests/eval/harness.ts")>(
    "tests/eval/harness.ts",
  );
  const localEmbeddings = await load<
    typeof import("../server/services/search/localEmbeddings.ts")
  >("server/services/search/localEmbeddings.ts");

  const scope = scopeForOwnerId(ensureLocalOwner());
  const corpus = buildCorpus();
  const [{ idByKey }, seedMs] = await timed(() =>
    harness.seedCorpus(scope, corpus.contacts),
  );

  // Generated contacts, the same on every run.
  faker.seed(20_260_926);
  const pick = <T>(list: T[], n: number) =>
    faker.helpers.arrayElements(list, n);
  const generated = Array.from(
    { length: contactCount - corpus.contacts.length },
    () => {
      const firstName = faker.person.firstName();
      const lastName = faker.person.lastName();
      const company = faker.company.name();
      const role = faker.person.jobTitle();
      return {
        name: `${firstName} ${lastName}`,
        firstName,
        lastName,
        company,
        role,
        location: `${faker.location.city()}, ${faker.location.country()}`,
        industry: faker.helpers.arrayElement(INDUSTRIES),
        headline: `${role} at ${company}`,
        about: `${faker.company.catchPhrase()}. ${faker.person.bio()}.`,
        tags: pick(TAGS, faker.number.int({ min: 0, max: 2 })),
        interests: pick(INTERESTS, faker.number.int({ min: 0, max: 3 })),
        emails:
          faker.number.float() < 0.7
            ? [faker.internet.email({ firstName, lastName }).toLowerCase()]
            : [],
        phones:
          faker.number.float() < 0.5
            ? [
                faker.phone.number({
                  style: faker.datatype.boolean()
                    ? "national"
                    : "international",
                }),
              ]
            : [],
      };
    },
  );
  const [, generateMs] = await timed(async () => {
    for (let i = 0; i < generated.length; i += 500)
      await contactService.bulkCreateContacts(
        scope,
        generated.slice(i, i + 500),
      );
  });

  // 600 contacts get a last-contact date in the last 14 months.
  const rows = sqlite
    .prepare(
      "SELECT id FROM contacts WHERE ownerId = ? AND id NOT IN (SELECT value FROM json_each(?)) ORDER BY id",
    )
    .all(scope.ownerId, JSON.stringify([...idByKey.values()])) as {
    id: string;
  }[];
  const setLast = sqlite.prepare(
    "UPDATE contacts SET lastContactedAt = ? WHERE id = ? AND ownerId = ?",
  );
  sqlite.transaction(() => {
    rows.slice(0, 600).forEach((row, i) => {
      const daysAgo = (i * 7) % 425;
      setLast.run(
        new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
        row.id,
        scope.ownerId,
      );
    });
  })();

  await localEmbeddings.initLocalEmbeddings();
  let embedded = 0;
  let embedMs = 0;
  if (localEmbeddings.isLocalEmbeddingReady())
    [embedded, embedMs] = await timed(() =>
      localEmbeddings.backfillSearchEmbeddings(),
    );

  return {
    scope,
    corpus,
    idByKey,
    emails: generated.flatMap((c) => c.emails).slice(0, 10),
    phones: generated.flatMap((c) => c.phones).slice(0, 10),
    exactNames: corpus.contacts.slice(0, 10).map((c) => c.name),
    embedded,
    timings: { seedMs: seedMs + generateMs, embedMs },
  };
}

type Seeded = Awaited<ReturnType<typeof seedCorpus>>;

async function modules() {
  return {
    search: await load<typeof import("../server/services/searchService.ts")>(
      "server/services/searchService.ts",
    ),
    lexical: await load<typeof import("../server/services/search/lexical.ts")>(
      "server/services/search/lexical.ts",
    ),
    hybrid: await load<
      typeof import("../server/services/search/hybridRetrieval.ts")
    >("server/services/search/hybridRetrieval.ts"),
    intent: await load<typeof import("../server/services/search/intent.ts")>(
      "server/services/search/intent.ts",
    ),
    embeddings: await load<
      typeof import("../server/services/search/localEmbeddings.ts")
    >("server/services/search/localEmbeddings.ts"),
    cache: await load<typeof import("../server/utils/aiCache.ts")>(
      "server/utils/aiCache.ts",
    ),
    harness: await load<typeof import("../tests/eval/harness.ts")>(
      "tests/eval/harness.ts",
    ),
  };
}

// ---------------------------------------------------------------------------
// Mode 2: local stages and quality at N contacts
// ---------------------------------------------------------------------------

async function localBenchmark(seeded: Seeded) {
  const m = await modules();
  const { scope, corpus } = seeded;

  /** The kind the pipeline gives a query: strict keyword results decide it. */
  const kindOf = (query: string) => {
    const strict = m.lexical.lexicalSearch(scope, query, 30);
    const names = new Map(
      (
        sqlite
          .prepare(
            "SELECT id, name FROM contacts WHERE ownerId = ? AND id IN (SELECT value FROM json_each(?))",
          )
          .all(
            scope.ownerId,
            JSON.stringify(strict.map((row) => row.contactId)),
          ) as { id: string; name: string }[]
      ).map((row) => [row.id, row.name]),
    );
    const results = strict.flatMap((row) => {
      const name = names.get(row.contactId);
      return name
        ? [{ name, approximate: row.approximate, score: row.score }]
        : [];
    });
    return m.intent.classifyQuery(query, m.intent.nameSignals(query, results))
      .kind;
  };

  const groups: Record<string, string[]> = {
    "exact name": seeded.exactNames,
    "typo name": corpus.queries
      .filter((q) => q.kind === "name-typo")
      .map((q) => q.q),
    email: seeded.emails,
    phone: seeded.phones,
    // The sentence kinds. Nickname questions start with a name, and the
    // other kinds are names, emails, phone numbers and prefixes.
    question: corpus.queries
      .filter((q) =>
        ["company-role", "location-interest", "note-phrase"].includes(q.kind),
      )
      .map((q) => q.q),
  };

  const samples = new Map<string, number[]>();
  const add = (key: string, value: number) =>
    samples.set(key, [...(samples.get(key) ?? []), value]);
  /** One facet per sidebar search, in turn: a tag, an industry, a last contact, a place. */
  const FACETS = [
    { field: "tag" as const, value: "founder" },
    { field: "industry" as const, value: "Fintech" },
    { field: "contacted" as const, value: "90d", operator: ">" as const },
    { field: "location" as const, value: "a" },
  ];
  const kinds = new Map<string, Record<string, number>>();
  /** The kind each group should get, when it has one. */
  const expected: Record<string, string> = {
    "exact name": "name",
    "typo name": "name",
    email: "email",
    phone: "phone",
  };
  const unexpected: { group: string; query: string; kind: string }[] = [];

  for (const [group, queries] of Object.entries(groups)) {
    for (const query of queries) {
      const kind = kindOf(query);
      const counts = kinds.get(group) ?? {};
      counts[kind] = (counts[kind] ?? 0) + 1;
      kinds.set(group, counts);
      if (expected[group] && expected[group] !== kind)
        unexpected.push({ group, query, kind });
      const vector = await m.embeddings.embedText(query);
      for (let run = 0; run <= runs; run++) {
        const warm = run > 0;
        const [, sidebar] = await timed(() =>
          m.search.searchService.searchFts(scope, query),
        );
        const [, facetSearch] = await timed(() =>
          m.search.searchService.searchFts(scope, query, [
            FACETS[run % FACETS.length],
          ]),
        );
        const [, lexical] = await timed(() =>
          m.lexical.lexicalSearch(scope, query, 20, null, true),
        );
        const [, embed] = await timed(() => m.embeddings.embedText(query));
        const [, knn] = await timed(() =>
          vector ? m.embeddings.findSearchNeighbors(scope, vector, 100) : [],
        );
        const [, retrieval] = await timed(() =>
          m.hybrid.localRetrieval(scope, query, { limit: 30, rrfK }),
        );
        m.cache.aiCache.invalidateAll();
        const [answer, answerMs] = await timed(() =>
          m.search.searchService.semanticSearch(
            scope,
            query,
            "bench",
            undefined,
            { aiAllowed: false, rrfK },
          ),
        );
        if (!warm) continue;
        add(`sidebar:${group}`, sidebar);
        add("facet", facetSearch);
        add(`lexical:${group}`, lexical);
        if (vector) {
          add("embed", embed);
          add("knn", knn);
        }
        add(`retrieval:${kind}`, retrieval);
        add(answer.fallback ? `instant:${kind}` : `local:${kind}`, answerMs);
      }
    }
  }

  // Ask questions a filter answers, with no model call: typed facets, and
  // facets read from the words.
  const facetQuestions = {
    "facets only": ["tag:founder", "industry:Fintech contacted:>90d"],
    "implicit facets": ["who works in fintech", "people in Berlin"],
  };
  for (const [kind, questions] of Object.entries(facetQuestions))
    for (const query of questions)
      for (let run = 0; run <= runs; run++) {
        m.cache.aiCache.invalidateAll();
        const [, answerMs] = await timed(() =>
          m.search.searchService.semanticSearch(
            scope,
            query,
            "bench",
            undefined,
            { aiAllowed: false },
          ),
        );
        if (run > 0) add(`facets:${kind}`, answerMs);
      }

  const [quality, qualityMs] = await timed(() =>
    m.harness.measure(scope, corpus.queries, seeded.idByKey, { rrfK }),
  );

  const stats = Object.fromEntries(
    [...samples.entries()].map(([key, values]) => [key, stat(values)]),
  );
  return {
    contacts: contactCount,
    vectors: seeded.embedded,
    seedMs: Math.round(seeded.timings.seedMs),
    embedMs: Math.round(seeded.timings.embedMs),
    runs,
    rrfK: rrfK ?? m.hybrid.RRF_K,
    queries: corpus.queries.length,
    kinds: Object.fromEntries(kinds),
    unexpected,
    stats,
    quality: { channels: quality.channels, byKind: quality.byKind },
    qualityMs: Math.round(qualityMs),
  };
}

function printLocal(result: Awaited<ReturnType<typeof localBenchmark>>) {
  const lines: string[] = [];
  lines.push(
    `Ask Contrack, ${result.contacts.toLocaleString("en-US")} contacts, ` +
      `${result.vectors.toLocaleString("en-US")} vectors ` +
      `(seeded in ${seconds(result.seedMs)}, embedded in ${seconds(result.embedMs)}), ${result.runs} timed runs per query, RRF k = ${result.rrfK}`,
  );
  lines.push("");
  lines.push(`${pad("Stage", 44)}${pad("p50", 10)}${pad("p95", 10)}samples`);
  const order = [
    ["sidebar:exact name", "Sidebar keyword search, exact name"],
    ["sidebar:typo name", "Sidebar keyword search, typo name"],
    ["facet", "Sidebar keyword search with one facet"],
    ["facets:facets only", "Ask, facets only (no model)"],
    ["facets:implicit facets", "Ask, implicit facets (no model)"],
    ["lexical:exact name", "Lexical search, exact name"],
    ["lexical:question", "Lexical search, question"],
    ["embed", "Query embedding on the worker"],
    ["knn", "vec0 KNN, k = 100"],
  ];
  for (const [key, label] of order) {
    const s = result.stats[key];
    if (s)
      lines.push(
        `${pad(label, 44)}${pad(ms(s.p50), 10)}${pad(ms(s.p95), 10)}${s.samples}`,
      );
  }
  for (const [key, s] of Object.entries(result.stats).sort()) {
    const [stage, kind] = key.split(":");
    const label =
      stage === "retrieval"
        ? `localRetrieval, ${kind}`
        : stage === "local"
          ? `Local answer, ${kind} (complete, no model)`
          : stage === "instant"
            ? `Instant chunk, ${kind} (list + hydration)`
            : null;
    if (label)
      lines.push(
        `${pad(label, 44)}${pad(ms(s.p50), 10)}${pad(ms(s.p95), 10)}${s.samples}`,
      );
  }
  lines.push("");
  lines.push("Query groups by classified kind:");
  for (const [group, counts] of Object.entries(result.kinds))
    lines.push(
      `  ${pad(group, 12)}${Object.entries(counts)
        .map(([kind, n]) => `${kind} ${n}`)
        .join(", ")}`,
    );
  for (const { group, query, kind } of result.unexpected)
    lines.push(`  not local: "${query}" (${group}) is ${kind}`);
  lines.push("");
  lines.push(
    `Quality on the ${result.queries} golden queries (recall@10 / MRR):`,
  );
  for (const [channel, score] of Object.entries(result.quality.channels))
    lines.push(
      `  ${pad(channel, 10)}${score.recallAt10.toFixed(3)} / ${score.mrr.toFixed(3)}`,
    );
  for (const channel of ["fused", "hybrid"] as const) {
    const typo = result.quality.byKind[channel]?.["name-typo"];
    if (typo)
      lines.push(
        `  ${pad(`${channel}, name-typo queries only`, 32)}${typo.recallAt10.toFixed(2)} / ${typo.mrr.toFixed(2)}`,
      );
  }
  console.log(lines.join("\n"));
}

// ---------------------------------------------------------------------------
// Mode 3: the live pipeline with the configured provider
// ---------------------------------------------------------------------------

interface ModelCall {
  operation: string;
  /** The adapter's own latency. */
  latencyMs: number;
}

async function liveBenchmark(seeded: Seeded) {
  const m = await modules();
  const { resolveCapability } = await load<
    typeof import("../server/ai/capabilities.ts")
  >("server/ai/capabilities.ts");
  const gateway = await load<typeof import("../server/ai/gateway.ts")>(
    "server/ai/gateway.ts",
  );
  const { identifyAnswerCall } = await load<
    typeof import("./answer-eval/recording.ts")
  >("scripts/answer-eval/recording.ts");
  const capability = resolveCapability("quick");
  if (!capability)
    throw new Error(
      "--live needs an AI provider for the quick capability. Put its key in the environment.",
    );

  // Each provider call, with the adapter's own latency.
  const calls: ModelCall[] = [];
  const provider = capability.provider;
  const generate = provider.generate.bind(provider);
  provider.generate = async (options) => {
    const result = await generate(options);
    calls.push({
      operation: identifyAnswerCall(options)?.operation ?? "other",
      latencyMs: result.latencyMs,
    });
    return result;
  };

  const queries = [
    "Jonathon Smyth",
    seeded.exactNames[0],
    seeded.emails[0],
    seeded.phones[0],
    "product manager at Northwind Logistics",
    "who in Lisbon goes rock climbing",
    "people I haven't talked to in 3 months",
    "who works in fintech",
    "someone who knows about beekeeping",
    "investors in Berlin",
  ];

  /** One cold run: caches cleared, the stream read chunk by chunk. */
  const ask = async (query: string) => {
    m.cache.aiCache.invalidateAll();
    calls.length = 0;
    const start = performance.now();
    let instantMs: number | null = null;
    let complete: {
      matches: { verified?: boolean }[];
      fallback: boolean;
    } | null = null;
    const res = {
      destroyed: false,
      writableEnded: false,
      write(line: string) {
        const chunk = JSON.parse(line);
        if (chunk.phase === "instant") instantMs = performance.now() - start;
        if (chunk.phase === "complete") complete = chunk;
        return true;
      },
      end() {
        this.writableEnded = true;
      },
    };
    await m.search.searchService.semanticSearchStream(
      scope(),
      query,
      "bench-live",
      res as never,
    );
    const totalMs = performance.now() - start;
    const stage = (operation: string) =>
      calls
        .filter((call) => call.operation === operation)
        .reduce((sum, call) => sum + call.latencyMs, 0);
    const done = complete as {
      matches: { verified?: boolean }[];
      fallback: boolean;
    } | null;
    return {
      totalMs,
      instantMs,
      plannerMs: stage("queryParse"),
      rerankMs: stage("rerank"),
      modelCalls: calls.length,
      answers: done?.matches.length ?? 0,
      fallback: done?.fallback ?? true,
      path:
        calls.length === 0
          ? "local"
          : calls.some((call) => call.operation === "rerank")
            ? "planner + reranker"
            : "planner, SQL proof",
    };
  };
  const scope = () => seeded.scope;

  const results: Record<string, Awaited<ReturnType<typeof ask>>[]> = {};
  for (const query of queries) {
    results[query] = [];
    for (let run = 0; run < runs; run++) results[query].push(await ask(query));
  }

  // Both shared slots held by 15 s background jobs, as a research batch would.
  const queue = gateway.__getGenerationQueueForTests();
  const hold = () =>
    queue.run(() => new Promise((resolve) => setTimeout(resolve, 15_000)), {
      priority: "background",
      accountId: "bench-background",
    });
  const holds = [hold(), hold()];
  const busyQuery = "investors in Berlin";
  const busy = await ask(busyQuery);
  const sharedWhileBusy = gateway.getAIQueueSnapshot().active;
  await Promise.all(holds);

  const aiTotals = Object.values(results)
    .flat()
    .filter((run) => run.modelCalls > 0)
    .map((run) => run.totalMs);
  const localTotals = Object.values(results)
    .flat()
    .filter((run) => run.modelCalls === 0)
    .map((run) => run.totalMs);
  return {
    provider: capability.providerId,
    model: capability.model,
    runs,
    results,
    busy: { query: busyQuery, sharedSlotsBusy: sharedWhileBusy, ...busy },
    ai: stat(aiTotals),
    local: stat(localTotals),
  };
}

function printLive(result: Awaited<ReturnType<typeof liveBenchmark>>) {
  const lines: string[] = [];
  lines.push(
    `Live Ask pipeline, ${result.provider} (${result.model ?? "auto"}), ${result.runs} cold runs per query`,
  );
  lines.push("");
  lines.push(
    `${pad("Query", 42)}${pad("Path", 22)}${pad("Instant", 10)}${pad("Planner", 10)}${pad("Reranker", 10)}${pad("Total", 10)}${pad("Over model", 12)}Answer`,
  );
  const med = (values: number[]) => stat(values).p50;
  for (const [query, runsOf] of Object.entries(result.results)) {
    const last = runsOf[runsOf.length - 1];
    const overhead = runsOf.map(
      (run) => run.totalMs - run.plannerMs - run.rerankMs,
    );
    const instant = runsOf.flatMap((run) =>
      run.instantMs === null ? [] : [run.instantMs],
    );
    lines.push(
      `${pad(query.length > 40 ? `${query.slice(0, 39)}…` : query, 42)}` +
        `${pad(last.path, 22)}` +
        `${pad(instant.length ? ms(med(instant)) : "none", 10)}` +
        `${pad(last.plannerMs ? seconds(med(runsOf.map((r) => r.plannerMs))) : "none", 10)}` +
        `${pad(last.rerankMs ? seconds(med(runsOf.map((r) => r.rerankMs))) : "none", 10)}` +
        `${pad(seconds(med(runsOf.map((r) => r.totalMs))), 10)}` +
        `${pad(ms(med(overhead)), 12)}` +
        `${runsOf.map((run) => `${run.answers}${run.fallback ? " unverified" : ""}`).join(", ")}`,
    );
  }
  lines.push("");
  lines.push(
    `Model runs: p50 ${seconds(result.ai.p50)}, p95 ${seconds(result.ai.p95)} (${result.ai.samples} runs)`,
  );
  lines.push(
    `Local runs: p50 ${ms(result.local.p50)}, p95 ${ms(result.local.p95)} (${result.local.samples} runs, no model call)`,
  );
  lines.push(
    `"${result.busy.query}" with ${result.busy.sharedSlotsBusy} shared slots busy: ` +
      `${seconds(result.busy.totalMs)} (planner ${seconds(result.busy.plannerMs)}, ` +
      `${ms(result.busy.totalMs - result.busy.plannerMs - result.busy.rerankMs)} over the model), ` +
      `${result.busy.answers} people, ${result.busy.path}`,
  );
  console.log(lines.join("\n"));
}

// ---------------------------------------------------------------------------

try {
  if (!corpusMode) await simpleRows();
  else {
    const seeded = await seedCorpus();
    if (live) {
      const result = await liveBenchmark(seeded);
      if (json) console.log(JSON.stringify(result));
      else printLive(result);
    } else {
      const result = await localBenchmark(seeded);
      if (json) console.log(JSON.stringify(result));
      else printLocal(result);
    }
  }
} finally {
  sqlite.close();
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(0);
