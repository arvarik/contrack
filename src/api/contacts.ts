/**
 * Contact API Hooks — React Query hooks for all contact CRUD operations.
 *
 * Provides `useContacts`, `useContact`, `useCreateContact`, `useUpdateContact`,
 * `useDeleteContact`, and bulk operations with optimistic cache updates.
 *
 * @module api/contacts
 */
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { STALE_TIMES } from '../lib/queryConfig';
import { Contact, ContactUpdateData } from '../types';

const API_BASE = '/api';

export const useContacts = () => {
  return useQuery({
    queryKey: ['contacts'],
    queryFn: async (): Promise<Contact[]> => {
      const start = performance.now();
      const res = await fetch(`${API_BASE}/contacts?view=slim`);
      if (!res.ok) throw new Error('Failed to fetch contacts');
      const data = await res.json();
      const duration = performance.now() - start;
      if (import.meta.env.DEV) {
        console.log(`[Perf] useContacts: fetch took ${duration.toFixed(2)}ms, items=${data.length}`);
      }
      return data;
    },
    staleTime: 600_000, // 10 minutes — navigating back to Network is now instant
  });
};

/**
 * Slim contact projection for secondary consumers that only need
 * name + avatar fields (mentions, command palette, etc.).
 *
 * Shares the same query key/cache as `useContacts()` but uses
 * TanStack Query's `select` to project a stable, minimal shape.
 * This prevents re-renders when unrelated contact fields change.
 */
export interface ContactSlim {
  id: string;
  name: string;
  avatarUrl: string | null;
  themeColor: string;
  isGhost: boolean;
}

export const useContactNames = () => {
  return useQuery({
    queryKey: ['contacts'],
    queryFn: async (): Promise<Contact[]> => {
      const res = await fetch(`${API_BASE}/contacts?view=slim`);
      if (!res.ok) throw new Error('Failed to fetch contacts');
      return res.json();
    },
    staleTime: 600_000,
    select: (contacts): ContactSlim[] =>
      contacts.map(c => ({
        id: c.id,
        name: c.name,
        avatarUrl: c.avatarUrl,
        themeColor: c.themeColor,
        isGhost: c.isGhost,
      })),
  });
};

/**
 * Searchable slim contact projection for latency masking (Feature 8).
 *
 * Shares the same query key/cache as useContacts — zero extra network cost.
 * Projects the fields needed for instant client-side search:
 * name, role, company, location, industry, tags, score, updatedAt, avatarUrl.
 *
 * Used by `useInstantSearch()` to deliver 0ms search results on every keystroke.
 */
export interface SlimSearchContact {
  id: string;
  name: string;
  role: string | null;
  company: string | null;
  location: string | null;
  industry: string | null;
  avatarUrl: string | null;
  updatedAt: string;
  lastContactedAt: string | null;
  relationshipScore: number | null;
  tags: { tag: string }[];
}

export const useSlimContactsForSearch = () => {
  return useQuery({
    queryKey: ['contacts'],
    queryFn: async (): Promise<Contact[]> => {
      const res = await fetch(`${API_BASE}/contacts?view=slim`);
      if (!res.ok) throw new Error('Failed to fetch contacts');
      return res.json();
    },
    staleTime: 600_000,
    select: (contacts): SlimSearchContact[] =>
      contacts
        .filter(c => !c.isGhost && !c.isArchived)
        .map(c => ({
          id: c.id,
          name: c.name,
          role: c.role,
          company: c.company,
          location: c.location,
          industry: c.industry,
          avatarUrl: c.avatarUrl,
          updatedAt: c.updatedAt,
          lastContactedAt: c.lastContactedAt,
          relationshipScore: c.relationshipScore ?? null,
          tags: c.tags ?? [],
        })),
  });
};

export const useContact = (id: string | undefined) => {
  return useQuery({
    queryKey: ['contacts', id],
    queryFn: async (): Promise<Contact> => {
      const res = await fetch(`${API_BASE}/contacts/${id}`);
      if (!res.ok) throw new Error('Failed to fetch contact');
      return res.json();
    },
    enabled: !!id,
    staleTime: STALE_TIMES.contactDetail,
    // keepPreviousData: When navigating between contacts, show the previous
    // contact's data briefly instead of a loading skeleton. Prevents flash.
    placeholderData: keepPreviousData,
  });
};

