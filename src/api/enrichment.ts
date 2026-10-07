/** Hooks for one contact's AI enrichment and for grounding capacity. */
import { apiJson } from "./client";
import { refreshContact } from "./contactCache";
import { contactRoutes } from "../../shared/contracts/contacts";
import { useAuth } from "../components/auth/AuthGate";
import { rateLimitMessage } from "../lib/rateLimitMessage";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

const enrichmentKeys = {
  groundingCapacity: ["grounding-capacity"] as const,
};

/**
 * Grounding capacity, which enables the refresh buttons. Admins only: the
 * route is class `admin`, and the command palette mounts this on every
 * screen, so a member would poll a refusal every two minutes.
 */
export const useGroundingCapacity = () => {
  const { isAdmin } = useAuth();
  return useQuery({
    queryKey: enrichmentKeys.groundingCapacity,
    queryFn: ({ signal }) =>
      apiJson<{
        hasCapacity: boolean;
        provider: string | null;
        researchRuns24h: number;
      }>(`/ai/grounding-capacity`, { signal }),
    enabled: isAdmin,
    staleTime: 60_000, // Re-check every 60s
    refetchInterval: 120_000, // Background refresh every 2min
  });
};

/** Enriches one contact: grounding, then extraction, then merge. */
export const useEnrichContact = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (contactId: string) =>
      // A refusal throws `ApiError`, and `onError` words it from the code.
      apiJson(contactRoutes.enrich, `/contacts/${contactId}/enrich`),
    onSuccess: (data, contactId) => {
      void refreshContact(qc, contactId);
      // Invalidate grounding capacity (we just used one)
      qc.invalidateQueries({ queryKey: enrichmentKeys.groundingCapacity });

      toast.success(
        data.fieldsUpdated > 0
          ? `Refreshed — ${data.fieldsUpdated} field${data.fieldsUpdated !== 1 ? "s" : ""} updated`
          : "Data is already up to date",
      );
    },
    onError: (err: Error) => {
      // A rate limit names whose limit it was. Anything else keeps the
      // server's own words.
      toast.error(rateLimitMessage(err, "enrichment") ?? err.message);
    },
  });
};
