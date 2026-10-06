// The embedder port
// Search and dedupe reach a model only through `currentEmbedder()`. These
// tests pin what each adapter says about itself and sends where, and the two
// rules built on `local`: who may be embedded, and that the built-in model
// loads at boot whatever the capability names. The capability, the account
// switch and the worker host are mocked, so no model runs.

import { beforeEach, describe, expect, it, vi } from "vitest";

const BUILTIN = {
  kind: "builtin",
  model: "Xenova/all-MiniLM-L6-v2",
  dimension: 384,
  signature: "builtin/Xenova/all-MiniLM-L6-v2",
};
const PROVIDER = {
  kind: "provider",
  providerId: "gemini",
  model: "gemini-embedding-001",
  dimension: 768,
  signature: "gemini/gemini-embedding-001",
};

const state = vi.hoisted(() => ({
  resolved: {} as Record<string, unknown>,
  aiAllowed: true,
}));

vi.mock("../../../../server/ai/embeddings.ts", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../server/ai/embeddings.ts")
  >()),
  resolveEmbeddings: () => state.resolved,
  embedWithProvider: vi.fn(
    async (_id: string, _model: string, texts: string[]) =>
      texts.map((_, i) => [i, 1]),
  ),
  probeDimension: vi.fn(async () => 1536),
}));
vi.mock("../../../../server/ai/instanceSwitch.ts", () => ({
  aiAllowedForUser: () => state.aiAllowed,
  isAiOffForInstance: () => false,
}));
// A provider that keeps the use each call sends.
const provider = vi.hoisted(() => ({
  uses: [] as unknown[],
  embed: async (texts: string[], _model: string, use?: string) => {
    provider.uses.push(use);
    return texts.map(() => [1, 0]);
  },
}));
vi.mock("../../../../server/ai/providerRegistry.ts", () => ({
  getProvider: () => provider,
}));
// The library the in-process fallback loads.
const library = vi.hoisted(() => {
  const extract = vi.fn(async (texts: string[]) => ({
    tolist: () => texts.map(() => new Array(384).fill(0.1)),
  }));
  return { extract, pipeline: vi.fn(async () => extract) };
});
vi.mock("@huggingface/transformers", () => ({
  env: {},
  pipeline: library.pipeline,
}));
vi.mock("../../../../server/workers/cpuHost.ts", () => ({
  isWorkerActive: () => true,
  runOnWorker: vi.fn(),
}));

import {
  embedWithProvider,
  probeDimension,
} from "../../../../server/ai/embeddings.ts";
import { runOnWorker } from "../../../../server/workers/cpuHost.ts";
import {
  builtinEmbedder,
  currentEmbedder,
  initBuiltinEmbedder,
  localEmbedder,
  mayEmbedContactsFor,
} from "../../../../server/ai/embedder.ts";

/** The worker answering with `width`-wide vectors, one per text. */
function workerAnswers(width = 384) {
  vi.mocked(runOnWorker).mockImplementation(async (job, _inProcess, read) => {
    const count = (job as { texts: string[] }).texts.length;
    return read({
      kind: "embed",
      flat: new Float32Array(count * width).fill(0.5),
      count,
      dimension: width,
      modelLoaded: true,
    });
  });
}

const aborted = () => AbortSignal.abort();

beforeEach(() => {
  state.resolved = BUILTIN;
  state.aiAllowed = true;
  vi.mocked(runOnWorker).mockReset();
  vi.mocked(embedWithProvider).mockClear();
  vi.mocked(probeDimension).mockClear();
});

describe("the built-in model", () => {
  it("loads at boot on the worker, even with a provider model pinned", async () => {
    state.resolved = PROVIDER;
    vi.mocked(runOnWorker).mockRejectedValueOnce(new Error("no model files"));
    await initBuiltinEmbedder();
    expect(builtinEmbedder.ready()).toBe(false);

    workerAnswers();
    await initBuiltinEmbedder();
    expect(builtinEmbedder.ready()).toBe(true);
    expect(vi.mocked(runOnWorker).mock.calls[1][0]).toEqual({
      kind: "embed",
      model: "Xenova/all-MiniLM-L6-v2",
      pooling: "mean",
      texts: ["contrack"],
      batchSize: 64,
    });
    // The probe never reaches the provider the capability names.
    expect(embedWithProvider).not.toHaveBeenCalled();
  });

  it("is what the capability names by default, and stays on this server", async () => {
    expect(currentEmbedder()).toBe(builtinEmbedder);
    expect(builtinEmbedder).toMatchObject({
      id: BUILTIN.signature,
      local: true,
    });
    expect(await builtinEmbedder.dimension()).toBe(384);
  });

  it("copies each vector out of the worker's buffer", async () => {
    workerAnswers();
    const [first, second] = await builtinEmbedder.embed(["a", "b"], "query");
    expect(first).toHaveLength(384);
    expect(first.buffer).not.toBe(second.buffer);
    expect(first.buffer.byteLength).toBe(384 * 4);
  });

  it("refuses another width or a short batch, and asks nothing for no texts", async () => {
    workerAnswers(768);
    await expect(builtinEmbedder.embed(["a"], "document")).rejects.toThrow(
      "Expected 384-dim vector",
    );
    vi.mocked(runOnWorker).mockResolvedValueOnce([]);
    await expect(builtinEmbedder.embed(["a"], "document")).rejects.toThrow(
      "returned 0 vectors for 1 texts",
    );
    vi.mocked(runOnWorker).mockClear();
    expect(await builtinEmbedder.embed([], "document")).toEqual([]);
    await expect(
      builtinEmbedder.embed(["a"], "query", aborted()),
    ).rejects.toThrow();
    expect(runOnWorker).not.toHaveBeenCalled();
  });
});