export const useMapContacts = () => {
  return useQuery({
    queryKey: ['contacts', 'map'],
    queryFn: async (): Promise<(Partial<Contact> & { lat: number; lng: number })[]> => {
      const res = await fetch(`${API_BASE}/contacts/map`);
      if (!res.ok) throw new Error('Failed to fetch map data');
      return res.json();
    },
    staleTime: STALE_TIMES.mapData,
  });
};

export const useArchivedContacts = () => {
  return useQuery({
    queryKey: ['contacts', 'archived'],
    queryFn: async (): Promise<Contact[]> => {
      const res = await fetch(`${API_BASE}/contacts/archived`);
      if (!res.ok) throw new Error('Failed to fetch archived contacts');
      return res.json();
    },
    staleTime: STALE_TIMES.archived,
  });
};

export const useCreateContact = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: ContactUpdateData): Promise<Contact> => {
      const res = await fetch(`${API_BASE}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to create contact');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
};

export const useBulkCreateContacts = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (contacts: Partial<Contact>[]): Promise<{success: boolean, count: number}> => {
      const res = await fetch(`${API_BASE}/contacts/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(contacts),
      });
      if (!res.ok) throw new Error('Failed to bulk create contacts');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
};

export const useParseContactText = () => {
  return useMutation({
    mutationFn: async (text: string): Promise<Partial<Contact>> => {
      const res = await fetch(`${API_BASE}/parse-contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error('Failed to parse text');
      return res.json();
    },
  });
};

export const useUpdateContact = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: ContactUpdateData }): Promise<Contact> => {
      const res = await fetch(`${API_BASE}/contacts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to update contact');
      return res.json();
    },
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: ['contacts', id] });
      await queryClient.cancelQueries({ queryKey: ['contacts'] });

      const previousContact = queryClient.getQueryData<Contact>(['contacts', id]);
      
      if (previousContact) {
        queryClient.setQueryData<Contact>(['contacts', id], {
          ...previousContact,
          ...data,
        } as Contact);
      }

      queryClient.setQueryData<Contact[]>(['contacts'], old => 
        old?.map(c => c.id === id ? { ...c, ...data } as Contact : c)
      );

      return { previousContact };
    },
    onError: (_err, { id }, context) => {
      if (context?.previousContact) {
        queryClient.setQueryData(['contacts', id], context.previousContact);
      }
    },
    onSettled: (_data, _error, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['contacts', id] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
};

export const useDeleteContact = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<{ success: boolean; message: string }> => {
      const res = await fetch(`${API_BASE}/contacts/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete contact');
      return res.json();
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['contacts'] });
      const previousContacts = queryClient.getQueryData<Contact[]>(['contacts']);
      
      queryClient.setQueryData<Contact[]>(['contacts'], old => 
        old?.filter(c => c.id !== id)
      );

      return { previousContacts };
    },
    onError: (_err, _id, context) => {
      if (context?.previousContacts) {
        queryClient.setQueryData(['contacts'], context.previousContacts);
      }
    },
    onSettled: (_data, _error, id) => {
      queryClient.removeQueries({ queryKey: ['contacts', id] });
      queryClient.removeQueries({ queryKey: ['timeline', id] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
};

export const useArchiveContact = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${API_BASE}/contacts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isArchived: true }),
      });
      if (!res.ok) throw new Error('Failed to archive contact');
      return res.json();
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['contacts'] });
      await queryClient.cancelQueries({ queryKey: ['contacts', id] });
      
      const previousContacts = queryClient.getQueryData<Contact[]>(['contacts']);
      const previousContact = queryClient.getQueryData<Contact>(['contacts', id]);
      
      if (previousContact) {
         queryClient.setQueryData<Contact>(['contacts', id], { ...previousContact, isArchived: true });
      }

      queryClient.setQueryData<Contact[]>(['contacts'], old => 
        old?.map(c => c.id === id ? { ...c, isArchived: true } : c)
      );

      return { previousContacts, previousContact };
    },
    onError: (_err, id, context) => {
      if (context?.previousContacts) queryClient.setQueryData(['contacts'], context.previousContacts);
      if (context?.previousContact) queryClient.setQueryData(['contacts', id], context.previousContact);
    },
    onSettled: (_data, _error, id) => {
      queryClient.invalidateQueries({ queryKey: ['contacts', id] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['contacts', 'archived'] });
    },
  });
};

export const useUnarchiveContact = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${API_BASE}/contacts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isArchived: false }),
      });
      if (!res.ok) throw new Error('Failed to unarchive contact');
      return res.json();
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['contacts'] });
      await queryClient.cancelQueries({ queryKey: ['contacts', id] });
      
      const previousContacts = queryClient.getQueryData<Contact[]>(['contacts']);
      const previousContact = queryClient.getQueryData<Contact>(['contacts', id]);
      
      if (previousContact) {
         queryClient.setQueryData<Contact>(['contacts', id], { ...previousContact, isArchived: false });
      }

      queryClient.setQueryData<Contact[]>(['contacts'], old => 
        old?.map(c => c.id === id ? { ...c, isArchived: false } : c)
      );

      return { previousContacts, previousContact };
    },
    onError: (_err, id, context) => {
      if (context?.previousContacts) queryClient.setQueryData(['contacts'], context.previousContacts);
      if (context?.previousContact) queryClient.setQueryData(['contacts', id], context.previousContact);
    },
    onSettled: (_data, _error, id) => {
      queryClient.invalidateQueries({ queryKey: ['contacts', id] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['contacts', 'archived'] });
    },
  });
};

export const useBulkDeleteContacts = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]): Promise<{ success: boolean; count: number }> => {
      const res = await fetch(`${API_BASE}/contacts/bulk-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error('Failed to bulk delete contacts');
      return res.json();
    },
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: ['contacts'] });
      const previousContacts = queryClient.getQueryData<Contact[]>(['contacts']);
      
      const idsSet = new Set(ids);
      queryClient.setQueryData<Contact[]>(['contacts'], old => 
        old?.filter(c => !idsSet.has(c.id))
      );

      return { previousContacts };
    },
    onError: (_err, _ids, context) => {
      if (context?.previousContacts) queryClient.setQueryData(['contacts'], context.previousContacts);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
};

