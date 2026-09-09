import { toast } from "sonner";
import { invalidateContactViews, writeContactInOrder } from "./contactCache";
/**
 * Contact API Hooks — React Query hooks for all contact CRUD operations.
 *
 * Provides `useContacts`, `useContact`, `useCreateContact`, `useUpdateContact`,
 * `useDeleteContact`, and bulk operations with optimistic cache updates.
 *
 * @module api/contacts
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { STALE_TIMES } from "../lib/queryConfig";
import {
  Contact,
  ContactUpdateData,
  ParsedContactData,
  TrashedContact,
} from "../types";
import { apiFetch } from "./client";

/**
 * Canonical fetcher for the `['contacts']` query — the single source of truth
 * shared by `useContacts`, `useContactNames`, `useSlimContactsForSearch`, and
 * the cold-boot prefetch in main.tsx. All consumers share one cache slot and
 * project their own shape via `select`.
 */
export const fetchContactsSlim = async (context?: {
  signal?: AbortSignal;
}): Promise<Contact[]> => {
  const start = performance.now();
  const res = await apiFetch("/contacts?view=slim", {
    signal: context?.signal,
  });
  const data: Contact[] = await res.json();
  const duration = performance.now() - start;
  if (import.meta.env.DEV) {
    console.log(
      `[Perf] fetchContactsSlim: fetch took ${duration.toFixed(2)}ms, items=${data.length}`,
    );
  }
  return data;
};

export const useContacts = () => {
  return useQuery({
    queryKey: ["contacts"],
    queryFn: fetchContactsSlim,
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
    queryKey: ["contacts"],
    queryFn: fetchContactsSlim,
    staleTime: 600_000,
    select: (contacts): ContactSlim[] =>
      contacts.map((c) => ({
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
    queryKey: ["contacts"],
    queryFn: fetchContactsSlim,
    staleTime: 600_000,
    select: (contacts): SlimSearchContact[] =>
      contacts
        .filter((c) => !c.isGhost && !c.isArchived)
        .map((c) => ({
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
    queryKey: ["contacts", id],
    queryFn: async ({ signal }): Promise<Contact> => {
      const res = await apiFetch(`/contacts/${id}`, { signal });
      return res.json();
    },
    enabled: !!id,
    staleTime: STALE_TIMES.contactDetail,
  });
};

export const useMapContacts = () => {
  return useQuery({
    queryKey: ["contacts", "map"],
    queryFn: async ({
      signal,
    }): Promise<(Partial<Contact> & { lat: number; lng: number })[]> => {
      const res = await apiFetch("/contacts/map", { signal });
      return res.json();
    },
    staleTime: STALE_TIMES.mapData,
  });
};

export const useArchivedContacts = () => {
  return useQuery({
    queryKey: ["contacts", "archived"],
    queryFn: async ({ signal }): Promise<Contact[]> => {
      const res = await apiFetch("/contacts/archived", { signal });
      return res.json();
    },
    staleTime: STALE_TIMES.archived,
  });
};

export const useCreateContact = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: ContactUpdateData): Promise<Contact> => {
      const res = await apiFetch("/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      return res.json();
    },
    onSuccess: () => {
      invalidateContactViews(queryClient);
    },
  });
};

export const useParseContactText = () => {
  return useMutation({
    mutationFn: async (text: string): Promise<ParsedContactData> => {
      const res = await apiFetch("/parse-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      return res.json();
    },
  });
};

export const useUpdateContact = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: ContactUpdateData;
    }): Promise<Contact> =>
      writeContactInOrder(id, async () => {
        const res = await apiFetch(`/contacts/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        return res.json();
      }),
    onSuccess: (contact) => {
      queryClient.setQueryData(["contacts", contact.id], contact);
      queryClient.setQueryData<Contact[]>(["contacts"], (old) =>
        old?.map((c) => (c.id === contact.id ? { ...c, ...contact } : c)),
      );
    },
    onError: (error) => toast.error(`Could not save contact: ${error.message}`),
    onSettled: () => invalidateContactViews(queryClient),
  });
};

/** Trashed (soft-deleted) contacts, newest deletions first. */
export const useTrash = () => {
  return useQuery({
    queryKey: ["trash"],
    queryFn: async ({ signal }): Promise<TrashedContact[]> => {
      const res = await apiFetch("/trash", { signal });
      const data = await res.json();
      return data.items as TrashedContact[];
    },
    staleTime: 15_000,
  });
};

/** Permanently delete a trashed contact ("delete forever"). */
export const usePurgeTrashedContact = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<{ success: boolean }> => {
      const res = await apiFetch(`/trash/${id}`, { method: "DELETE" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trash"] });
    },
  });
};

/** Restore a trashed contact (deletes are soft — 30-day trash window). */
export const useRestoreContact = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<Contact> => {
      const res = await apiFetch(`/trash/${id}/restore`, { method: "POST" });
      return res.json();
    },
    onSuccess: () => {
      invalidateContactViews(queryClient);
      queryClient.invalidateQueries({ queryKey: ["trash"] });
    },
  });
};

/** Restore many trashed contacts at once — the undo path for a bulk delete. */
export const useBulkRestoreContacts = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]): Promise<{ count: number }> => {
      const res = await apiFetch("/trash/bulk-restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      return res.json();
    },
    onSuccess: () => {
      invalidateContactViews(queryClient);
      queryClient.invalidateQueries({ queryKey: ["trash"] });
    },
  });
};

export const useDeleteContact = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      id: string,
    ): Promise<{ success: boolean; message: string }> => {
      const res = await apiFetch(`/contacts/${id}`, {
        method: "DELETE",
      });
      return res.json();
    },
    onSettled: (_data, error, id) => {
      if (!error) {
        queryClient.removeQueries({ queryKey: ["contacts", id] });
        queryClient.removeQueries({ queryKey: ["timeline", id] });
      }
      invalidateContactViews(queryClient);
      queryClient.invalidateQueries({ queryKey: ["trash"] });
    },
  });
};

export const useArchiveContact = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`/contacts/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isArchived: true }),
      });
      return res.json();
    },
    onSettled: (_data, _error, id) => {
      queryClient.invalidateQueries({ queryKey: ["contacts", id] });
      invalidateContactViews(queryClient);
      queryClient.invalidateQueries({ queryKey: ["contacts", "archived"] });
    },
  });
};

