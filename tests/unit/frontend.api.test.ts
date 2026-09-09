// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ApiError,
  apiFetch,
  retryApiQuery,
  NetworkError,
} from "../../src/api/client";
import {
  useContact,
  useUpdateContact,
  useDeleteContact,
} from "../../src/api/contacts";
import { writeContactInOrder } from "../../src/api/contactCache";
import { AUTH_EXPIRED_EVENT } from "../../src/lib/appEvents";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return { client, wrapper };
}

describe("shared API transport", () => {
  it("preserves the server error details and announces expired authentication", async () => {
    const expired = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, expired);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              message: "Sign in again",
              code: "UNAUTHORIZED",
              requestId: "abc",
            },
          }),
          { status: 401 },
        ),
      ),
    );
    await expect(apiFetch("/contacts")).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHORIZED",
      requestId: "abc",
      message: "Sign in again",
    });
    expect(expired).toHaveBeenCalledOnce();
    window.removeEventListener(AUTH_EXPIRED_EVENT, expired);
  });

  it("does not classify cancellation as a connection failure", async () => {
    const controller = new AbortController();
    controller.abort();
    const reason = new Error("cancelled");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(reason));
    await expect(
      apiFetch("/contacts", { signal: controller.signal }),
    ).rejects.toBe(reason);
  });

  it("retries only transient read failures", () => {
    expect(retryApiQuery(0, new NetworkError())).toBe(true);
    expect(retryApiQuery(0, new ApiError("busy", 503))).toBe(true);
    for (const status of [400, 401, 403, 404, 409, 429])
      expect(retryApiQuery(0, new ApiError("rejected", status))).toBe(false);
    expect(retryApiQuery(1, new NetworkError())).toBe(false);
    expect(retryApiQuery(0, new Error("bug"))).toBe(false);
  });
});

describe("contact query identity and saves", () => {
  it("never displays the previous contact while a new contact loads", async () => {
    const { wrapper } = setup();
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ id: "a", name: "Alice" }))
        .mockImplementationOnce(
          () =>
            new Promise((r) => {
              finish = r;
            }),
        ),
    );
    const { result, rerender } = renderHook(({ id }) => useContact(id), {
      initialProps: { id: "a" },
      wrapper,
    });
    await waitFor(() => expect(result.current.data?.id).toBe("a"));
    rerender({ id: "b" });
    expect(result.current.data).toBeUndefined();
    await act(async () => finish(Response.json({ id: "b", name: "Bob" })));
    await waitFor(() => expect(result.current.data?.id).toBe("b"));
  });

  it("aborts an unused contact query", async () => {
    const { wrapper } = setup();
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_path, init) => {
        signal = init.signal;
        return new Promise((_resolve, reject) =>
          signal?.addEventListener("abort", () => reject(signal?.reason)),
        );
      }),
    );
    const { unmount } = renderHook(() => useContact("pending"), { wrapper });
    await waitFor(() => expect(signal).toBeDefined());
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("retains saved data when an edit fails and refreshes dependent views", async () => {
    const { wrapper, client } = setup();
    client.setQueryData(["contacts"], [{ id: "a", name: "Alice" }]);
    client.setQueryData(["contacts", "a"], { id: "a", name: "Alice" });
    for (const key of ["lists", "dashboard", "zeroState", "actionItems"])
      client.setQueryData([key], {});
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: { message: "Save rejected" } }),
            { status: 400 },
          ),
        ),
    );
    const { result } = renderHook(() => useUpdateContact(), { wrapper });
    await act(async () => {
      await result.current
        .mutateAsync({ id: "a", data: { name: "Changed" } })
        .catch(() => undefined);
    });
    expect(client.getQueryData(["contacts", "a"])).toEqual({
      id: "a",
      name: "Alice",
    });
    expect(client.getQueryData(["contacts"])).toEqual([
      { id: "a", name: "Alice" },
    ]);
    for (const key of ["lists", "dashboard", "zeroState", "actionItems"])
      expect(client.getQueryState([key])?.isInvalidated).toBe(true);
  });

  it("serializes edits for one contact and continues after a failed edit", async () => {
    let reject!: (error: Error) => void;
    const first = writeContactInOrder(
      "a",
      () =>
        new Promise((_r, j) => {
          reject = j;
        }),
    );
    const firstError = first.catch(() => undefined);
    const secondWrite = vi.fn().mockResolvedValue("second");
    const second = writeContactInOrder("a", secondWrite);
    await expect(
      writeContactInOrder("b", async () => "independent"),
    ).resolves.toBe("independent");
    expect(secondWrite).not.toHaveBeenCalled();
    reject(new Error("first failed"));
    await firstError;
    await expect(second).resolves.toBe("second");
    expect(secondWrite).toHaveBeenCalledOnce();
  });

  it("does not roll back another contact's successful edit when deletion fails", async () => {
    const { wrapper, client } = setup();
    client.setQueryData(
      ["contacts"],
      [
        { id: "a", name: "Alice" },
        { id: "b", name: "Bob" },
      ],
    );
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        () =>
          new Promise((r) => {
            finish = r;
          }),
      ),
    );
    const { result } = renderHook(() => useDeleteContact(), { wrapper });
    let removal!: Promise<unknown>;
    await act(async () => {
      removal = result.current.mutateAsync("a").catch(() => undefined);
    });
    client.setQueryData(
      ["contacts"],
      [
        { id: "a", name: "Alice" },
        { id: "b", name: "Updated Bob" },
      ],
    );
    await act(async () => {
      finish(new Response("{}", { status: 500 }));
      await removal;
    });
    expect(client.getQueryData(["contacts"])).toEqual([
      { id: "a", name: "Alice" },
      { id: "b", name: "Updated Bob" },
    ]);
  });
});
