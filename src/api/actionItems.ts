import { apiJson, jsonBody } from "./client";
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["actionItems"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["actionItems"] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"], exact: true });
      queryClient.invalidateQueries({
        queryKey: ["dashboard", "activity"],
        exact: true,
      });
    },
  });
};

export const useCompleteActionItem = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string): Promise<ActionItem> =>
      apiJson(actionItemRoutes.complete, `/action-items/${id}/complete`),
    onSuccess: () => {
      // Done: the corvid on its perch nods.
      corvidReact("nod");
      queryClient.invalidateQueries({ queryKey: ["actionItems"] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"], exact: true });
      queryClient.invalidateQueries({
        queryKey: ["dashboard", "activity"],
        exact: true,
      });
    },
  });
};
