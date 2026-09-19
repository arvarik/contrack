// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  connectorKeys,
  useConnectorKinds,
  useConnectors,
  useConnector,
  useCreateConnector,
  useTestConnector,
  useUpdateConnector,
  useDeleteConnector,
  useSyncConnector,
  useConnectorRuns,
  useCorrespondents,
} from "../../src/api/connectors";
import { connectorViaLabel } from "../../shared/connectors";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return {
    queryClient,
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children),
  };
}

describe("shared/connectors.ts", () => {
  it("maps connector kinds to via-labels", () => {
    expect(connectorViaLabel(null)).toBeNull();
    expect(connectorViaLabel(undefined)).toBeNull();
    expect(connectorViaLabel("unknown_source")).toBeNull();
    expect(connectorViaLabel("ics")).toBe("via Calendar");
    expect(connectorViaLabel("imap")).toBe("via Email");
    expect(connectorViaLabel("google")).toBe("via Google");
    expect(connectorViaLabel("imessage")).toBe("via iMessage");
    expect(connectorViaLabel("whatsapp_export")).toBe("via WhatsApp");
  });
});

describe("src/api/connectors.ts query keys", () => {
  it("constructs expected query keys", () => {
    expect(connectorKeys.all).toEqual(["connectors"]);
    expect(connectorKeys.kinds).toEqual(["connectors", "kinds"]);
    expect(connectorKeys.lists()).toEqual(["connectors", "list"]);
    expect(connectorKeys.detail("conn-123")).toEqual([
      "connectors",
      "detail",
      "conn-123",
    ]);
    expect(connectorKeys.runs("conn-123")).toEqual([
      "connectors",
      "runs",
      "conn-123",
    ]);
    expect(connectorKeys.correspondents(50)).toEqual([
      "connectors",
      "correspondents",
      50,
    ]);
  });
});

describe("src/api/connectors.ts hooks", () => {
  it("useConnectorKinds fetches kind list", async () => {
    const mockKinds = [
      {
        kind: "ics",
        label: "Calendar",
        description: "Syncs ics",
        available: true,
        capabilities: { schedule: true },
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ kinds: mockKinds })),
    );

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useConnectorKinds(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockKinds);
  });

  it("useConnectors fetches connectors list", async () => {
    const mockConnectors = [
      {
        id: "c-1",
        kind: "ics",
        name: "My Cal",
        status: "active",
        config: {},
        secretPresent: false,
        intervalMinutes: 30,
        nextRunAt: null,
        lastRunAt: null,
        lastError: null,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ connectors: mockConnectors })),
    );

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useConnectors(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockConnectors);
  });

  it("useConnector fetches single connector when id provided, disables when null", async () => {
    const mockDetail = {
      id: "c-1",
      kind: "ics",
      name: "My Cal",
      status: "active",
      config: {},
      secretPresent: false,
      intervalMinutes: 30,
      nextRunAt: null,
      lastRunAt: null,
      lastError: null,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
      recentRuns: [],
    };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(mockDetail));
    vi.stubGlobal("fetch", fetchMock);

    const { wrapper } = createWrapper();
    const { result: enabledResult } = renderHook(() => useConnector("c-1"), {
      wrapper,
    });

    await waitFor(() => expect(enabledResult.current.isSuccess).toBe(true));
    expect(enabledResult.current.data).toEqual(mockDetail);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/connectors/c-1"),
      expect.anything(),
    );

    const { result: disabledResult } = renderHook(() => useConnector(null), {
      wrapper,
    });
    expect(disabledResult.current.fetchStatus).toBe("idle");
  });

  it("useCreateConnector posts new connector and invalidates cache", async () => {
    const created = { id: "c-2", name: "New Cal" };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(created));
    vi.stubGlobal("fetch", fetchMock);

    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateConnector(), { wrapper });
    await result.current.mutateAsync({
      kind: "ics",
      name: "New Cal",
      config: { url: "https://example.com/feed.ics" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/connectors"),
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: connectorKeys.all,
    });
  });

  it("useTestConnector posts test payload without cache invalidation", async () => {
    const testResult = { ok: true, detail: "Feed parsed 5 events" };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(testResult));
    vi.stubGlobal("fetch", fetchMock);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useTestConnector(), { wrapper });

    const res = await result.current.mutateAsync({
      kind: "ics",
      config: { url: "https://example.com/test.ics" },
    });

    expect(res).toEqual(testResult);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/connectors/test"),
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("useUpdateConnector patches connector and invalidates list + detail", async () => {
    const updated = { id: "c-1", name: "Updated Cal" };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(updated));
    vi.stubGlobal("fetch", fetchMock);

    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpdateConnector(), { wrapper });
    await result.current.mutateAsync({
      id: "c-1",
      name: "Updated Cal",
      status: "paused",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/connectors/c-1"),
      expect.objectContaining({
        method: "PATCH",
      }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: connectorKeys.all,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: connectorKeys.detail("c-1"),
    });
  });

  it("useDeleteConnector deletes connector with or without deleteImported", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useDeleteConnector(), { wrapper });
    await result.current.mutateAsync({
      id: "c-1",
      deleteImported: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/connectors/c-1"),
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ deleteImported: true }),
      }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: connectorKeys.all,
    });

    // Test error case
    fetchMock.mockResolvedValueOnce(new Response("Failed", { status: 500 }));
    await expect(result.current.mutateAsync({ id: "c-1" })).rejects.toThrow();
  });

  it("useSyncConnector triggers manual sync and invalidates queries", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ runId: "r-99" }));
    vi.stubGlobal("fetch", fetchMock);

    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useSyncConnector(), { wrapper });
    const syncRes = await result.current.mutateAsync("c-1");

    expect(syncRes).toEqual({ runId: "r-99" });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/connectors/c-1/sync"),
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: connectorKeys.all,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: connectorKeys.detail("c-1"),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: connectorKeys.runs("c-1"),
    });
  });

  it("useConnectorRuns queries runs for connector", async () => {
    const mockRuns = [
      {
        id: "r-1",
        connectorId: "c-1",
        trigger: "manual",
        status: "ok",
        startedAt: "2026-01-01T00:00:00Z",
        finishedAt: "2026-01-01T00:01:00Z",
        stats: { meetings: 5 },
        error: null,
      },
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ runs: mockRuns }));
    vi.stubGlobal("fetch", fetchMock);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useConnectorRuns("c-1", 10), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockRuns);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/connectors/c-1/runs?limit=10"),
      expect.anything(),
    );

    const { result: disabledResult } = renderHook(
      () => useConnectorRuns(null),
      { wrapper },
    );
    expect(disabledResult.current.fetchStatus).toBe("idle");
  });

  it("useCorrespondents queries discovered contacts", async () => {
    const mockCorrespondents = [
      {
        connectorId: "c-1",
        externalId: "ext-1",
        email: "alice@example.com",
        seenCount: 3,
        lastSeenAt: "2026-01-01",
        ignoredAt: null,
        localId: null,
        kind: "ics",
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ correspondents: mockCorrespondents }),
        ),
    );

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCorrespondents(50), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockCorrespondents);
  });
});
