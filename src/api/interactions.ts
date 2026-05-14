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

const API_BASE = "/api";

export const useTimeline = (contactId: string | undefined) => {
  return useQuery({
    queryKey: ["timeline", contactId],
    queryFn: async (): Promise<Interaction[]> => {
      const res = await fetch(`${API_BASE}/contacts/${contactId}/timeline`);
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
      const res = await fetch(
        `${API_BASE}/contacts/${contactId}/interactions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
      );
      if (!res.ok) throw new Error("Failed to add interaction");
      return res.json();
    },
    onMutate: async ({ contactId, data }) => {
      await queryClient.cancelQueries({ queryKey: ["timeline", contactId] });
      const previousTimeline = queryClient.getQueryData<Interaction[]>([
        "timeline",
        contactId,
      ]);

      const optimisticInteraction: Interaction = {
        id: `temp-${Date.now()}`,
        contactId,
        type: data.type as Interaction["type"],
        title: data.title || "",
        content: data.content || null,
        date: new Date().toISOString(),
        duration: data.duration || null,
      };

      queryClient.setQueryData<Interaction[]>(
        ["timeline", contactId],
        (old) => {
          return [optimisticInteraction, ...(old || [])];
        },
      );

      return { previousTimeline };
    },
    onError: (_err, { contactId }, context) => {
      if (context?.previousTimeline) {
        queryClient.setQueryData(
          ["timeline", contactId],
          context.previousTimeline,
        );
      }
    },
    onSettled: (_data, _error, { contactId }) => {
      queryClient.invalidateQueries({ queryKey: ["timeline", contactId] });
      queryClient.invalidateQueries({ queryKey: ["contacts", contactId] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
};

export const useDeleteInteraction = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      contactId,
    }: {
      id: string;
      contactId: string;
    }): Promise<{ success: boolean; message: string }> => {
      const res = await fetch(`${API_BASE}/interactions/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete interaction");
      return res.json();
    },
    onMutate: async ({ id, contactId }) => {
      await queryClient.cancelQueries({ queryKey: ["timeline", contactId] });
      const previousTimeline = queryClient.getQueryData<Interaction[]>([
        "timeline",
        contactId,
      ]);

      queryClient.setQueryData<Interaction[]>(["timeline", contactId], (old) =>
        old?.filter((item) => item.id !== id),
      );

      return { previousTimeline };
    },
    onError: (_err, { contactId }, context) => {
      if (context?.previousTimeline) {
        queryClient.setQueryData(
          ["timeline", contactId],
          context.previousTimeline,
        );
      }
    },
    onSettled: (_data, _error, { contactId }) => {
      queryClient.invalidateQueries({ queryKey: ["timeline", contactId] });
    },
  });
};

export const useUpdateInteraction = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      contactId,
      data,
    }: {
      id: string;
      contactId: string;
      data: { title?: string; content?: string };
    }): Promise<Interaction> => {
      const res = await fetch(`${API_BASE}/interactions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update interaction");
      return res.json();
    },
    onMutate: async ({ id, contactId, data }) => {
      await queryClient.cancelQueries({ queryKey: ["timeline", contactId] });
      const previousTimeline = queryClient.getQueryData<Interaction[]>([
        "timeline",
        contactId,
      ]);

      queryClient.setQueryData<Interaction[]>(["timeline", contactId], (old) =>
        old?.map((item) => (item.id === id ? { ...item, ...data } : item)),
      );

      return { previousTimeline };
    },
    onError: (_err, { contactId }, context) => {
      if (context?.previousTimeline) {
        queryClient.setQueryData(
          ["timeline", contactId],
          context.previousTimeline,
        );
      }
    },
    onSettled: (_data, _error, { contactId }) => {
      queryClient.invalidateQueries({ queryKey: ["timeline", contactId] });
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

      const res = await fetch(`${API_BASE}/contacts/${contactId}/attachments`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error("Failed to upload attachment");
      return res.json();
    },
    onSuccess: (_data, { contactId }) => {
      queryClient.invalidateQueries({ queryKey: ["timeline", contactId] });
      queryClient.invalidateQueries({ queryKey: ["contacts", contactId] });
    },
  });
};

export const useGenerateBriefing = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (contactId: string): Promise<string[]> => {
      const res = await fetch(`${API_BASE}/contacts/${contactId}/briefing`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to generate briefing");
      const data = await res.json();
      return data.points;
    },
    onSuccess: (_, contactId) => {
      queryClient.invalidateQueries({ queryKey: ["contacts", contactId] });
      queryClient.invalidateQueries({ queryKey: ["timeline", contactId] });
    },
  });
};

export const usePromoteGhost = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (contactId: string): Promise<Contact> => {
      const res = await fetch(`${API_BASE}/contacts/${contactId}/promote`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to promote ghost contact");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["timeline"] });
    },
  });
};
