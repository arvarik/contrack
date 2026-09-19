/**
 * Connector Management API Hooks — React Query hooks for sync connectors.
 *
 * Provides hooks to list supported kinds, list configured connectors, create/test/update/delete
 * connectors, trigger manual sync runs, and inspect run histories.
 *
 * @module api/connectors
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiJson, jsonBody } from "./client";
import { invalidateContactViews } from "./contactCache";
import type {
  ConnectorDetail,
  ConnectorKind,
  ConnectorRun,
  ConnectorSummary,
  Correspondent,
  KindInfo,
} from "../../shared/connectors";

export const connectorKeys = {
  all: ["connectors"] as const,
  kinds: ["connectors", "kinds"] as const,
  lists: () => ["connectors", "list"] as const,
  detail: (id: string) => ["connectors", "detail", id] as const,
  runs: (id: string) => ["connectors", "runs", id] as const,
  correspondents: (limit?: number) =>
    ["connectors", "correspondents", limit] as const,
};

export function useConnectorKinds() {
  return useQuery({
    queryKey: connectorKeys.kinds,
    queryFn: ({ signal }) =>
      apiJson<{ kinds: KindInfo[] }>("/connectors/kinds", { signal }).then(
        (data) => data.kinds,
      ),
    staleTime: 5 * 60 * 1000,
  });
}

export function useConnectors() {
  return useQuery({
    queryKey: connectorKeys.lists(),
    queryFn: ({ signal }) =>
      apiJson<{ connectors: ConnectorSummary[] }>("/connectors", {
        signal,
      }).then((data) => data.connectors),
    refetchInterval: 30 * 1000,
  });
}

export function useConnector(id: string | null | undefined) {
  return useQuery({
    queryKey: id ? connectorKeys.detail(id) : ["connectors", "detail", "noop"],
    queryFn: ({ signal }) =>
      apiJson<ConnectorDetail>(`/connectors/${encodeURIComponent(id!)}`, {
        signal,
      }),
    enabled: Boolean(id),
  });
}

export function useCreateConnector() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      kind: ConnectorKind;
      name: string;
      config: Record<string, unknown>;
      secret?: unknown;
      intervalMinutes?: number;
    }) =>
      apiJson<ConnectorDetail>("/connectors", {
        method: "POST",
        ...jsonBody(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: connectorKeys.all });
    },
  });
}

export function useTestConnector() {
  return useMutation({
    mutationFn: (data: {
      kind: ConnectorKind;
      config: Record<string, unknown>;
      secret?: unknown;
    }) =>
      apiJson<{ ok: true; detail: string }>("/connectors/test", {
        method: "POST",
        ...jsonBody(data),
      }),
  });
}

export function useUpdateConnector() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...patch
    }: {
      id: string;
      name?: string;
      config?: Record<string, unknown>;
      secret?: unknown;
      intervalMinutes?: number;
      status?: "active" | "paused";
    }) =>
      apiJson<ConnectorDetail>(`/connectors/${encodeURIComponent(id)}`, {
        method: "PATCH",
        ...jsonBody(patch),
      }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: connectorKeys.all });
      void queryClient.invalidateQueries({
        queryKey: connectorKeys.detail(variables.id),
      });
    },
  });
}

export function useDeleteConnector() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      deleteImported,
    }: {
      id: string;
      deleteImported?: boolean;
    }) => {
      const res = await apiFetch(`/connectors/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deleteImported: Boolean(deleteImported) }),
      });
      if (!res.ok && res.status !== 204) {
        throw new Error("Failed to delete connector");
      }
      return { id, deleteImported };
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: connectorKeys.all });
      if (variables.deleteImported) {
        invalidateContactViews(queryClient);
      }
    },
  });
}

export function useSyncConnector() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiJson<{ runId: string }>(`/connectors/${encodeURIComponent(id)}/sync`, {
        method: "POST",
      }),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: connectorKeys.all });
      void queryClient.invalidateQueries({
        queryKey: connectorKeys.detail(id),
      });
      void queryClient.invalidateQueries({ queryKey: connectorKeys.runs(id) });
      invalidateContactViews(queryClient);
    },
  });
}

export function useConnectorRuns(id: string | null | undefined, limit = 20) {
  return useQuery({
    queryKey: id
      ? [...connectorKeys.runs(id), limit]
      : ["connectors", "runs", "noop"],
    queryFn: ({ signal }) =>
      apiJson<{ runs: ConnectorRun[] }>(
        `/connectors/${encodeURIComponent(id!)}/runs?limit=${encodeURIComponent(limit)}`,
        { signal },
      ).then((data) => data.runs),
    enabled: Boolean(id),
    refetchInterval: 10 * 1000,
  });
}

export function useCorrespondents(limit = 200) {
  return useQuery({
    queryKey: connectorKeys.correspondents(limit),
    queryFn: ({ signal }) =>
      apiJson<{ correspondents: Correspondent[] }>(
        `/connectors/correspondents?limit=${encodeURIComponent(limit)}`,
        { signal },
      ).then((data) => data.correspondents),
    staleTime: 60 * 1000,
  });
}
