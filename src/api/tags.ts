/** Hooks for the account's tags: counts, rename or merge, and delete. */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiJson, jsonBody } from "./client";
import { tagRoutes, type TagSummary } from "../../shared/contracts/tags";

export type { TagSummary };

const fetchTagSummary = async (): Promise<TagSummary[]> => {
  const data = await apiJson(tagRoutes.summary, "/tags/summary");
  return data.tags;
};

export const useTagSummary = () =>
  useQuery({
    queryKey: ["tags", "summary"],
    queryFn: fetchTagSummary,
  });

// `jsonBody` sets the Content-Type. Without it the browser sends the JSON as
// text/plain, the server does not parse it, and the rename is refused.
const renameTag = (fromTag: string, toTag: string) =>
  apiJson(
    tagRoutes.rename,
    `/tags/${encodeURIComponent(fromTag)}`,
    jsonBody({ to: toTag }),
  );

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

const deleteTag = (tag: string) =>
  apiJson(tagRoutes.delete, `/tags/${encodeURIComponent(tag)}`);

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
