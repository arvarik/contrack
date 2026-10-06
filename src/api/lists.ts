/** Hooks for contact lists and their members, with optimistic updates. */
import {
  invalidateContactViews,
  patchContactCaches,
  refreshContact,
} from "./contactCache";
import { apiJson, jsonBody } from "./client";
import { listRoutes, type ListMember } from "../../shared/contracts/lists";
import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
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
      invalidateContactViews(queryClient);
    },
  });
};

export const useListContacts = (listId: string | null) => {
  return useQuery({
    queryKey: ["list-contacts", listId],
    queryFn: ({ signal }): Promise<ListMember[]> =>
      apiJson(listRoutes.contacts, `/lists/${listId}/contacts`, { signal }),
    enabled: !!listId,
    staleTime: STALE_TIMES.listContacts,
  });
};

/** New order at once, from a drag or Move up and Move down. A failure puts it back. */
export const useReorderLists = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderedIds: string[]) =>
      apiJson(listRoutes.reorder, `/lists/reorder`, jsonBody({ orderedIds })),
    onMutate: async (orderedIds) => {
      await queryClient.cancelQueries({ queryKey: ["lists"] });
      const before = queryClient.getQueryData<ContactList[]>(["lists"]);
      if (before) {
        const byId = new Map(before.map((l) => [l.id, l]));
        queryClient.setQueryData(
          ["lists"],
          orderedIds.flatMap((id) => byId.get(id) ?? []),
        );
      }
      return before;
    },
    onError: (_error, _ids, before) => {
      if (before) queryClient.setQueryData(["lists"], before);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["lists"] }),
  });
};

/** The lists one contact is in, from whichever cache holds the contact. */
function listsOf(client: QueryClient, contactId: string): Contact["lists"] {
  const contact =
    client.getQueryData<Contact>(["contacts", contactId]) ??
    client
      .getQueryData<Contact[]>(["contacts"])
      ?.find((c) => c.id === contactId);
  return contact?.lists ?? [];
}

/**
 * Put a contact on a list or take it off. The chip changes at once, in both
 * caches, with the list's own name. A failed write puts both caches back.
 */
function useListMembership(add: boolean) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      listId,
      contactId,
    }: {
      listId: string;
      contactId: string;
    }) =>
      add
        ? apiJson(
            listRoutes.addMember,
            `/lists/${listId}/members`,
            jsonBody({ contactId }),
          )
        : apiJson(
            listRoutes.removeMember,
            `/lists/${listId}/members/${contactId}`,
          ),
    onMutate: async ({ listId, contactId }) => {
      await queryClient.cancelQueries({ queryKey: ["contacts"] });
      const list = add
        ? queryClient
            .getQueryData<ContactList[]>(["lists"])
            ?.find((l) => l.id === listId)
        : undefined;
      if (add && !list) return undefined;
      const lists = listsOf(queryClient, contactId).filter(
        (l) => l.id !== listId,
      );
      return patchContactCaches(queryClient, contactId, {
        lists: list
          ? [...lists, { id: list.id, name: list.name, icon: list.icon }]
          : lists,
      });
    },
    onError: (_error, _input, rollback) => rollback?.(),
    onSettled: (_data, _error, { contactId }) =>
      void refreshContact(queryClient, contactId),
  });
}

export const useAddToList = () => useListMembership(true);

export const useRemoveFromList = () => useListMembership(false);

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
    },
  });
};
