/**
 * AI Settings API Hooks — capability-based AI configuration.
 *
 * Backs Settings → AI: provider credentials, custom OpenAI-compatible
 * endpoints, per-capability model assignment, and model discovery.
 *
 * @module api/aiSettings
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

export type AICapability = "quick" | "deep" | "research" | "embeddings";

export interface CapabilityAssignment {
  mode: "auto" | "pinned" | "disabled";
  providerId?: string;
  model?: string;
}

export interface ProviderStatus {
  id: string;
  label: string;
  kind: string;
  source: "env" | "settings";
  keyPreview?: string;
  modelCount: number | null;
  modelsFetchedAt?: string;
  modelsError?: string;
  supportsDiscovery: boolean;
  supportsGrounding: boolean;
}

export interface CustomEndpoint {
  id: string;
  label: string;
  baseUrl: string;
  keyPreview?: string;
}

export interface AISettings {
  providers: ProviderStatus[];
  availableProviders: { id: string; label: string }[];
  customEndpoints: CustomEndpoint[];
  capabilities: Record<
    string,
    {
      assignment: CapabilityAssignment;
      resolved: { providerId: string; model?: string } | null;
    }
  >;
  searxngUrl?: string;
}

export interface ModelOption {
  id: string;
  label: string;
  capabilities: string[];
  capabilityConfidence: "declared" | "guessed";
  contextWindow?: number;
}

export interface ModelGroup {
  providerId: string;
  providerLabel: string;
  models: ModelOption[];
}

const KEY = ["ai-settings"] as const;

export const useAISettings = () =>
  useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<AISettings> => {
      const res = await apiFetch("/settings/ai");
      return res.json();
    },
    staleTime: 30_000,
  });

/** Capability-eligible models grouped by provider (populated by discovery). */
export const useCapabilityModels = (capability: AICapability) =>
  useQuery({
    queryKey: ["ai-settings", "models", capability],
    queryFn: async (): Promise<ModelGroup[]> => {
      const res = await apiFetch(`/settings/ai/models/${capability}`);
      const data = await res.json();
      return data.groups as ModelGroup[];
    },
    staleTime: 60_000,
  });

export const useSetProviderKey = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      providerId,
      apiKey,
    }: {
      providerId: string;
      apiKey: string;
    }): Promise<{ modelCount: number }> => {
      const res = await apiFetch(`/settings/ai/providers/${providerId}/key`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-settings"] });
    },
  });
};

export const useDeleteProviderKey = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (providerId: string) => {
      const res = await apiFetch(`/settings/ai/providers/${providerId}/key`, {
        method: "DELETE",
      });
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-settings"] }),
  });
};

export const useRefreshModels = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      providerId: string,
    ): Promise<{ modelCount: number; fetchedAt: string }> => {
      const res = await apiFetch(
        `/settings/ai/providers/${providerId}/refresh-models`,
        { method: "POST" },
      );
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-settings"] }),
  });
};

export const useSetCapability = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      capability,
      assignment,
    }: {
      capability: AICapability;
      assignment: CapabilityAssignment;
    }) => {
      const res = await apiFetch(`/settings/ai/capabilities/${capability}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assignment),
      });
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-settings"] }),
  });
};

export const useSaveEndpoint = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (endpoint: {
      id: string;
      label: string;
      baseUrl: string;
      apiKey?: string;
    }): Promise<{ modelCount: number }> => {
      const res = await apiFetch("/settings/ai/endpoints", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(endpoint),
      });
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-settings"] }),
  });
};

export const useDeleteEndpoint = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`/settings/ai/endpoints/${id}`, {
        method: "DELETE",
      });
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-settings"] }),
  });
};

export const useSetSearxng = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (url: string) => {
      const res = await apiFetch("/settings/ai/searxng", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-settings"] }),
  });
};