describe("another local model", () => {
  const card = {
    model: "Xenova/bge-small-en-v1.5",
    dimension: 384,
    pooling: "cls" as const,
    prefix: { query: "Find: " },
  };

  it("sends its id and pooling, and the prefix for each use", async () => {
    const bge = localEmbedder(card);
    expect(localEmbedder({ ...card })).toBe(bge);
    expect(() => localEmbedder({ ...card, pooling: "mean" })).toThrow(
      "different settings",
    );
    expect(bge).toMatchObject({ id: `builtin/${card.model}`, local: true });
    expect(bge.ready()).toBe(false);
    workerAnswers();
    await bge.embed(["who keeps bees"], "query");
    await bge.embed(["Ada | Founder"], "document");
    const job = { kind: "embed", model: card.model, pooling: "cls" };
    expect(vi.mocked(runOnWorker).mock.calls.map(([sent]) => sent)).toEqual([
      { ...job, texts: ["Find: who keeps bees"], batchSize: 64 },
      { ...job, texts: ["Ada | Founder"], batchSize: 64 },
    ]);
  });

  it("reads the same card when the worker never started", async () => {
    vi.mocked(runOnWorker).mockImplementation(async (_job, inProcess) =>
      inProcess(),
    );
    const [vector] = await localEmbedder(card).embed(["Ada"], "document");
    expect(library.pipeline).toHaveBeenCalledWith(
      "feature-extraction",
      card.model,
      expect.anything(),
    );
    expect(library.extract).toHaveBeenCalledWith(["Ada"], {
      pooling: "cls",
      normalize: true,
    });
    expect(vector).toHaveLength(384);
  });
});

describe("a provider model", () => {
  it("is what the capability names: its signature, and not local", async () => {
    state.resolved = PROVIDER;
    const embedder = currentEmbedder();
    // Gemini reads the use as a task type, so its vectors and its id are new.
    expect(embedder).toMatchObject({
      id: `${PROVIDER.signature}+tasks`,
      local: false,
    });
    expect(embedder.ready()).toBe(true);

    const vectors = await embedder.embed(["a", "b"], "document");
    expect(embedWithProvider).toHaveBeenCalledWith(
      "gemini",
      "gemini-embedding-001",
      ["a", "b"],
      "document",
    );
    expect(vectors.map((vector) => [...vector])).toEqual([
      [0, 1],
      [1, 1],
    ]);
    expect(await embedder.embed([], "document")).toEqual([]);
    await expect(embedder.embed(["a"], "query", aborted())).rejects.toThrow();
    expect(embedWithProvider).toHaveBeenCalledOnce();

    // Another provider ignores the use, and keeps its signature as its id.
    state.resolved = {
      ...PROVIDER,
      providerId: "openai",
      signature: "openai/e3",
    };
    expect(currentEmbedder().id).toBe("openai/e3");
    state.resolved = PROVIDER;

    // The pin test probes with the request the index will make.
    const actual = await vi.importActual<
      typeof import("../../../../server/ai/embeddings.ts")
    >("../../../../server/ai/embeddings.ts");
    await actual.probeDimension("gemini", "an-unprobed-model");
    expect(provider.uses).toEqual(["document"]);

    // The cached width answers. An unknown one is probed once.
    expect(await embedder.dimension()).toBe(768);
    expect(probeDimension).not.toHaveBeenCalled();
    state.resolved = { ...PROVIDER, dimension: null };
    expect(await currentEmbedder().dimension()).toBe(1536);
    expect(probeDimension).toHaveBeenCalledWith(
      "gemini",
      "gemini-embedding-001",
    );
  });
});

describe("who may be embedded", () => {
  it("is every account for a local model, and an account with AI on for a provider", () => {
    state.aiAllowed = false;
    expect(mayEmbedContactsFor("owner")).toBe(true);
    state.resolved = PROVIDER;
    expect(mayEmbedContactsFor("owner")).toBe(false);
    state.aiAllowed = true;
    expect(mayEmbedContactsFor("owner")).toBe(true);
  });
});
