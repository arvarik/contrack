import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ActionItem } from '../types';

const API_BASE = '/api';

export const useActionItems = (contactId?: string) => {
  return useQuery({
    queryKey: contactId ? ['actionItems', contactId] : ['actionItems'],
    queryFn: async (): Promise<ActionItem[]> => {
      const url = contactId 
        ? `${API_BASE}/contacts/${contactId}/action-items`
        : `${API_BASE}/action-items`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch action items');
      return res.json();
    }
  });
};

export const useCompletedActionItems = () => {
  return useQuery({
    queryKey: ['actionItems', 'completed'],
    queryFn: async (): Promise<ActionItem[]> => {
      const res = await fetch(`${API_BASE}/action-items/completed`);
      if (!res.ok) throw new Error('Failed to fetch completed action items');
      return res.json();
    }
  });
};

export const useUrgentActionItemCount = () => {
  return useQuery({
    queryKey: ['actionItems', 'urgentCount'],
    queryFn: async (): Promise<{ count: number }> => {
      const res = await fetch(`${API_BASE}/action-items/count`);
      if (!res.ok) throw new Error('Failed to fetch urgent count');
      return res.json();
    },
    // We poll this occasionally or rely on invalidation from mutations
    staleTime: 1000 * 60 * 5, // 5 mins
  });
};

export const useAddActionItem = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ contactId, data }: { contactId: string; data: { title: string; dueAt: string } }): Promise<ActionItem> => {
      const res = await fetch(`${API_BASE}/contacts/${contactId}/action-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to create action item');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['actionItems'] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
};

export const useUpdateActionItem = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { title?: string; dueAt?: string } }): Promise<ActionItem> => {
      const res = await fetch(`${API_BASE}/action-items/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to update action item');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['actionItems'] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
};

export const useCompleteActionItem = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<ActionItem> => {
      const res = await fetch(`${API_BASE}/action-items/${id}/complete`, {
        method: 'PATCH',
      });
      if (!res.ok) throw new Error('Failed to complete action item');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['actionItems'] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
};

export const useDeleteActionItem = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<{ success: boolean }> => {
      const res = await fetch(`${API_BASE}/action-items/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete action item');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['actionItems'] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
};
