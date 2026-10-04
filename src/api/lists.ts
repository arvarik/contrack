import { invalidateContactViews } from "./contactCache";
import { apiJson, jsonBody } from "./client";
import { listRoutes } from "../../shared/contracts/lists";
/**
 * List Management API Hooks — React Query hooks for contact lists.
 *
 * Provides `useLists`, `useCreateList`, `useDeleteList`, `useReorderLists`,
 * `useAddToList`, `useRemoveFromList`, and `useBulkAddToList` with optimistic
 * cache updates for instant UI feedback when managing list memberships.
 *
 * @module api/lists
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { STALE_TIMES } from "../lib/queryConfig";
import { type Contact, type ContactList } from "../types";

export const useLists = () => {
  return useQuery({
    queryKey: ["lists"],
    queryFn: ({ signal }): Promise<ContactList[]> =>
      apiJson(listRoutes.all, `/lists`, { signal }),
    staleTime: STALE_TIMES.lists,
  });
};

export const useCreateList = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; icon: string }): Promise<ContactList> =>
      apiJson(listRoutes.create, `/lists`, jsonBody(data)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lists"] });
      queryClient.invalidateQueries({ queryKey: ["list-contacts"] });
    },
  });
};

export const useDeleteList = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiJson(listRoutes.delete, `/lists/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lists"] });
      queryClient.invalidateQueries({ queryKey: ["list-contacts"] });
      invalidateContactViews(queryClient);
    },
  });
};

export const useUpdateList = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: { name?: string; icon?: string };
    }): Promise<ContactList> =>
      apiJson(listRoutes.update, `/lists/${id}`, jsonBody(data)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lists"] });
      queryClient.invalidateQueries({ queryKey: ["list-contacts"] });
      invalidateContactViews(queryClient);
    },
  });
};

export const useListContacts = (listId: string | null) => {
  return useQuery({
    queryKey: ["list-contacts", listId],
    queryFn: async ({ signal }): Promise<Contact[]> =>
      (await apiJson(listRoutes.contacts, `/lists/${listId}/contacts`, {
        signal,
      })) as Contact[],
    enabled: !!listId,
    staleTime: STALE_TIMES.listContacts,
  });
};

export const useReorderLists = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderedIds: string[]) =>
      apiJson(listRoutes.reorder, `/lists/reorder`, jsonBody({ orderedIds })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lists"] });
      queryClient.invalidateQueries({ queryKey: ["list-contacts"] });
    },
  });
};

export const useAddToList = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      listId,
      contactId,
    }: {
      listId: string;
      contactId: string;
    }) =>
      apiJson(
        listRoutes.addMember,
        `/lists/${listId}/members`,
        jsonBody({ contactId }),
      ),
    onMutate: async ({ listId, contactId }) => {
      await queryClient.cancelQueries({ queryKey: ["contacts"] });
      await queryClient.cancelQueries({ queryKey: ["contacts", contactId] });

      const previousContacts = queryClient.getQueryData<Contact[]>([
        "contacts",
      ]);
      const previousContact = queryClient.getQueryData<Contact>([
        "contacts",
        contactId,
      ]);

      const tentativeList = {
        id: listId,
        name: "...",
        icon: "list",
        sortOrder: 0,
        createdAt: new Date().toISOString(),
      };

      if (previousContact) {
        queryClient.setQueryData<Contact>(["contacts", contactId], {
          ...previousContact,
          lists: [...(previousContact.lists || []), tentativeList],
        });
      }

      queryClient.setQueryData<Contact[]>(["contacts"], (old) =>
        old?.map((c) =>
          c.id === contactId
            ? { ...c, lists: [...(c.lists || []), tentativeList] }
            : c,
        ),
      );

      return { previousContacts, previousContact };
    },
    onError: (_err, { contactId }, context) => {
      if (context?.previousContacts)
        queryClient.setQueryData(["contacts"], context.previousContacts);
      if (context?.previousContact)
        queryClient.setQueryData(
          ["contacts", contactId],
          context.previousContact,
        );
    },
    onSettled: (_data, _error, { contactId }) => {
      queryClient.invalidateQueries({ queryKey: ["contacts", contactId] });
      invalidateContactViews(queryClient);
      queryClient.invalidateQueries({ queryKey: ["lists"] });
      queryClient.invalidateQueries({ queryKey: ["list-contacts"] });
    },
  });
};

export const useRemoveFromList = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      listId,
      contactId,
    }: {
      listId: string;
      contactId: string;
    }) =>
      apiJson(listRoutes.removeMember, `/lists/${listId}/members/${contactId}`),
    onMutate: async ({ listId, contactId }) => {
      await queryClient.cancelQueries({ queryKey: ["contacts"] });
      await queryClient.cancelQueries({ queryKey: ["contacts", contactId] });

      const previousContacts = queryClient.getQueryData<Contact[]>([
        "contacts",
      ]);
      const previousContact = queryClient.getQueryData<Contact>([
        "contacts",
        contactId,
      ]);

      if (previousContact) {
        queryClient.setQueryData<Contact>(["contacts", contactId], {
          ...previousContact,
          lists: (previousContact.lists || []).filter((l) => l.id !== listId),
        });
      }

      queryClient.setQueryData<Contact[]>(["contacts"], (old) =>
        old?.map((c) =>
          c.id === contactId
            ? { ...c, lists: (c.lists || []).filter((l) => l.id !== listId) }
            : c,
        ),
      );

      return { previousContacts, previousContact };
    },
    onError: (_err, { contactId }, context) => {
      if (context?.previousContacts)
        queryClient.setQueryData(["contacts"], context.previousContacts);
      if (context?.previousContact)
        queryClient.setQueryData(
          ["contacts", contactId],
          context.previousContact,
        );
    },
    onSettled: (_data, _error, { contactId }) => {
      queryClient.invalidateQueries({ queryKey: ["contacts", contactId] });
      invalidateContactViews(queryClient);
      queryClient.invalidateQueries({ queryKey: ["lists"] });
      queryClient.invalidateQueries({ queryKey: ["list-contacts"] });
    },
  });
};

export const useBulkAddToList = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      listId,
      contactIds,
    }: {
      listId: string;
      contactIds: string[];
    }) =>
      apiJson(
        listRoutes.addMembers,
        `/lists/${listId}/members/bulk`,
        jsonBody({ contactIds }),
      ),
    onSuccess: () => {
      invalidateContactViews(queryClient);
      queryClient.invalidateQueries({ queryKey: ["lists"] });
      queryClient.invalidateQueries({ queryKey: ["list-contacts"] });
    },
  });
};
