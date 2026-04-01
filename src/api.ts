import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Contact, Interaction } from './types';

const API_BASE = '/api';

// =============================================================================
// Query Hooks (Read Operations)
// =============================================================================

/**
 * Hook to retrieve all contacts (fully hydrated with child relations).
 * Fetches from the SQLite backend ordered by newest added.
 */
export const useContacts = () => {
  return useQuery({
    queryKey: ['contacts'],
    queryFn: async (): Promise<Contact[]> => {
      const res = await fetch(`${API_BASE}/contacts`);
      if (!res.ok) throw new Error('Failed to fetch contacts');
      return res.json();
    }
  });
};

/**
 * Hook to retrieve a single fully-hydrated contact by its ID.
 * Automatically disabled when `id` is undefined/null.
 */
export const useContact = (id: string | undefined) => {
  return useQuery({
    queryKey: ['contacts', id],
    queryFn: async (): Promise<Contact> => {
      const res = await fetch(`${API_BASE}/contacts/${id}`);
      if (!res.ok) throw new Error('Failed to fetch contact');
      return res.json();
    },
    enabled: !!id,
  });
};

/**
 * Hook to search contacts against the FTS5 virtual table.
 * Returns fully hydrated contact objects.
 */
export const useSearchContacts = (q: string) => {
  return useQuery({
    queryKey: ['contacts', 'search', q],
    queryFn: async (): Promise<Contact[]> => {
      const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error('Failed to search contacts');
      return res.json();
    },
    enabled: q.length > 0,
  });
};

/**
 * Hook to retrieve all contacts with valid lat/lng coordinates for map plotting.
 */
export const useMapContacts = () => {
  return useQuery({
    queryKey: ['contacts', 'map'],
    queryFn: async (): Promise<(Partial<Contact> & { lat: number; lng: number })[]> => {
      const res = await fetch(`${API_BASE}/contacts/map`);
      if (!res.ok) throw new Error('Failed to fetch map data');
      return res.json();
    }
  });
};

/**
 * Hook to retrieve the chronological interaction history of a contact.
 */
export const useTimeline = (contactId: string | undefined) => {
  return useQuery({
    queryKey: ['timeline', contactId],
    queryFn: async (): Promise<Interaction[]> => {
      const res = await fetch(`${API_BASE}/contacts/${contactId}/timeline`);
      if (!res.ok) throw new Error('Failed to fetch timeline');
      return res.json();
    },
    enabled: !!contactId,
  });
};

// =============================================================================
// Mutation Hooks (Write Operations)
// =============================================================================

/**
 * Mutation hook to create a contact with optional child records.
 * The backend accepts nested emails, phones, socialLinks, etc. arrays.
 */
export const useCreateContact = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<Contact>): Promise<Contact> => {
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

/**
 * Mutation hook for bulk-importing an array of contacts.
 */
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

/**
 * Mutation hook to parse unstructured text into a structured contact object.
 */
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

/**
 * Mutation hook to optimistically update a contact's fields.
 * Supports both scalar field updates and child array replacement.
 */
export const useUpdateContact = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Contact> }): Promise<Contact> => {
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
        });
      }

      queryClient.setQueryData<Contact[]>(['contacts'], old => 
        old?.map(c => c.id === id ? { ...c, ...data } : c)
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

/**
 * Mutation hook to permanently delete a contact.
 */
export const useDeleteContact = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<{ success: boolean; message: string }> => {
      const res = await fetch(`${API_BASE}/contacts/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete contact');
      return res.json();
    },
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: ['contacts', id] });
      queryClient.removeQueries({ queryKey: ['timeline', id] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
};

/**
 * Mutation hook to add an interaction (Note, Call, Email, Meeting, Message, etc).
 * Features full optimistic cache updates for instant timeline rendering.
 */
export const useAddInteraction = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ contactId, data }: { contactId: string; data: Partial<Interaction> }): Promise<Interaction> => {
      const res = await fetch(`${API_BASE}/contacts/${contactId}/interactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to add interaction');
      return res.json();
    },
    onMutate: async ({ contactId, data }) => {
      await queryClient.cancelQueries({ queryKey: ['timeline', contactId] });
      const previousTimeline = queryClient.getQueryData<Interaction[]>(['timeline', contactId]);
      
      const optimisticInteraction: Interaction = {
        id: `temp-${Date.now()}`,
        contactId,
        type: data.type as Interaction['type'],
        title: data.title || '',
        content: data.content || null,
        date: new Date().toISOString(),
        duration: data.duration || null,
      };

      queryClient.setQueryData<Interaction[]>(['timeline', contactId], old => {
        return [optimisticInteraction, ...(old || [])];
      });

      return { previousTimeline };
    },
    onError: (_err, { contactId }, context) => {
      if (context?.previousTimeline) {
        queryClient.setQueryData(['timeline', contactId], context.previousTimeline);
      }
    },
    onSettled: (_data, _error, { contactId }) => {
      queryClient.invalidateQueries({ queryKey: ['timeline', contactId] });
      queryClient.invalidateQueries({ queryKey: ['contacts', contactId] }); 
      queryClient.invalidateQueries({ queryKey: ['contacts'] }); 
    },
  });
};

