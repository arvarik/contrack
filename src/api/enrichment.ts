import { apiJson } from "./client";
import { useAuth } from "../components/auth/AuthGate";
import { rateLimitMessage } from "../lib/rateLimitMessage";
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

// =============================================================================
// Query Keys
// =============================================================================

export const enrichmentKeys = {
  groundingCapacity: ["grounding-capacity"] as const,
};

// =============================================================================
// Queries
// =============================================================================

/**
 * Check grounding RPD capacity — used to enable/disable refresh buttons.
 *
 * Admins only, and not because the number is a secret. The route is class
 * `admin` and has been since Phase 3, while this query is mounted by the
 * command palette on every screen and refetches every two minutes. For a
 * member that is a request per two minutes that can only be refused, for the
 * life of the tab. `enabled` is the honest fix: do not ask a question the
 * answer to which is always no.
 *
 * The `!res.ok` branch that used to sit here could not run either — the
 * shared client throws for any non-2xx — so a member's refusal was already
 * failing the query rather than returning the zeroed shape it pretended to.
 */
export const useGroundingCapacity = () => {
  const { isAdmin } = useAuth();
  return useQuery({
    queryKey: enrichmentKeys.groundingCapacity,
    queryFn: ({ signal }) =>
      apiJson<{ hasCapacity: boolean; remaining: number; limit: number }>(
        `/ai/grounding-capacity`,
        { signal },
      ),
    enabled: isAdmin,
    staleTime: 60_000, // Re-check every 60s
    refetchInterval: 120_000, // Background refresh every 2min
  });
};

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
    mutationFn: (contactId: string): Promise<EnrichResult> =>
      // Three branches used to sit here reading `res.status` for 429, 503 and
      // "not ok". None of them could run: `apiFetch` throws `ApiError` for
      // every non-2xx, so the response this function sees is always a 2xx.
      // The 429 branch in particular claimed every refusal was the daily
      // grounding quota, which since Phase 3 is usually the per-account AI
      // limiter instead. The message is now decided in `onError`, from the
      // code the server actually sent.
      apiJson<EnrichResult>(`/contacts/${contactId}/enrich`, {
        method: "POST",
      }),
    onSuccess: (data, contactId) => {
      // Invalidate contact data so the UI refreshes with new fields
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["contacts", contactId] });
      // Invalidate grounding capacity (we just used one)
      qc.invalidateQueries({ queryKey: enrichmentKeys.groundingCapacity });
      // Invalidate zero-state (stale data count may have changed)
      qc.invalidateQueries({ queryKey: ["zeroState"] });

      toast.success(
        data.fieldsUpdated > 0
          ? `Refreshed — ${data.fieldsUpdated} field${data.fieldsUpdated !== 1 ? "s" : ""} updated`
          : "Data is already up to date",
      );
    },
    onError: (err: Error) => {
      // A rate limit gets the sentence that names whose limit it was. Anything
      // else keeps the server's own words, which are more specific than
      // anything this file could invent.
      toast.error(rateLimitMessage(err, "enrichment") ?? err.message);
    },
  });
};
