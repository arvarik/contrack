import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Contact, Interaction, SemanticSearchResult, ContactList } from './types';

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
      const res = await fetch(`${API_BASE}/contacts?view=slim`);
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
 * Mutation hook to generate the Catch-Me-Up briefing.
 */
export const useGenerateBriefing = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (contactId: string): Promise<string[]> => {
      const res = await fetch(`${API_BASE}/contacts/${contactId}/briefing`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to generate briefing');
      const data = await res.json();
      return data.points;
    },
    onSuccess: (_, contactId) => {
      queryClient.invalidateQueries({ queryKey: ['contacts', contactId] });
      queryClient.invalidateQueries({ queryKey: ['timeline', contactId] });
    },
  });
};

/**
 * Mutation hook to promote a Ghost Contact.
 */
export const usePromoteGhost = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (contactId: string): Promise<Contact> => {
      const res = await fetch(`${API_BASE}/contacts/${contactId}/promote`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to promote ghost contact');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['timeline'] });
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
 * Mutation hook to update an interaction's title or content.
 */
export const useUpdateInteraction = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, contactId, data }: { id: string; contactId: string; data: { title?: string; content?: string } }): Promise<Interaction> => {
      const res = await fetch(`${API_BASE}/interactions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to update interaction');
      return res.json();
    },
    onMutate: async ({ id, contactId, data }) => {
      await queryClient.cancelQueries({ queryKey: ['timeline', contactId] });
      const previousTimeline = queryClient.getQueryData<Interaction[]>(['timeline', contactId]);

      queryClient.setQueryData<Interaction[]>(['timeline', contactId], old =>
        old?.map(item => item.id === id ? { ...item, ...data } : item)
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

// =============================================================================
// Semantic RAG Search
// =============================================================================

/**
 * Mutation hook for the "Ask My CRM" semantic AI search.
 * Sends a natural-language query to POST /api/search/semantic, which
 * passes a compressed contact dump to Gemini and returns matched contacts
 * with AI-generated reasons. Falls back to FTS5 on rate-limit / error.
 *
 * Uses useMutation (not useQuery) because each search is an explicit
 * user gesture that must hit the network fresh — no stale caching.
 */
export const useSemanticSearch = () => {
  return useMutation({
    mutationFn: async (query: string): Promise<SemanticSearchResult> => {
      const res = await fetch(`${API_BASE}/search/semantic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      if (!res.ok) throw new Error('Semantic search failed');
      return res.json();
    },
  });
};

// =============================================================================
// Lists (User-Created Contact Groups)
// =============================================================================

/** Fetch all lists with member counts, ordered by sortOrder. */
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

/** Create a new list with a name and icon. */
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

/** Delete a list by ID. */
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

/** Reorder lists by providing an ordered array of IDs. */
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

/** Add a contact to a list (idempotent). */
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
      
      // We don't have full list info, just optimistic assume the ID
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

/** Remove a contact from a list (idempotent). */
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

// =============================================================================
// Archive / Unarchive
// =============================================================================

/** Fetch all archived contacts. */
export const useArchivedContacts = () => {
  return useQuery({
    queryKey: ['contacts', 'archived'],
    queryFn: async (): Promise<Contact[]> => {
      const res = await fetch(`${API_BASE}/contacts/archived`);
      if (!res.ok) throw new Error('Failed to fetch archived contacts');
      return res.json();
    },
  });
};

/** Archive a single contact (soft-hide). */
export const useArchiveContact = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${API_BASE}/contacts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isArchived: 1 }),
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

/** Un-archive a single contact (restore to network). */
export const useUnarchiveContact = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${API_BASE}/contacts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isArchived: 0 }),
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

// =============================================================================
// Bulk Operations (Multi-Edit)
// =============================================================================

/** Bulk-delete multiple contacts atomically. */
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

/** Bulk-update a set of scalar fields across multiple contacts. */
export const useBulkUpdateContacts = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, data }: { ids: string[]; data: Partial<Contact> }): Promise<{ success: boolean; count: number }> => {
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
        old?.map(c => idsSet.has(c.id) ? { ...c, ...data } : c)
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

/** Bulk-add multiple contacts to a single list. */
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

/** Upload a custom avatar image for a contact. Persists to disk in uploads/avatars/. */
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
    },
  });
};

/** Set a contact's avatar to a dicebear URL (no file upload needed). */
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
    },
  });
};
