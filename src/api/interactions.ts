/** Hooks for a contact's timeline and its notes, with optimistic updates. */
import { refreshContact } from "./contactCache";
import { apiJson, jsonBody } from "./client";
import { INTERACTION_SEARCH_KEY } from "./search";
import { interactionRoutes } from "../../shared/contracts/interactions";
import {
  queryOptions,
  useQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { STALE_TIMES } from "../lib/queryConfig";
import { corvidReact } from "../lib/corvid";
import { type Interaction, type Contact } from "../types";

/**
 * Refreshes the note search after a note changes. The server's index changes
 * in the note's transaction, so only the cached copy is stale.
 */
function invalidateInteractionSearch(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: [...INTERACTION_SEARCH_KEY] });
}

/** One contact's timeline, as the contact page reads it. */
export const timelineQuery = (contactId: string) =>
  queryOptions({
    queryKey: ["timeline", contactId],
    queryFn: ({ signal }): Promise<Interaction[]> =>
      apiJson(interactionRoutes.timeline, `/contacts/${contactId}/timeline`, {
        signal,
      }),
    staleTime: STALE_TIMES.timeline,
  });

export const useTimeline = (contactId: string | undefined) =>
  useQuery({ ...timelineQuery(contactId ?? ""), enabled: !!contactId });

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
      void refreshContact(queryClient, contactId);
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
      void refreshContact(queryClient, contactId);
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
      void refreshContact(queryClient, contactId);
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
      void refreshContact(queryClient, contactId);
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
      queryClient.invalidateQueries({ queryKey: ["timeline", contactId] });
      void refreshContact(queryClient, contactId);
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
    onSuccess: (contact) => {
      void refreshContact(queryClient, contact);
      queryClient.invalidateQueries({ queryKey: ["timeline"] });
      invalidateInteractionSearch(queryClient);
    },
  });
};