export const useUnarchiveContact = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`/contacts/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isArchived: false }),
      });
      return res.json();
    },
    onSettled: (_data, _error, id) => {
      queryClient.invalidateQueries({ queryKey: ["contacts", id] });
      invalidateContactViews(queryClient);
      queryClient.invalidateQueries({ queryKey: ["contacts", "archived"] });
    },
  });
};

export const useBulkDeleteContacts = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      ids: string[],
    ): Promise<{ success: boolean; count: number }> => {
      const res = await apiFetch("/contacts/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      return res.json();
    },
    onSettled: () => {
      invalidateContactViews(queryClient);
    },
  });
};

export const useBulkUpdateContacts = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      ids,
      data,
    }: {
      ids: string[];
      data: ContactUpdateData;
    }): Promise<{ success: boolean; count: number }> => {
      const res = await apiFetch("/contacts/bulk-update", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, data }),
      });
      return res.json();
    },
    onSettled: () => {
      invalidateContactViews(queryClient);
    },
  });
};

export const useUploadAvatar = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      contactId,
      file,
    }: {
      contactId: string;
      file: File;
    }): Promise<Contact> => {
      const formData = new FormData();
      formData.append("avatar", file);
      const res = await apiFetch(`/contacts/${contactId}/avatar`, {
        method: "POST",
        body: formData,
      });
      return res.json();
    },
    onSuccess: (_data, { contactId }) => {
      invalidateContactViews(queryClient);
      queryClient.invalidateQueries({ queryKey: ["contacts", contactId] });
    },
  });
};

export const useSetDicebearAvatar = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      contactId,
      avatarUrl,
    }: {
      contactId: string;
      avatarUrl: string;
    }): Promise<Contact> => {
      const res = await apiFetch(`/contacts/${contactId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl }),
      });
      return res.json();
    },
    onSuccess: (_data, { contactId }) => {
      invalidateContactViews(queryClient);
      queryClient.invalidateQueries({ queryKey: ["contacts", contactId] });
    },
  });
};
