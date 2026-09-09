import { invalidateContactViews } from "./contactCache";
import { apiFetch } from "./client";
/**
 * Interaction API Hooks — React Query hooks for timeline and interaction operations.
 *
 * Provides `useTimeline`, `useAddInteraction`, `useDeleteInteraction`,
 * `useAddAttachment`, `useGenerateBriefing`, and `usePromoteGhost` with
 * optimistic updates for a responsive timeline UI.
 *
 * @module api/interactions
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { STALE_TIMES } from "../lib/queryConfig";
import { Interaction, Contact } from "../types";

export const useTimeline = (contactId: string | undefined) => {
  return useQuery({
    queryKey: ["timeline", contactId],
    queryFn: async ({ signal }): Promise<Interaction[]> => {
      const res = await apiFetch(`/contacts/${contactId}/timeline`, { signal });
      if (!res.ok) throw new Error("Failed to fetch timeline");
      return res.json();
    },
    enabled: !!contactId,
    staleTime: STALE_TIMES.timeline,
  });
};

export const useAddInteraction = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      contactId,
      data,
    }: {
      contactId: string;
      data: Partial<Interaction>;
    }): Promise<Interaction> => {
      const res = await apiFetch(`/contacts/${contactId}/interactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to add interaction");
      return res.json();
    },
    onSettled: (_data, _error, { contactId }) => {
      queryClient.invalidateQueries({ queryKey: ["timeline", contactId] });
      invalidateContactViews(queryClient);
    },
  });
};

export const useDeleteInteraction = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
    }: {
      id: string;
      contactId: string;
    }): Promise<{ success: boolean; message: string }> => {
      const res = await apiFetch(`/interactions/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete interaction");
      return res.json();
    },
    onSettled: (_data, _error, { contactId }) => {
      queryClient.invalidateQueries({ queryKey: ["timeline", contactId] });
      invalidateContactViews(queryClient);
    },
  });
};

export const useUpdateInteraction = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      contactId: string;
      data: { title?: string; content?: string | null };
    }): Promise<Interaction> => {
      const res = await apiFetch(`/interactions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update interaction");
      return res.json();
    },
    onSettled: (_data, _error, { contactId }) => {
      queryClient.invalidateQueries({ queryKey: ["timeline", contactId] });
      invalidateContactViews(queryClient);
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

      const res = await apiFetch(`/contacts/${contactId}/attachments`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error("Failed to upload attachment");
      return res.json();
    },
    onSuccess: (_data, { contactId }) => {
      queryClient.invalidateQueries({ queryKey: ["timeline", contactId] });
      invalidateContactViews(queryClient);
      queryClient.invalidateQueries({ queryKey: ["contacts", contactId] });
    },
  });
};

export const useGenerateBriefing = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (contactId: string): Promise<string[]> => {
      const res = await apiFetch(`/contacts/${contactId}/briefing`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to generate briefing");
      const data = await res.json();
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
    mutationFn: async (contactId: string): Promise<Contact> => {
      const res = await apiFetch(`/contacts/${contactId}/promote`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to promote ghost contact");
      return res.json();
    },
    onSuccess: () => {
      invalidateContactViews(queryClient);
      queryClient.invalidateQueries({ queryKey: ["timeline"] });
    },
  });
};
