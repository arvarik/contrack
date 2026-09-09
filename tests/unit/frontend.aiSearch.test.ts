// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import {
  useAISearchStream,
  useAISearchStatusPoll,
} from "../../src/api/aiSearch";
import { ApiError } from "../../src/api/client";

let source: {
  onmessage?: (event: { data: string }) => void;
  onerror?: () => void;
  close: ReturnType<typeof vi.fn>;
};
const batch = {
  id: "one",
  strategy: "two-pass",
  createdAt: "2026-09-09",
  status: "processing",
  totalTokens: 0,
  jobs: [
    {
      id: "job",
      contactId: "contact",
      contactName: "Test",
      status: "searching",
      fieldsUpdated: 0,
    },
  ],
};
function setup() {
  vi.stubGlobal(
    "EventSource",
    class {
      constructor() {
        source = { close: vi.fn() };
        return source;
      }
    },
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return { client, wrapper };
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("research progress recovery", () => {
  it("continues polling after an initial connection failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useAISearchStatusPoll("one"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    const query = client
      .getQueryCache()
      .find({ queryKey: ["ai-search-status", "one"] })!;
    const interval = (
      query.options as { refetchInterval: (q: typeof query) => unknown }
    ).refetchInterval;
    expect(interval(query)).toBe(5000);
  });
  it("stops polling for a missing batch", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: { message: "Batch missing" } }),
            { status: 404 },
          ),
        ),
    );
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useAISearchStatusPoll("one"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.error).toBeInstanceOf(ApiError));
    const query = client
      .getQueryCache()
      .find({ queryKey: ["ai-search-status", "one"] })!;
    const interval = (
      query.options as { refetchInterval: (q: typeof query) => unknown }
    ).refetchInterval;
    expect(interval(query)).toBe(false);
  });
  it("ignores events for a different batch and closes the stream on unmount", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(batch))),
    );
    const { client, wrapper } = setup();
    const update = vi.fn();
    const hook = renderHook(() => useAISearchStream("one", update), {
      wrapper,
    });
    await waitFor(() => expect(update).toHaveBeenCalled());
    await act(async () =>
      source.onmessage?.({ data: JSON.stringify({ ...batch, id: "other" }) }),
    );
    expect(client.getQueryData(["ai-search-status", "one"])).toMatchObject({
      id: "one",
    });
    expect(source.close).toHaveBeenCalled();
    hook.unmount();
    expect(source.close).toHaveBeenCalledTimes(2);
  });
  it("invalidates contact views once when a job succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(batch))),
    );
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    renderHook(() => useAISearchStream("one", vi.fn()), { wrapper });
    await waitFor(() =>
      expect(client.getQueryData(["ai-search-status", "one"])).toBeDefined(),
    );
    const done = {
      ...batch,
      status: "complete",
      jobs: [{ ...batch.jobs[0], status: "success", fieldsUpdated: 2 }],
    };
    await act(async () => source.onmessage?.({ data: JSON.stringify(done) }));
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    const calls = invalidate.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    await act(async () => source.onmessage?.({ data: JSON.stringify(done) }));
    expect(invalidate.mock.calls).toHaveLength(calls);
  });
});
