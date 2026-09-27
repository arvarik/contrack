// =============================================================================
// The local cross-encoder stage
// =============================================================================
// `rerankLocal` reorders the top of the local list by cross-encoder score,
// inside a time budget. Past the budget the list keeps its fused order and
// the late scores are dropped. The worker is replaced here: scores come from
// a scorer the test controls, through the same seam the search gate uses to
// replay recorded scores, or from a mocked worker host.
// =============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({
  active: true,
  jobs: [] as { id: number; job: Record<string, unknown> }[],
  cancelled: [] as number[],
  answer: null as null | ((job: Record<string, unknown>) => Promise<unknown>),
}));

vi.mock("../../server/workers/cpuHost.ts", () => ({
  isWorkerActive: () => host.active,
  startJob: (job: Record<string, unknown>) => {
    const id = host.jobs.length + 1;
    host.jobs.push({ id, job });
    return {
      id,
      result: host.answer ? host.answer(job) : new Promise(() => {}),
    };
  },
  cancelJob: (id: number) => host.cancelled.push(id),
}));

import {
  DEFAULT_RERANK_BUDGET_MS,
  DEFAULT_RERANK_MODEL,
  RERANK_CANDIDATES,
  initCrossEncoder,
  isCrossEncoderReady,
  profileText,
  rerankBudgetMs,
  rerankLocal,
  rerankModel,
  scoreOnWorker,
  setPairScorer,
  type PairRequest,
} from "../../server/services/search/crossEncoder.ts";

const people = (...names: string[]) => names.map((name) => ({ name }));
const names = (list: { name: unknown }[]) => list.map((p) => p.name);

/** A scorer that gives each document the score its name maps to. */
function scoresByName(scores: Record<string, number>, delayMs = 0) {
  const calls: PairRequest[] = [];
  const signals: AbortSignal[] = [];
  setPairScorer(async (request, signal) => {
    calls.push(request);
    signals.push(signal);
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return request.docs.map((doc) => scores[doc.split(" | ")[0]] ?? 0);
  });
  return { calls, signals };
}

beforeEach(() => {
  host.active = true;
  host.jobs = [];
  host.cancelled = [];
  host.answer = null;
  delete process.env.SEARCH_RERANK_MODEL;
  delete process.env.SEARCH_RERANK_BUDGET_MS;
});

afterEach(() => {
  setPairScorer(null);
  vi.restoreAllMocks();
});

describe("reordering inside the budget", () => {
  it("sorts the top candidates by score, highest first", async () => {
    scoresByName({ Ada: 1, Grace: 3, Alan: 2 });
    const list = await rerankLocal(
      "who wrote compilers",
      people("Ada", "Grace", "Alan"),
    );
    expect(names(list)).toEqual(["Grace", "Alan", "Ada"]);
  });

  it("keeps the fused order between equal scores", async () => {
    scoresByName({ Ada: 1, Grace: 1, Alan: 2 });
    const list = await rerankLocal("q", people("Ada", "Grace", "Alan"));
    expect(names(list)).toEqual(["Alan", "Ada", "Grace"]);
  });

  it("scores only the top of the list and leaves the rest in place", async () => {
    const { calls } = scoresByName({ Ada: 1, Grace: 2, Alan: 9, Edsger: 8 });
    const list = await rerankLocal(
      "q",
      people("Ada", "Grace", "Alan", "Edsger"),
      DEFAULT_RERANK_BUDGET_MS,
      { count: 2 },
    );
    expect(calls[0].docs).toHaveLength(2);
    expect(names(list)).toEqual(["Grace", "Ada", "Alan", "Edsger"]);
  });

  it("scores the default number of candidates with the configured model", async () => {
    const { calls } = scoresByName({});
    const many = Array.from({ length: RERANK_CANDIDATES + 5 }, (_, i) => ({
      name: `Person ${i}`,
    }));
    await rerankLocal("q", many);
    expect(calls[0].docs).toHaveLength(RERANK_CANDIDATES);
    expect(calls[0].model).toBe(DEFAULT_RERANK_MODEL);
    expect(calls[0].query).toBe("q");
  });
});

describe("the budget", () => {
  it("keeps the fused order when the scores arrive late", async () => {
    const { signals } = scoresByName({ Ada: 1, Grace: 3 }, 200);
    const started = performance.now();
    const list = await rerankLocal("q", people("Ada", "Grace"), 20);
    expect(names(list)).toEqual(["Ada", "Grace"]);
    // The list came back at the budget, not when the scores did.
    expect(performance.now() - started).toBeLessThan(150);
    // And the scorer was told the scores are no longer wanted.
    expect(signals[0].aborted).toBe(true);
  });

  it("takes its default from SEARCH_RERANK_BUDGET_MS", () => {
    expect(rerankBudgetMs()).toBe(DEFAULT_RERANK_BUDGET_MS);
    process.env.SEARCH_RERANK_BUDGET_MS = "40";
    expect(rerankBudgetMs()).toBe(40);
    process.env.SEARCH_RERANK_BUDGET_MS = "soon";
    expect(rerankBudgetMs()).toBe(DEFAULT_RERANK_BUDGET_MS);
    process.env.SEARCH_RERANK_BUDGET_MS = "-5";
    expect(rerankBudgetMs()).toBe(DEFAULT_RERANK_BUDGET_MS);
  });

  it("skips the stage for a budget of zero", async () => {
    const { calls } = scoresByName({ Grace: 3 });
    const list = await rerankLocal("q", people("Ada", "Grace"), 0);
    expect(names(list)).toEqual(["Ada", "Grace"]);
    expect(calls).toHaveLength(0);
  });
});

