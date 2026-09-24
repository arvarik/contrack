// @vitest-environment jsdom
/**
 * The moments the corvid answers.
 *
 * The bird is part of the app's own work, not a toy beside it: finishing a
 * follow-up gets a nod, writing down a conversation a silent caw, somebody
 * new a hop, tracking a person a cock of the head, a merge a preen, a
 * restore from the trash a nod. Each one is asked for by the mutation that
 * did the work, on success only, so a failed save never looks celebrated.
 *
 * `fetch` is the only thing stubbed: these are the real hooks.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CORVID_REACT_EVENT, resetCorvidActivity } from "../../src/lib/corvid";
import { useCompleteActionItem } from "../../src/api/actionItems";
import { useAddInteraction } from "../../src/api/interactions";
import {
  useCreateContact,
  useRestoreContact,
  useSetTracked,
} from "../../src/api/contacts";
import {
  useMergeBatch,
  useMergeCluster,
  useMergeClusters,
  useMergeContacts,
} from "../../src/api/dedupe";
import { useMergeSuggestion } from "../../src/api/suggestions";

const reactions: string[] = [];
const listen = (e: Event) => reactions.push((e as CustomEvent).detail.reaction);

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider
    client={
      new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    }
  >
    {children}
  </QueryClientProvider>
);

const answer = (status: number, body: unknown = { id: "c1", success: true }) =>
  vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );

beforeEach(() => {
  reactions.length = 0;
  resetCorvidActivity();
  window.addEventListener(CORVID_REACT_EVENT, listen);
  vi.stubGlobal("fetch", answer(200));
});

afterEach(() => {
  window.removeEventListener(CORVID_REACT_EVENT, listen);
  vi.unstubAllGlobals();
});

async function run<T>(
  hook: () => { mutateAsync: (input: T) => Promise<unknown> },
  input: T,
) {
  const { result } = renderHook(hook, { wrapper });
  await act(async () => {
    await result.current.mutateAsync(input).catch(() => {});
  });
}

describe("the moments the corvid answers", () => {
  it("nods when a follow-up is done", async () => {
    await run(useCompleteActionItem, "a1");
    expect(reactions).toEqual(["nod"]);
  });

  it("caws, silently, when a conversation is written down", async () => {
    await run(useAddInteraction, {
      contactId: "c1",
      data: { type: "note", content: "Lunch" },
    });
    expect(reactions).toEqual(["caw"]);
  });

  it("hops for somebody new", async () => {
    await run(useCreateContact, { name: "Ada Lovelace" });
    expect(reactions).toEqual(["hop"]);
  });

  it("cocks its head at a person when they are tracked, and not when untracked", async () => {
    vi.stubGlobal("fetch", answer(200, { id: "c1", isTracked: true }));
    await run(useSetTracked, { id: "c1", isTracked: true });
    expect(reactions).toEqual(["cock"]);
    reactions.length = 0;
    resetCorvidActivity();
    await run(useSetTracked, { id: "c1", isTracked: false });
    expect(reactions).toEqual([]);
  });

  it("nods when a contact comes back from the trash", async () => {
    await run(useRestoreContact, "c1");
    expect(reactions).toEqual(["nod"]);
  });

  it("preens after every kind of merge", async () => {
    const merges: [
      () => { mutateAsync: (input: never) => Promise<unknown> },
      unknown,
    ][] = [
      [useMergeContacts as never, { primaryId: "a", duplicateId: "b" }],
      [useMergeBatch as never, [{ primaryId: "a", duplicateId: "b" }]],
      [useMergeCluster as never, { primaryId: "a", duplicateIds: ["b"] }],
      [useMergeClusters as never, [{ primaryId: "a", duplicateIds: ["b"] }]],
      [useMergeSuggestion as never, { suggestionId: "s", primaryId: "a" }],
    ];
    for (const [hook, input] of merges) {
      reactions.length = 0;
      resetCorvidActivity();
      await run(hook, input as never);
      expect(reactions).toEqual(["preen"]);
    }
  });

  it("does nothing when the work failed", async () => {
    vi.stubGlobal("fetch", answer(500, { error: { message: "no" } }));
    await run(useCompleteActionItem, "a1");
    await run(useCreateContact, { name: "Ada" });
    await run(useMergeCluster, { primaryId: "a", duplicateIds: ["b"] });
    expect(reactions).toEqual([]);
  });
});
