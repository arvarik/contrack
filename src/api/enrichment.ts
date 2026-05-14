/**
 * Enrichment API Hooks — React Query hooks for single-contact AI enrichment
 * and grounding capacity checks.
 *
 * - `useGroundingCapacity()` — checks if AI grounding quota is available
 * - `useEnrichContact()`     — triggers single-contact TwoPassStrategy enrichment
 *
 * @module api/enrichment
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

const API = "/api";

// =============================================================================
// Query Keys
// =============================================================================

export const enrichmentKeys = {
  groundingCapacity: ["grounding-capacity"] as const,
};

// =============================================================================
// Queries
// =============================================================================

/** Check grounding RPD capacity — used to enable/disable refresh buttons. */
export const useGroundingCapacity = () =>
  useQuery({
    queryKey: enrichmentKeys.groundingCapacity,
    queryFn: async () => {
      const res = await fetch(`${API}/ai/grounding-capacity`);
      if (!res.ok) return { hasCapacity: false, remaining: 0, limit: 0 };
      return res.json() as Promise<{
        hasCapacity: boolean;
        remaining: number;
        limit: number;
      }>;
    },
    staleTime: 60_000, // Re-check every 60s
    refetchInterval: 120_000, // Background refresh every 2min
  });

// =============================================================================
// Mutations
// =============================================================================

interface EnrichResult {
  success: boolean;
  fieldsUpdated: number;
  latencyMs: number;
  models: string[];
  tokenCount: number;
}

/**
 * Single-contact enrichment mutation.
 * Fires TwoPassStrategy (grounding → extraction → merge) for one contact.
 */
export const useEnrichContact = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (contactId: string): Promise<EnrichResult> => {
      const res = await fetch(`${API}/contacts/${contactId}/enrich`, {
        method: "POST",
      });
      if (res.status === 429) {
        throw new Error("Grounding quota exhausted for today");
      }
      if (res.status === 503) {
        throw new Error("AI provider is not configured");
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Enrichment failed");
      }
      return res.json();
    },
    onSuccess: (data, contactId) => {
      // Invalidate contact data so the UI refreshes with new fields
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["contact", contactId] });
      // Invalidate grounding capacity (we just used one)
      qc.invalidateQueries({ queryKey: enrichmentKeys.groundingCapacity });
      // Invalidate zero-state (stale data count may have changed)
      qc.invalidateQueries({ queryKey: ["zero-state"] });

      toast.success(
        data.fieldsUpdated > 0
          ? `Refreshed — ${data.fieldsUpdated} field${data.fieldsUpdated !== 1 ? "s" : ""} updated`
          : "Data is already up to date",
      );
    },
    onError: (err: Error) => {
      toast.error(err instanceof Error ? err.message : String(err));
    },
  });
};
