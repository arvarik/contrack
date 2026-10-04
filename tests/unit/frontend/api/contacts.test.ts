// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useContact,
  useContactNames,
  useMapContacts,
  useSlimContactsForSearch,
  useUpdateContact,
  useDeleteContact,
} from "../../../../src/api/contacts";
import { writeContactInOrder } from "../../../../src/api/contactCache";

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

  it("puts a saved contact in its row without reloading every contact", async () => {
    const { wrapper, client } = setup();
    const fetch = vi.fn(async (url: string) =>
      url.includes("view=slim")
        ? Response.json([
            { id: "a", name: "Alice" },
            { id: "b", name: "Bob" },
          ])
        : Response.json({ id: "a", name: "Alicia" }),
    );
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(
      () => ({ list: useContactNames(), save: useUpdateContact() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.data).toHaveLength(2));
    await act(async () => {
      await result.current.save.mutateAsync({
        id: "a",
        data: { name: "Alicia" },
      });
    });
    await waitFor(() =>
      expect(result.current.list.data?.map((c) => c.name)).toEqual([
        "Alicia",
        "Bob",
      ]),
    );
    expect(client.getQueryData(["contacts", "a"])).toEqual({
      id: "a",
      name: "Alicia",
    });
    const reads = fetch.mock.calls.filter(([url]) => url.includes("view=slim"));
    expect(reads).toHaveLength(1);
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

/**
 * A slim contact whose name counts its reads. Every projection reads each
 * contact's name once, so the count is how many times it walked the list.
 */
function countedContacts(count: number) {
  const reads = { name: 0 };
  const contacts = Array.from({ length: count }, (_, i) => {
    const contact: Record<string, unknown> = {
      id: `c${i}`,
      isGhost: false,
      isArchived: false,
      isTracked: false,
      lat: 51.5,
      lng: -0.12,
      tags: [],
      lists: [],
    };
    Object.defineProperty(contact, "name", {
      enumerable: true,
      get: () => {
        reads.name += 1;
        return `Person ${i}`;
      },
    });
    return contact;
  });
  return { contacts, reads };
}

// The three projections share the full contact list. An inline `select` is
// a new function on each render, so TanStack Query ran it again on every
// render of the map, the palette and the note dialog, and each run walked
// all 5,800 people.
describe("contact list projections", () => {
  it.each([
    ["useContactNames", useContactNames],
    ["useSlimContactsForSearch", useSlimContactsForSearch],
    ["useMapContacts", useMapContacts],
  ] as const)("%s walks the list once, not on every render", (_name, hook) => {
    const { client, wrapper } = setup();
    const { contacts, reads } = countedContacts(20);
    client.setQueryData(["contacts"], contacts);
    const { result, rerender } = renderHook(() => hook(), { wrapper });
    expect(result.current.data).toHaveLength(20);
    const afterFirst = reads.name;
    rerender();
    rerender();
    expect(reads.name).toBe(afterFirst);
  });
});
