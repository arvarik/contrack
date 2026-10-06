// Integration: the search lane of the AI queue
// Ask generations (the planner, the reranker and the brief) run in a lane
// with two slots of its own, so a question does not wait behind research
// calls in the shared slots. These tests hold the shared slots and prove an
// Ask generation does not wait for them, and that the lane keeps its own
// limit and order.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/ai/capabilities.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/ai/capabilities.ts")>()),
  resolveCapability: vi.fn(),
}));

import { resolveCapability } from "../../server/ai/capabilities.ts";
import {
  generateFor,
  getAIQueueSnapshot,
  streamFor,
  __getGenerationQueueForTests,
} from "../../server/ai/gateway.ts";
import type { AIProvider } from "../../server/ai/provider.ts";
import type { AIGenerateOptions } from "../../server/ai/types.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/** Prompts that start with "hold" wait for `gate`. Others answer at once. */
let gate = deferred();
const started: string[] = [];

beforeEach(() => {
  __getGenerationQueueForTests().__resetForTests();
  gate = deferred();
  started.length = 0;
  const provider = {
    name: "Scripted",
    generate: async (options: AIGenerateOptions) => {
      started.push(options.prompt);
      if (options.prompt.startsWith("hold")) await gate.promise;
      return { text: options.prompt, model: "scripted", latencyMs: 1 };
    },
  } as AIProvider;
  vi.mocked(resolveCapability).mockReturnValue({
    capability: "quick",
    providerId: "scripted",
    model: "scripted-lite",
    modelClass: "lite",
    provider,
  } as unknown as ReturnType<typeof resolveCapability>);
});

afterEach(() => {
  gate.resolve();
});

const ask = (prompt: string, lane?: "search") =>
  generateFor("quick", { prompt, responseFormat: "text", lane });

describe("the search lane", () => {
  it("starts a search generation while 2 background and 2 interactive jobs hold the shared slots", async () => {
    const shared = [
      generateFor("quick", {
        prompt: "hold background 1",
        responseFormat: "text",
        priority: "background",
        accountId: "owner-a",
      }),
      generateFor("quick", {
        prompt: "hold background 2",
        responseFormat: "text",
        priority: "background",
        accountId: "owner-a",
      }),
      generateFor("quick", {
        prompt: "hold interactive 1",
        responseFormat: "text",
        priority: "interactive",
        accountId: "owner-b",
      }),
      generateFor("quick", {
        prompt: "hold interactive 2",
        responseFormat: "text",
        priority: "interactive",
        accountId: "owner-b",
      }),
    ];
    await vi.waitFor(() =>
      expect(getAIQueueSnapshot()).toMatchObject({ active: 2, waiting: 2 }),
    );

    const answer = await ask("planner", "search");
    expect(answer.text).toBe("planner");
    expect(started).toEqual([
      "hold background 1",
      "hold background 2",
      "planner",
    ]);
    // The shared slots never saw it.
    expect(getAIQueueSnapshot()).toMatchObject({
      active: 2,
      waiting: 2,
      search: { active: 0, waiting: 0, concurrency: 2 },
    });

    gate.resolve();
    await Promise.all(shared);
  });

  it("streams in the lane too", async () => {
    const held = [ask("hold 1"), ask("hold 2")];
    await vi.waitFor(() => expect(getAIQueueSnapshot().active).toBe(2));
    const pieces: string[] = [];
    const result = await streamFor(
      "quick",
      { prompt: "brief", responseFormat: "text", lane: "search" },
      (piece) => pieces.push(piece),
    );
    // The scripted provider cannot stream, so its text arrives as one piece.
    expect(pieces).toEqual(["brief"]);
    expect(result.text).toBe("brief");
    gate.resolve();
    await Promise.all(held);
  });

  it("has two slots and one first-in, first-out queue", async () => {
    const first = ask("hold search 1", "search");
    const second = ask("hold search 2", "search");
    const third = ask("search 3", "search");
    const fourth = ask("search 4", "search");
    await vi.waitFor(() =>
      expect(getAIQueueSnapshot().search).toMatchObject({
        active: 2,
        waiting: 2,
      }),
    );
    expect(started).toEqual(["hold search 1", "hold search 2"]);

    // A full lane leaves the shared slots free.
    expect((await ask("shared")).text).toBe("shared");

    gate.resolve();
    await Promise.all([first, second, third, fourth]);
    expect(started).toEqual([
      "hold search 1",
      "hold search 2",
      "shared",
      "search 3",
      "search 4",
    ]);
    expect(getAIQueueSnapshot().search).toMatchObject({
      active: 0,
      waiting: 0,
    });
  });

  it("drops a waiting search job whose caller gave up", async () => {
    const held = [
      ask("hold search 1", "search"),
      ask("hold search 2", "search"),
    ];
    await vi.waitFor(() => expect(getAIQueueSnapshot().search.active).toBe(2));
    const controller = new AbortController();
    const abandoned = generateFor("quick", {
      prompt: "abandoned",
      responseFormat: "text",
      lane: "search",
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(getAIQueueSnapshot().search.waiting).toBe(1));
    controller.abort();
    await expect(abandoned).rejects.toThrow();
    expect(getAIQueueSnapshot().search.waiting).toBe(0);

    gate.resolve();
    await Promise.all(held);
    expect(started).not.toContain("abandoned");
  });
});
