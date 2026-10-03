/**
 * AI Settings API Hooks — capability-based AI configuration.
 *
 * Backs the AI providers page: provider credentials, custom
 * OpenAI-compatible endpoints, per-capability model assignment, and model
 * discovery. Also the instance switch: whether an admin turned AI off for
 * every account.
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

interface ProviderStatus {
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
  /**
   * Google answered this Gemini key with a free-tier quota error. On the
   * free tier Google may use prompts and responses to improve its products.
   */
  freeTier?: boolean;
}

interface CustomEndpoint {
  id: string;
  label: string;
  baseUrl: string;
  keyPreview?: string;
}

/** The instance switch, as `GET /ai/instance` and the settings view give it. */
export interface InstanceAi {
  /** True when no AI provider call may leave this instance. */
  aiOff: boolean;
  /** True when AI_DISABLED on the server holds it off. */
  lockedByEnv: boolean;
}

export interface AISettings {
  providers: ProviderStatus[];
  availableProviders: { id: string; label: string }[];
  customEndpoints: CustomEndpoint[];
  capabilities: Record<
    string,
    {
      assignment: CapabilityAssignment;
      resolved: {
        providerId: string;
        /** Display name of the provider serving this capability. */
        providerLabel: string;
        /**
         * The concrete model that will run — populated in Auto mode too, so
         * the UI can name it instead of saying "chosen automatically".
         * Undefined only when the provider cannot say in advance.
         */
        model?: string;
        /** Set when the target has no provider entry (the built-in model). */
        label?: string;
      } | null;
      /** Why `resolved` is null, phrased for the user. */
      unavailableReason?: string;
    }
  >;
  searxngUrl?: string;
  /** A SearXNG address is set, in the settings or by SEARXNG_URL. */
  searxng?: boolean;
  instance: InstanceAi;
}

interface ModelOption {
  id: string;
  label: string;
  /** "chat" | "embeddings" | "grounding" — see server/ai/provider.ts */
  capabilities: string[];
  capabilityConfidence: "declared" | "guessed";
  contextWindow?: number;
}

interface ModelGroup {
  providerId: string;
  providerLabel: string;
  models: ModelOption[];
}

const KEY = ["ai-settings"] as const;
const INSTANCE_KEY = ["ai-instance"] as const;

export const useAISettings = () =>
  useQuery({
    queryKey: KEY,
    queryFn: async ({ signal }): Promise<AISettings> => {
      const res = await apiFetch("/settings/ai", { signal });
      return res.json();
    },
    staleTime: 30_000,
  });

/**
 * Whether an admin turned AI off for the instance. Any signed-in account may
 * read it: the Privacy page says why the account's own switch cannot turn AI
 * on.
 */
export const useInstanceAi = () =>
  useQuery({
    queryKey: INSTANCE_KEY,
    queryFn: async ({ signal }): Promise<InstanceAi> => {
      const res = await apiFetch("/ai/instance", { signal });
      return res.json();
    },
    staleTime: 30_000,
  });

/** Turn AI off (`aiOff: true`) or back on for every account. Admin only. */
export const useSetInstanceAi = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      aiOff: boolean,
    ): Promise<{ success: true; instance: InstanceAi }> => {
      const res = await apiFetch("/settings/ai/instance", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiOff }),
      });
      return res.json();
    },
    // What every capability resolves to changes with the switch, so the
    // whole view is read again, not only the switch.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: INSTANCE_KEY });
    },
  });
};

/** Capability-eligible models grouped by provider (populated by discovery). */
export const useCapabilityModels = (capability: AICapability) =>
  useQuery({
    queryKey: ["ai-settings", "models", capability],
    queryFn: async ({ signal }): Promise<ModelGroup[]> => {
      const res = await apiFetch(`/settings/ai/models/${capability}`, {
        signal,
      });
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
    // Settled, not success: the server stores the credential and *then*
    // validates it, so a discovery failure still changed the view. Refreshing
    // only on success left the newly-connected provider invisible until reload.
    onSettled: () => {
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
    // The endpoint is saved before its connectivity is checked, so a failed
    // check still added a row. See useSetProviderKey.
    onSettled: () => qc.invalidateQueries({ queryKey: ["ai-settings"] }),
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