export const useBulkUpdateContacts = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, data }: { ids: string[]; data: ContactUpdateData }): Promise<{ success: boolean; count: number }> => {
      const res = await fetch(`${API_BASE}/contacts/bulk-update`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, data }),
      });
      if (!res.ok) throw new Error('Failed to bulk update contacts');
      return res.json();
    },
    onMutate: async ({ ids, data }) => {
      await queryClient.cancelQueries({ queryKey: ['contacts'] });
      const previousContacts = queryClient.getQueryData<Contact[]>(['contacts']);
      
      const idsSet = new Set(ids);
      queryClient.setQueryData<Contact[]>(['contacts'], old => 
        old?.map(c => idsSet.has(c.id) ? { ...c, ...data } as Contact : c)
      );

      return { previousContacts };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousContacts) queryClient.setQueryData(['contacts'], context.previousContacts);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
};

export const useUploadAvatar = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ contactId, file }: { contactId: string; file: File }): Promise<Contact> => {
      const formData = new FormData();
      formData.append('avatar', file);
      const res = await fetch(`${API_BASE}/contacts/${contactId}/avatar`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error('Failed to upload avatar');
      return res.json();
    },
    onSuccess: (_data, { contactId }) => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['contact', contactId] });
      queryClient.invalidateQueries({ queryKey: ['contacts', contactId] });
    },
  });
};

export const useSetDicebearAvatar = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ contactId, avatarUrl }: { contactId: string; avatarUrl: string }): Promise<Contact> => {
      const res = await fetch(`${API_BASE}/contacts/${contactId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarUrl }),
      });
      if (!res.ok) throw new Error('Failed to set avatar');
      return res.json();
    },
    onSuccess: (_data, { contactId }) => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['contact', contactId] });
      queryClient.invalidateQueries({ queryKey: ['contacts', contactId] });
    },
  });
};