describe("when the stage cannot run", () => {
  it("is off when SEARCH_RERANK_MODEL is off", async () => {
    process.env.SEARCH_RERANK_MODEL = "off";
    const { calls } = scoresByName({ Grace: 3 });
    expect(rerankModel()).toBeNull();
    expect(isCrossEncoderReady()).toBe(false);
    const list = await rerankLocal("q", people("Ada", "Grace"));
    expect(names(list)).toEqual(["Ada", "Grace"]);
    expect(calls).toHaveLength(0);
  });

  it("reads another model from SEARCH_RERANK_MODEL", () => {
    process.env.SEARCH_RERANK_MODEL = "Xenova/ms-marco-MiniLM-L-6-v2";
    expect(rerankModel()).toBe("Xenova/ms-marco-MiniLM-L-6-v2");
  });

  it("is skipped until a model has loaded", async () => {
    expect(isCrossEncoderReady("Xenova/not-loaded")).toBe(false);
    const list = await rerankLocal("q", people("Ada", "Grace"), 25, {
      model: "Xenova/not-loaded",
    });
    expect(names(list)).toEqual(["Ada", "Grace"]);
    expect(host.jobs).toHaveLength(0);
  });

  it("keeps the fused order when scoring fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    setPairScorer(async () => {
      throw new Error("session lost");
    });
    const list = await rerankLocal("q", people("Ada", "Grace"));
    expect(names(list)).toEqual(["Ada", "Grace"]);
  });

  it("keeps the fused order when the scores do not fit the list", async () => {
    setPairScorer(async () => [1]);
    expect(names(await rerankLocal("q", people("Ada", "Grace")))).toEqual([
      "Ada",
      "Grace",
    ]);
    setPairScorer(async () => [1, Number.NaN]);
    expect(names(await rerankLocal("q", people("Ada", "Grace")))).toEqual([
      "Ada",
      "Grace",
    ]);
  });

  it("does not score a list of one", async () => {
    const { calls } = scoresByName({});
    await rerankLocal("q", people("Ada"));
    expect(calls).toHaveLength(0);
  });
});

describe("the worker", () => {
  it("sends one rerank job and returns its scores", async () => {
    host.answer = async () => ({
      kind: "rerank",
      scores: [0.5, -1],
      modelLoaded: true,
    });
    const scores = await scoreOnWorker(
      { model: "m", query: "q", docs: ["a", "b"] },
      new AbortController().signal,
    );
    expect(scores).toEqual([0.5, -1]);
    expect(host.jobs[0].job).toEqual({
      kind: "rerank",
      model: "m",
      query: "q",
      docs: ["a", "b"],
      maxLength: 128,
    });
  });

  it("cancels the job once the scores are too late", async () => {
    const late = new AbortController();
    void scoreOnWorker({ model: "m", query: "q", docs: ["a"] }, late.signal);
    late.abort();
    expect(host.cancelled).toEqual([host.jobs[0].id]);
  });

  it("loads the model at boot with one pair, and is ready after", async () => {
    host.answer = async () => ({
      kind: "rerank",
      scores: [1],
      modelLoaded: true,
    });
    const model = "Xenova/boot-model";
    expect(isCrossEncoderReady(model)).toBe(false);
    expect(await initCrossEncoder(model)).toBe(true);
    expect(isCrossEncoderReady(model)).toBe(true);
    // Loaded once. A second call sends nothing.
    expect(await initCrossEncoder(model)).toBe(true);
    expect(host.jobs).toHaveLength(1);
  });

  it("stays off when the model does not load", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    host.answer = async () => {
      throw new Error("no network");
    };
    expect(await initCrossEncoder("Xenova/missing")).toBe(false);
    expect(isCrossEncoderReady("Xenova/missing")).toBe(false);
  });

  it("stays off when the worker is not running", async () => {
    host.active = false;
    expect(await initCrossEncoder("Xenova/no-worker")).toBe(false);
    expect(host.jobs).toHaveLength(0);
  });

  it("stays off when SEARCH_RERANK_MODEL is off", async () => {
    process.env.SEARCH_RERANK_MODEL = "off";
    expect(await initCrossEncoder()).toBe(false);
    expect(host.jobs).toHaveLength(0);
  });
});

describe("the profile text", () => {
  it("reads name, role, company, location, industry, headline, about, tags and interests", () => {
    expect(
      profileText({
        name: "Mireia Puig",
        role: "Customer Success Lead",
        company: "Cobalt Payments",
        location: "Barcelona",
        industry: "Fintech",
        headline: "Keeps the large accounts happy",
        about: "Cooks for twenty every Sunday.",
        tags: [
          { id: "t1", tag: "customer success" },
          { id: "t2", tag: "fintech" },
        ],
        interests: [{ id: "i1", interest: "cookery" }, "open water swimming"],
      }),
    ).toBe(
      "Mireia Puig | Customer Success Lead | Cobalt Payments | Barcelona | Fintech | " +
        "Keeps the large accounts happy | Cooks for twenty every Sunday. | " +
        "customer success, fintech | cookery, open water swimming",
    );
  });

  it("leaves out empty fields and reads only the first 200 characters of about", () => {
    const text = profileText({
      name: "Ada Lovelace",
      role: null,
      company: "  ",
      about: "a".repeat(500),
      tags: "not a list",
    });
    expect(text).toBe(`Ada Lovelace | ${"a".repeat(200)}`);
  });

  it("stays short enough to cross the thread boundary cheaply", () => {
    const text = profileText({
      name: "N",
      headline: "h".repeat(2_000),
      about: "a".repeat(2_000),
    });
    expect(text.length).toBeLessThanOrEqual(600);
  });
});
