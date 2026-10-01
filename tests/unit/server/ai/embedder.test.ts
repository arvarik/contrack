// =============================================================================
// The embedder port
// =============================================================================
// Search and dedupe reach a model only through `currentEmbedder()`. These
// tests pin what each adapter says about itself and sends where, and the two
// rules built on `local`: who may be embedded, and that the built-in model
// loads at boot whatever the capability names. The capability, the account
// switch and the worker host are mocked, so no model runs.
// =============================================================================

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

vi.mock("../../../../server/ai/embeddings.ts", () => ({
  BUILTIN_DIMENSION: 384,
  BUILTIN_MODEL_ID: "Xenova/all-MiniLM-L6-v2",
  resolveEmbeddings: () => state.resolved,
  embedWithProvider: vi.fn(
    async (_id: string, _model: string, texts: string[]) =>
      texts.map((_, i) => [i, 1]),
  ),
}));
vi.mock("../../../../server/ai/instanceSwitch.ts", () => ({
  aiAllowedForUser: () => state.aiAllowed,
}));
vi.mock("../../../../server/workers/cpuHost.ts", () => ({
  isWorkerActive: () => true,
  runOnWorker: vi.fn(),
}));

import { embedWithProvider } from "../../../../server/ai/embeddings.ts";
import { runOnWorker } from "../../../../server/workers/cpuHost.ts";
import {
  builtinEmbedder,
  currentEmbedder,
  initBuiltinEmbedder,
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
      texts: ["contrack"],
      batchSize: 64,
    });
    // The probe never reaches the provider the capability names.
    expect(embedWithProvider).not.toHaveBeenCalled();
  });

  it("is what the capability names by default, and stays on this server", () => {
    expect(currentEmbedder()).toBe(builtinEmbedder);
    expect(builtinEmbedder).toMatchObject({
      id: BUILTIN.signature,
      dimension: 384,
      local: true,
    });
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

describe("a provider model", () => {
  it("is what the capability names: its signature, its width, not local", async () => {
    state.resolved = PROVIDER;
    const embedder = currentEmbedder();
    expect(embedder).toMatchObject({
      id: PROVIDER.signature,
      dimension: 768,
      local: false,
    });
    expect(embedder.ready()).toBe(true);

    const vectors = await embedder.embed(["a", "b"], "document");
    expect(embedWithProvider).toHaveBeenCalledWith(
      "gemini",
      "gemini-embedding-001",
      ["a", "b"],
    );
    expect(vectors.map((vector) => [...vector])).toEqual([
      [0, 1],
      [1, 1],
    ]);
    expect(await embedder.embed([], "document")).toEqual([]);
    await expect(embedder.embed(["a"], "query", aborted())).rejects.toThrow();
    expect(embedWithProvider).toHaveBeenCalledOnce();
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
