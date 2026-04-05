/**
 * List Management API Hooks — React Query hooks for contact lists.
 *
 * Provides `useLists`, `useCreateList`, `useDeleteList`, `useReorderLists`,
 * `useAddToList`, `useRemoveFromList`, and `useBulkAddToList` with optimistic
 * cache updates for instant UI feedback when managing list memberships.
 *
 * @module api/lists
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Contact, ContactList } from '../types';

const API_BASE = '/api';

export const useLists = () => {
  return useQuery({
    queryKey: ['lists'],
    queryFn: async (): Promise<ContactList[]> => {
      const res = await fetch(`${API_BASE}/lists`);
      if (!res.ok) throw new Error('Failed to fetch lists');
      return res.json();
    },
  });
};

export const useCreateList = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { name: string; icon: string }): Promise<ContactList> => {
      const res = await fetch(`${API_BASE}/lists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to create list');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lists'] });
    },
  });
};

export const useDeleteList = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${API_BASE}/lists/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete list');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lists'] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
};

export const useReorderLists = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (orderedIds: string[]) => {
      const res = await fetch(`${API_BASE}/lists/reorder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds }),
      });
      if (!res.ok) throw new Error('Failed to reorder lists');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lists'] });
    },
  });
};

export const useAddToList = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ listId, contactId }: { listId: string; contactId: string }) => {
      const res = await fetch(`${API_BASE}/lists/${listId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId }),
      });
      if (!res.ok) throw new Error('Failed to add to list');
      return res.json();
    },
    onMutate: async ({ listId, contactId }) => {
      await queryClient.cancelQueries({ queryKey: ['contacts'] });
      await queryClient.cancelQueries({ queryKey: ['contacts', contactId] });
      
      const previousContacts = queryClient.getQueryData<Contact[]>(['contacts']);
      const previousContact = queryClient.getQueryData<Contact>(['contacts', contactId]);
      
      const tentativeList = { id: listId, name: '...', icon: 'list', sortOrder: 0, createdAt: new Date().toISOString() };

      if (previousContact) {
         queryClient.setQueryData<Contact>(['contacts', contactId], {
           ...previousContact,
           lists: [...(previousContact.lists || []), tentativeList]
         });
      }

      queryClient.setQueryData<Contact[]>(['contacts'], old => 
        old?.map(c => c.id === contactId 
          ? { ...c, lists: [...(c.lists || []), tentativeList] }
          : c
        )
      );

      return { previousContacts, previousContact };
    },
    onError: (_err, { contactId }, context) => {
      if (context?.previousContacts) queryClient.setQueryData(['contacts'], context.previousContacts);
      if (context?.previousContact) queryClient.setQueryData(['contacts', contactId], context.previousContact);
    },
    onSettled: (_data, _error, { contactId }) => {
      queryClient.invalidateQueries({ queryKey: ['contacts', contactId] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['lists'] });
    },
  });
};

export const useRemoveFromList = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ listId, contactId }: { listId: string; contactId: string }) => {
      const res = await fetch(`${API_BASE}/lists/${listId}/members/${contactId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to remove from list');
      return res.json();
    },
    onMutate: async ({ listId, contactId }) => {
      await queryClient.cancelQueries({ queryKey: ['contacts'] });
      await queryClient.cancelQueries({ queryKey: ['contacts', contactId] });
      
      const previousContacts = queryClient.getQueryData<Contact[]>(['contacts']);
      const previousContact = queryClient.getQueryData<Contact>(['contacts', contactId]);
      
      if (previousContact) {
         queryClient.setQueryData<Contact>(['contacts', contactId], {
           ...previousContact,
           lists: (previousContact.lists || []).filter(l => l.id !== listId)
         });
      }

      queryClient.setQueryData<Contact[]>(['contacts'], old => 
        old?.map(c => c.id === contactId 
          ? { ...c, lists: (c.lists || []).filter(l => l.id !== listId) }
          : c
        )
      );

      return { previousContacts, previousContact };
    },
    onError: (_err, { contactId }, context) => {
      if (context?.previousContacts) queryClient.setQueryData(['contacts'], context.previousContacts);
      if (context?.previousContact) queryClient.setQueryData(['contacts', contactId], context.previousContact);
    },
    onSettled: (_data, _error, { contactId }) => {
      queryClient.invalidateQueries({ queryKey: ['contacts', contactId] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['lists'] });
    },
  });
};

export const useBulkAddToList = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ listId, contactIds }: { listId: string; contactIds: string[] }): Promise<{ success: boolean; count: number }> => {
      const res = await fetch(`${API_BASE}/lists/${listId}/members/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactIds }),
      });
      if (!res.ok) throw new Error('Failed to bulk add to list');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['lists'] });
    },
  });
};
