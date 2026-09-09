// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { readNdjson } from "../../src/api/ndjson";
import { useSemanticSearch } from "../../src/api/search";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function stream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    response: new Response(body),
    push: (text: string) => controller.enqueue(new TextEncoder().encode(text)),
    end: () => controller.close(),
  };
}
const result = (name: string, phase = "complete") =>
  JSON.stringify({ phase, matches: [{ id: name, name }], fallback: false });
describe("search streaming", () => {
  it("reads split UTF-8 and a terminal line without a newline", async () => {
    const bytes = new TextEncoder().encode('{"text":"José"}');
    const seen: unknown[] = [];
    const response = new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(bytes.slice(0, 12));
          c.enqueue(bytes.slice(12));
          c.close();
        },
      }),
    );
    await readNdjson(response, (value) => seen.push(value));
    expect(seen).toEqual([{ text: "José" }]);
  });
  it("reports a truncated stream and settles the loading phase", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(result("Alice", "instant") + "\n")),
    );
    const { result: hook } = renderHook(() => useSemanticSearch());
    await act(async () => {
      await hook.current.mutate("Alice");
    });
    expect(hook.current.isError).toBe(true);
    expect(hook.current.isPending).toBe(false);
    expect(hook.current.phase).toBe("done");
  });
  it("reports malformed chunks instead of silently dropping them", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response('{"phase":"complete","matches":"broken"}'),
        ),
    );
    const { result: hook } = renderHook(() => useSemanticSearch());
    await act(async () => {
      await hook.current.mutate("Alice");
    });
    expect(hook.current.isError).toBe(true);
    expect(hook.current.isSuccess).toBe(false);
  });
  it("ignores late responses from a replaced search", async () => {
    const first = stream();
    const second = stream();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(first.response)
        .mockResolvedValueOnce(second.response),
    );
    const { result: hook } = renderHook(() => useSemanticSearch());
    let one!: Promise<void>;
    let two!: Promise<void>;
    act(() => {
      one = hook.current.mutate("Old");
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    act(() => {
      two = hook.current.mutate("New");
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await act(async () => {
      second.push(result("New"));
      second.end();
      await two;
      await one;
    });
    expect(hook.current.data?.matches[0].name).toBe("New");
    expect(hook.current.isSuccess).toBe(true);
  });
  it("cancels the reader when the component unmounts", async () => {
    const pending = stream();
    let signal!: AbortSignal;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url, options) => {
        signal = options.signal;
        return Promise.resolve(pending.response);
      }),
    );
    const { result: hook, unmount } = renderHook(() => useSemanticSearch());
    let work!: Promise<void>;
    act(() => {
      work = hook.current.mutate("Pending");
    });
    await waitFor(() => expect(signal).toBeTruthy());
    unmount();
    await work;
    expect(signal.aborted).toBe(true);
  });
});
