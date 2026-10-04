import { invalidateContactViews } from "./contactCache";
import { apiJson, jsonBody } from "./client";
import { INTERACTION_SEARCH_KEY } from "./search";
import { interactionRoutes } from "../../shared/contracts/interactions";
/**
 * Interaction API Hooks — React Query hooks for timeline and interaction operations.
 *
 * Provides `useTimeline`, `useAddInteraction`, `useDeleteInteraction`,
 * `useAddAttachment`, `useGenerateBriefing`, and `usePromoteGhost` with
 * optimistic updates for a responsive timeline UI.
 *
 * @module api/interactions
 */
import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { STALE_TIMES } from "../lib/queryConfig";
import { corvidReact } from "../lib/corvid";
import { type Interaction, type Contact } from "../types";

/**
 * Refresh the note search after a note changes.
 *
 * The server index is updated in the same transaction as the note, so the
 * only stale copy is the one React Query holds. Called from every mutation
 * below that adds, edits or removes a note.
 */
function invalidateInteractionSearch(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: [...INTERACTION_SEARCH_KEY] });
}

export const useTimeline = (contactId: string | undefined) => {
  return useQuery({
    queryKey: ["timeline", contactId],
    queryFn: ({ signal }): Promise<Interaction[]> =>
      apiJson(interactionRoutes.timeline, `/contacts/${contactId}/timeline`, {
        signal,
      }),
    enabled: !!contactId,
    staleTime: STALE_TIMES.timeline,
  });
};

export const useAddInteraction = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      contactId,
      data,
    }: {
      contactId: string;
      data: Partial<Interaction>;
    }): Promise<Interaction> =>
      apiJson(
        interactionRoutes.create,
        `/contacts/${contactId}/interactions`,
        jsonBody(data),
      ),
    // A conversation written down: the corvid calls, without a sound.
    onSuccess: () => corvidReact("caw"),
    onSettled: (_data, _error, { contactId }) => {
      queryClient.invalidateQueries({ queryKey: ["timeline", contactId] });
      invalidateContactViews(queryClient);
      invalidateInteractionSearch(queryClient);
    },
  });
};

export const useDeleteInteraction = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; contactId: string }) =>
      apiJson(interactionRoutes.delete, `/interactions/${id}`),
    onSettled: (_data, _error, { contactId }) => {
      queryClient.invalidateQueries({ queryKey: ["timeline", contactId] });
      invalidateContactViews(queryClient);
      invalidateInteractionSearch(queryClient);
    },
  });
};

export const useUpdateInteraction = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      contactId: string;
      data: { title?: string; content?: string | null };
    }): Promise<Interaction> =>
      apiJson(interactionRoutes.update, `/interactions/${id}`, jsonBody(data)),
    onSettled: (_data, _error, { contactId }) => {
      queryClient.invalidateQueries({ queryKey: ["timeline", contactId] });
      invalidateContactViews(queryClient);
      invalidateInteractionSearch(queryClient);
    },
  });
};

export const useAddAttachment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      contactId,
      file,
    }: {
      contactId: string;
      file: File;
    }): Promise<Interaction> => {
      const formData = new FormData();
      formData.append("attachment", file);
      return apiJson(
        interactionRoutes.attach,
        `/contacts/${contactId}/attachments`,
        { body: formData },
      );
    },
    onSuccess: (_data, { contactId }) => {
      queryClient.invalidateQueries({ queryKey: ["timeline", contactId] });
      invalidateContactViews(queryClient);
      queryClient.invalidateQueries({ queryKey: ["contacts", contactId] });
      invalidateInteractionSearch(queryClient);
    },
  });
};

export const useGenerateBriefing = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (contactId: string): Promise<string[]> => {
      const data = await apiJson(
        interactionRoutes.briefing,
        `/contacts/${contactId}/briefing`,
      );
      return data.points;
    },
    onSuccess: (_, contactId) => {
      queryClient.invalidateQueries({ queryKey: ["contacts", contactId] });
      queryClient.invalidateQueries({ queryKey: ["timeline", contactId] });
      invalidateContactViews(queryClient);
    },
  });
};

export const usePromoteGhost = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (contactId: string): Promise<Contact> =>
      (await apiJson(
        interactionRoutes.promote,
        `/contacts/${contactId}/promote`,
      )) as Contact,
    onSuccess: () => {
      invalidateContactViews(queryClient);
      queryClient.invalidateQueries({ queryKey: ["timeline"] });
      invalidateInteractionSearch(queryClient);
    },
  });
};
