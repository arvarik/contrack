import { apiJson, jsonBody } from "./client";
import { invalidateContactViews, refreshContact } from "./contactCache";
import { zoneQuery } from "./dashboard";
import type { actionItemRoutes } from "../../shared/contracts/actionItems";
import type { BodyOf } from "../../shared/contracts/route";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorText } from "../lib/utils";
import { type ActionItem } from "../types";

export const useCompletedActionItems = () => {
  return useQuery({
    queryKey: ["actionItems", "completed"],
    queryFn: ({ signal }): Promise<ActionItem[]> =>
      apiJson<typeof actionItemRoutes.completed>(
        "GET",
        `/action-items/completed`,
        {
          signal,
        },
      ),
  });
};

export const useUrgentActionItemCount = () => {
  return useQuery({
    queryKey: ["actionItems", "urgentCount"],
    queryFn: ({ signal }) =>
      apiJson<typeof actionItemRoutes.count>(
        "GET",
        `/action-items/count${zoneQuery()}`,
        {
          signal,
        },
      ),
    // We poll this occasionally or rely on invalidation from mutations
    staleTime: 1000 * 60 * 5, // 5 mins
  });
};

/** One follow-up for each contact, in one request that saves all or none. */
export const useBulkCreateActionItems = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: BodyOf<typeof actionItemRoutes.bulkCreate>) =>
      apiJson<typeof actionItemRoutes.bulkCreate>(
        "POST",
        "/action-items/bulk",
        jsonBody(body),
      ),
    onSuccess: () => invalidateContactViews(queryClient),
  });
};

export const useUpdateActionItem = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: { title?: string; dueAt?: string };
    }): Promise<ActionItem> =>
      apiJson<typeof actionItemRoutes.update>(
        "PATCH",
        `/action-items/${id}`,
        jsonBody(data),
      ),
    // A trigger keeps the contact's next follow-up date in step.
    onSuccess: (item) => void refreshContact(queryClient, item.contactId),
    onError: (err: unknown) => {
      toast.error(`Could not update follow-up: ${errorText(err)}`);
    },
  });
};

export const useCompleteActionItem = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string): Promise<ActionItem> =>
      apiJson<typeof actionItemRoutes.complete>(
        "PATCH",
        `/action-items/${id}/complete`,
      ),
    onSuccess: (item) => {
      void refreshContact(queryClient, item.contactId);
      // The note it came with shows it on the timeline.
      void queryClient.invalidateQueries({
        queryKey: ["timeline", item.contactId],
      });
    },
  });
};

/**
 * A follow-up on its own, with no note. The composer sends one when only its
 * follow-up line is filled: a reminder does not count as being in touch.
 */
export const useCreateActionItem = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      contactId,
      ...body
    }: { contactId: string } & BodyOf<
      typeof actionItemRoutes.create
    >): Promise<ActionItem> =>
      apiJson<typeof actionItemRoutes.create>(
        "POST",
        `/contacts/${contactId}/action-items`,
        jsonBody(body),
      ),
    onSuccess: (_item, { contactId }) =>
      void refreshContact(queryClient, contactId),
  });
};

/** One contact's follow-ups, pending first and soonest first. */
export const useContactActionItems = (contactId: string) =>
  useQuery({
    queryKey: ["actionItems", "contact", contactId],
    queryFn: ({ signal }): Promise<ActionItem[]> =>
      apiJson<typeof actionItemRoutes.forContact>(
        "GET",
        `/contacts/${contactId}/action-items`,
        { signal },
      ),
  });
