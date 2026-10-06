import { apiJson, jsonBody } from "./client";
import { invalidateContactViews, refreshContact } from "./contactCache";
import { corvidReact } from "../lib/corvid";
import { actionItemRoutes } from "../../shared/contracts/actionItems";
import type { BodyOf } from "../../shared/contracts/route";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { type ActionItem } from "../types";

export const useCompletedActionItems = () => {
  return useQuery({
    queryKey: ["actionItems", "completed"],
    queryFn: ({ signal }): Promise<ActionItem[]> =>
      apiJson(actionItemRoutes.completed, `/action-items/completed`, {
        signal,
      }),
  });
};

export const useUrgentActionItemCount = () => {
  return useQuery({
    queryKey: ["actionItems", "urgentCount"],
    queryFn: ({ signal }) =>
      apiJson(actionItemRoutes.count, `/action-items/count`, { signal }),
    // We poll this occasionally or rely on invalidation from mutations
    staleTime: 1000 * 60 * 5, // 5 mins
  });
};

/** One follow-up for each contact, in one request that saves all or none. */
export const useBulkCreateActionItems = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: BodyOf<typeof actionItemRoutes.bulkCreate>) =>
      apiJson(
        actionItemRoutes.bulkCreate,
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
      apiJson(actionItemRoutes.update, `/action-items/${id}`, jsonBody(data)),
    // A trigger keeps the contact's next follow-up date in step.
    onSuccess: (item) => void refreshContact(queryClient, item.contactId),
  });
};

export const useCompleteActionItem = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string): Promise<ActionItem> =>
      apiJson(actionItemRoutes.complete, `/action-items/${id}/complete`),
    onSuccess: (item) => {
      // Done: the corvid on its perch nods.
      corvidReact("nod");
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
      apiJson(
        actionItemRoutes.create,
        `/contacts/${contactId}/action-items`,
        jsonBody(body),
      ),
    onSuccess: (_item, { contactId }) =>
      void refreshContact(queryClient, contactId),
  });
};
