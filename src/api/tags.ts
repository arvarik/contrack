/**
 * Tags API client and React Query hooks.
 *
 * Provides tag vocabulary summaries with contact counts, tag renaming/merging,
 * and tag deletion across the account's contacts.
 *
 * @module api/tags
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiJson } from "./client";

export interface TagSummary {
  tag: string;
  count: number;
}

export const fetchTagSummary = async (): Promise<TagSummary[]> => {
  const data = await apiJson<{ tags: TagSummary[] }>("/tags/summary");
  return data.tags;
};

export const useTagSummary = () =>
  useQuery({
    queryKey: ["tags", "summary"],
    queryFn: fetchTagSummary,
  });

export const renameTag = (
  fromTag: string,
  toTag: string,
): Promise<{ affected: number }> =>
  apiJson<{ affected: number }>(`/tags/${encodeURIComponent(fromTag)}`, {
    method: "PATCH",
    body: JSON.stringify({ to: toTag }),
  });

export const useRenameTag = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) =>
      renameTag(from, to),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tags"] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
};

export const deleteTag = (tag: string): Promise<{ affected: number }> =>
  apiJson<{ affected: number }>(`/tags/${encodeURIComponent(tag)}`, {
    method: "DELETE",
  });

export const useDeleteTag = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tag: string) => deleteTag(tag),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tags"] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
};