/**
 * Mutation hook to delete a single interaction entry from the timeline.
 */
export const useDeleteInteraction = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, contactId }: { id: string; contactId: string }): Promise<{ success: boolean; message: string }> => {
      const res = await fetch(`${API_BASE}/interactions/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete interaction');
      return res.json();
    },
    onMutate: async ({ id, contactId }) => {
      await queryClient.cancelQueries({ queryKey: ['timeline', contactId] });
      const previousTimeline = queryClient.getQueryData<Interaction[]>(['timeline', contactId]);
      
      queryClient.setQueryData<Interaction[]>(['timeline', contactId], old =>
        old?.filter(item => item.id !== id)
      );

      return { previousTimeline };
    },
    onError: (_err, { contactId }, context) => {
      if (context?.previousTimeline) {
        queryClient.setQueryData(['timeline', contactId], context.previousTimeline);
      }
    },
    onSettled: (_data, _error, { contactId }) => {
      queryClient.invalidateQueries({ queryKey: ['timeline', contactId] });
    },
  });
};

/**
 * Mutation hook to upload a generic file attachment via multipart/form-data.
 */
export const useAddAttachment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ contactId, file }: { contactId: string; file: File }): Promise<Interaction> => {
      const formData = new FormData();
      formData.append('attachment', file);

      const res = await fetch(`${API_BASE}/contacts/${contactId}/attachments`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error('Failed to upload attachment');
      return res.json();
    },
    onSuccess: (_data, { contactId }) => {
      queryClient.invalidateQueries({ queryKey: ['timeline', contactId] });
      queryClient.invalidateQueries({ queryKey: ['contacts', contactId] }); 
    },
  });
};

// =============================================================================
// Singularity De-Duplication Engine
// =============================================================================

import type { DedupeSuggestion } from './types';

/**
 * Fetches dedupe suggestions from the two-pass engine.
 * Disabled by default — must be explicitly enabled by the view.
 */
export const useDedupeSuggestions = (enabled = false) => {
  return useQuery<DedupeSuggestion[]>({
    queryKey: ['dedupe-suggestions'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/dedupe/suggestions`);
      if (!res.ok) throw new Error('Failed to fetch dedupe suggestions');
      return res.json();
    },
    enabled,
    staleTime: 30_000, // Cache suggestions for 30s
    refetchOnWindowFocus: false,
  });
};

/**
 * Merges two contacts (duplicate → primary) in a single transaction.
 * On success, fully invalidates all relevant caches.
 */
export const useMergeContacts = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ primaryId, duplicateId }: { primaryId: string; duplicateId: string }) => {
      const res = await fetch(`${API_BASE}/contacts/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primaryId, duplicateId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Merge failed');
      }
      return res.json();
    },
    onSuccess: () => {
      // Invalidate everything: the merged contact, the deleted one, the full list, and suggestions
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['dedupe-suggestions'] });
    },
  });
};

/**
 * Seeds edge-case duplicate contacts for testing the Singularity engine.
 */
export const useSeedDuplicates = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/dev/seed-duplicates`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to seed duplicates');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['dedupe-suggestions'] });
    },
  });
};
