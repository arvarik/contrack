import { apiFetch } from "./client";
import { corvidReact } from "../lib/corvid";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { type ActionItem } from "../types";

export const useCompletedActionItems = () => {
  return useQuery({
    queryKey: ["actionItems", "completed"],
    queryFn: async ({ signal }): Promise<ActionItem[]> => {
      const res = await apiFetch(`/action-items/completed`, { signal });
      if (!res.ok) throw new Error("Failed to fetch completed action items");
      return res.json();
    },
  });
};

export const useUrgentActionItemCount = () => {
  return useQuery({
    queryKey: ["actionItems", "urgentCount"],
    queryFn: async ({ signal }): Promise<{ count: number }> => {
      const res = await apiFetch(`/action-items/count`, { signal });
      if (!res.ok) throw new Error("Failed to fetch urgent count");
      return res.json();
    },
    // We poll this occasionally or rely on invalidation from mutations
    staleTime: 1000 * 60 * 5, // 5 mins
  });
};

/** One follow-up for each contact, in one request that saves all or none. */
export const useBulkCreateActionItems = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      contactIds: string[];
      title: string;
      dueAt: string;
    }): Promise<{ count: number }> => {
      const res = await apiFetch("/action-items/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return res.json();
    },
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
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: { title?: string; dueAt?: string };
    }): Promise<ActionItem> => {
      const res = await apiFetch(`/action-items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update action item");
      return res.json();
    },
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
    mutationFn: async (id: string): Promise<ActionItem> => {
      const res = await apiFetch(`/action-items/${id}/complete`, {
        method: "PATCH",
      });
      if (!res.ok) throw new Error("Failed to complete action item");
      return res.json();
    },
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
