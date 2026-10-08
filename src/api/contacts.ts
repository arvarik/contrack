/** Hooks for contacts: reads, writes and bulk changes, with optimistic cache updates. */
import { toast } from "sonner";
import {
  contactQuery,
  followPin,
  invalidateContactViews,
  patchContactCaches,
  refreshContact,
  storeContact,
  writeContactInOrder,
} from "./contactCache";
import {
  queryOptions,
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { STALE_TIMES } from "../lib/queryConfig";
import { corvidReact } from "../lib/corvid";
import {
  type Contact,
  type ContactUpdateData,
  type ParsedContactData,
  type TrashedContact,
} from "../types";
import { isValidLatLng, type MapContact } from "../../shared/geo";
import { dayInZone } from "../../shared/dates";
import { contactRoutes } from "../../shared/contracts/contacts";
import { trashRoutes } from "../../shared/contracts/trash";
import type { BodyOf } from "../../shared/contracts/route";
import { apiFetch, apiJson, jsonBody } from "./client";
import { GEO_STATUS_KEY } from "./geo";
import { watchNewContact } from "../lib/mergeNotice";
import { errorText } from "../lib/utils";

/**
 * The one fetcher for the `['contacts']` query. Every reader shares its cache
 * slot and projects its own shape with `select`.
 */
export const fetchContactsSlim = async (context?: {
  signal?: AbortSignal;
}): Promise<Contact[]> =>
  // The slim view sends `SlimContact` rows, with bare emails and phones and
  // empty child arrays. The views read them as Contacts.
  (await apiJson(contactRoutes.list, "/contacts?view=slim", {
    signal: context?.signal,
  })) as Contact[];

/**
 * The slim contact list. The gate asks for it beside its first `/status`
 * (AuthGate), so the first page does not wait one more round trip.
 */
export const contactsQuery = queryOptions({
  queryKey: ["contacts"],
  queryFn: fetchContactsSlim,
  staleTime: 600_000, // 10 minutes, so going back to Network is instant
});

export const useContacts = () => useQuery(contactsQuery);

/**
 * The name-and-avatar projection, for mentions, the palette and the like.
 * The score and the last contact are for the avatar's ring, which shows no
 * score for a contact never contacted (`contactScore` in shared/scoreBand).
 */
export interface ContactSlim {
  id: string;
  name: string;
  avatarUrl: string | null;
  themeColor: string;
  isGhost: boolean;
  isTracked: boolean;
  relationshipScore: number | null;
  lastContactedAt: string | null;
}

/**
 * The projections are module functions, not inline arrows: TanStack Query
 * reruns `select` for each new function, so an inline one walks every
 * contact on each render.
 */
type SlimContacts = Awaited<ReturnType<typeof fetchContactsSlim>>;

const toContactNames = (contacts: SlimContacts): ContactSlim[] =>
  contacts.map((c) => ({
    id: c.id,
    name: c.name,
    avatarUrl: c.avatarUrl,
    themeColor: c.themeColor,
    isGhost: c.isGhost,
    isTracked: c.isTracked,
    relationshipScore: c.relationshipScore ?? null,
    lastContactedAt: c.lastContactedAt,
  }));

export const useContactNames = () => {
  return useQuery({
    queryKey: ["contacts"],
    queryFn: fetchContactsSlim,
    staleTime: 600_000,
    select: toContactNames,
  });
};

/**
 * The projection `useInstantSearch()` searches on each keystroke, in the
 * browser, from the same cache as `useContacts`.
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
  isTracked: boolean;
  cadenceDays: number;
  trackedAt: string | null;
  tags: { tag: string }[];
  lists?: { id: string; name: string }[];
  /** For `missing:email` and `missing:phone`, which match everybody without them. */
  emails?: { email: string }[];
  phones?: { phone: string }[];
  approximate?: boolean;
  matchType?: "exact" | "approximate";
}

const toSearchContacts = (contacts: SlimContacts): SlimSearchContact[] =>
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
      isTracked: c.isTracked,
      cadenceDays: c.cadenceDays,
      trackedAt: c.trackedAt,
      tags: c.tags ?? [],
      lists: c.lists ?? [],
      emails: c.emails,
      phones: c.phones,
    }));

export const useSlimContactsForSearch = () => {
  return useQuery({
    queryKey: ["contacts"],
    queryFn: fetchContactsSlim,
    staleTime: 600_000,
    select: toSearchContacts,
  });
};

export const useContact = (id: string | undefined) =>
  useQuery({ ...contactQuery(id ?? ""), enabled: !!id });

/** Exported for the map filter's tests. */
export const toMapContacts = (contacts: SlimContacts): MapContact[] =>
  contacts
    .filter((c) => !c.isGhost && !c.isArchived && isValidLatLng(c.lat, c.lng))
    .map((c) => ({
      id: c.id,
      name: c.name,
      company: c.company,
      role: c.role,
      industry: c.industry,
      location: c.location,
      avatarUrl: c.avatarUrl,
      themeColor: c.themeColor,
      lat: c.lat as number,
      lng: c.lng as number,
      relationshipScore: c.relationshipScore ?? null,
      lastContactedAt: c.lastContactedAt,
      isTracked: c.isTracked,
      nextFollowUpAt: c.nextFollowUpAt,
      cadenceDays: c.cadenceDays,
      interactionCount: c.interactionCount ?? 0,
      tags: (c.tags || []).map((t) => (typeof t === "string" ? t : t.tag)),
      lists: (c.lists || []).map((l) => ({ id: l.id, name: l.name })),
      geoSource: c.geoSource,
      // The same arrays as the slim row, not copies: the facets only read them.
      updatedAt: c.updatedAt,
      emails: c.emails,
      phones: c.phones,
    }));

export const useMapContacts = () => {
  return useQuery({
    queryKey: ["contacts"],
    queryFn: fetchContactsSlim,
    staleTime: 600_000,
    select: toMapContacts,
  });
};

export const useArchivedContacts = () => {
  return useQuery({
    queryKey: ["contacts", "archived"],
    queryFn: async ({ signal }): Promise<Contact[]> =>
      (await apiJson(contactRoutes.archived, "/contacts/archived", {
        signal,
      })) as Contact[],
    staleTime: STALE_TIMES.archived,
  });
};

export const useCreateContact = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: ContactUpdateData): Promise<Contact> =>
      (await apiJson(
        contactRoutes.create,
        "/contacts",
        jsonBody(data),
      )) as Contact,
    onSuccess: (contact) => {
      // Somebody new: the corvid hops.
      corvidReact("hop");
      invalidateContactViews(queryClient);
      if (!isValidLatLng(contact.lat, contact.lng))
        followPin(queryClient, contact);
      // The check a few seconds later can merge it into one that existed.
      watchNewContact(queryClient, contact);
    },
  });
};

export const useParseContactText = () => {
  return useMutation({
    mutationFn: async (text: string): Promise<ParsedContactData> => {
      // Today on this device, so "yesterday" in the text is the user's.
      const res = await apiFetch("/parse-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, today: dayInZone(new Date()) }),
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
      writeContactInOrder(
        id,
        async () =>
          (await apiJson(
            contactRoutes.replace,
            `/contacts/${encodeURIComponent(id)}`,
            jsonBody(data),
          )) as Contact,
      ),
    onSuccess: (contact, { data }) => {
      // A new address can move the pin after the answer has left the server.
      if ("location" in data || "addresses" in data)
        followPin(queryClient, contact);
    },
    onError: (error) =>
      toast.error(`Could not save contact: ${errorText(error)}`),
    // After an error too: a write that timed out may still have landed.
    onSettled: (contact, _error, { id }) =>
      refreshContact(queryClient, contact ?? id),
  });
};

/**
 * The body of `PATCH /api/contacts/:id/location`: a pin a person dropped, or
 * a request to hand the pin back to the geocoder.
 */
type ContactLocationInput = BodyOf<typeof contactRoutes.location>;

/**
 * Moves a contact's pin by hand, or hands it back to the geocoder. The
 * answer, the whole contact, goes into both caches.
 */
export const useSetContactLocation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: ContactLocationInput;
    }): Promise<Contact> =>
      writeContactInOrder(
        id,
        async () =>
          (await apiJson(
            contactRoutes.location,
            `/contacts/${encodeURIComponent(id)}/location`,
            jsonBody(data),
          )) as Contact,
      ),
    onSuccess: (contact, { data }) => {
      storeContact(queryClient, contact);
      void queryClient.invalidateQueries({ queryKey: GEO_STATUS_KEY });
      if ("regeocode" in data && !isValidLatLng(contact.lat, contact.lng))
        followPin(queryClient, contact);
    },
    onError: (error) =>
      toast.error(`Could not move the pin: ${errorText(error)}`),
  });
};

/**
 * "Not this person": take back what one research run added, and leave its
 * pages out of later runs. The answer holds the whole contact, and it goes
 * straight into both caches.
 */
export const useRejectResearchRun = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, runAt }: { id: string; runAt: string }) =>
      writeContactInOrder(
        id,
        async () =>
          (await apiJson(
            contactRoutes.rejectResearchRun,
            `/contacts/${encodeURIComponent(id)}/research/reject`,
            jsonBody({ runAt }),
          )) as { removed: number; contact: Contact },
      ),
    onSuccess: ({ contact }) => storeContact(queryClient, contact),
    onError: (error) =>
      toast.error(`Could not take back that search: ${errorText(error)}`),
  });
};

/** The body of `PATCH /api/contacts/:id` when a person tracks or untracks. */
interface SetTrackedInput {
  id: string;
  isTracked: boolean;
  /**
   * The cadence to keep. An Undo of an untrack sends the one the contact
   * had. Left out, a flip to tracked takes the account's default cadence.
   */
  cadenceDays?: number;
}

/**
 * Tracks or untracks one contact. The flag lands in both caches before the
 * server answers, and the answer (with the cadence and a fresh score)
 * replaces it. A failed write puts both caches back.
 */
export const useSetTracked = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      isTracked,
      cadenceDays,
    }: SetTrackedInput): Promise<Contact> =>
      writeContactInOrder(
        id,
        async () =>
          (await apiJson(
            contactRoutes.patch,
            `/contacts/${encodeURIComponent(id)}`,
            jsonBody(
              cadenceDays === undefined
                ? { isTracked }
                : { isTracked, cadenceDays },
            ),
          )) as Contact,
      ),
    onMutate: ({ id, isTracked, cadenceDays }) =>
      patchContactCaches(queryClient, id, {
        isTracked,
        trackedAt: isTracked ? new Date().toISOString() : null,
        ...(cadenceDays === undefined ? {} : { cadenceDays }),
      }),
    onSuccess: (contact, { isTracked }) => {
      // Tracked: the corvid cocks its head at them. It keeps an eye out now.
      if (isTracked) corvidReact("cock");
    },
    onError: (error, _input, rollback) => {
      rollback?.();
      toast.error(`Could not change tracking: ${errorText(error)}`);
    },
    onSettled: (contact, _error, { id }) =>
      refreshContact(queryClient, contact ?? id),
  });
};

/** Change how often a person wants to keep up with one tracked contact. */
export const useSetCadence = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      cadenceDays,
    }: {
      id: string;
      cadenceDays: number;
    }): Promise<Contact> =>
      writeContactInOrder(
        id,
        async () =>
          (await apiJson(
            contactRoutes.patch,
            `/contacts/${encodeURIComponent(id)}`,
            jsonBody({ cadenceDays }),
          )) as Contact,
      ),
    onMutate: ({ id, cadenceDays }) =>
      patchContactCaches(queryClient, id, { cadenceDays }),
    onError: (error, _input, rollback) => {
      rollback?.();
      toast.error(`Could not change the cadence: ${errorText(error)}`);
    },
    onSettled: (contact, _error, { id }) =>
      refreshContact(queryClient, contact ?? id),
  });
};

interface TrashResponse {
  items: TrashedContact[];
  retentionDays: number;
}

/** Trashed (soft-deleted) contacts, newest deletions first. */
export const useTrash = () => {
  return useQuery({
    queryKey: ["trash"],
    queryFn: async ({ signal }): Promise<TrashResponse> => {
      const res = await apiFetch("/trash", { signal });
      const data = await res.json();
      return {
        items: (data.items ?? []) as TrashedContact[],
        retentionDays: Number(data.retentionDays) || 30,
      };
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

/** Delete every contact in the Trash forever ("Empty trash"). */
export const useEmptyTrash = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiJson(trashRoutes.empty, "/trash"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trash"] });
    },
  });
};

/** Restore a trashed contact (deletes are soft, and Trash keeps them for its retention). */
export const useRestoreContact = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<Contact> => {
      const res = await apiFetch(`/trash/${id}/restore`, { method: "POST" });
      return res.json();
    },
    onSuccess: () => {
      // Back from the trash: a nod.
      corvidReact("nod");
      invalidateContactViews(queryClient);
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
    },
  });
};

export const useDeleteContact = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiJson(contactRoutes.delete, `/contacts/${id}`),
    onSettled: (_data, error, id) => {
      if (!error) {
        queryClient.removeQueries({ queryKey: ["contacts", id] });
        queryClient.removeQueries({ queryKey: ["timeline", id] });
      }
      invalidateContactViews(queryClient);
    },
  });
};

export const useArchiveContact = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiJson(
        contactRoutes.replace,
        `/contacts/${id}`,
        jsonBody({ isArchived: true }),
      ),
    onSettled: () => invalidateContactViews(queryClient),
  });
};

export const useUnarchiveContact = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiJson(
        contactRoutes.replace,
        `/contacts/${id}`,
        jsonBody({ isArchived: false }),
      ),
    onSettled: () => invalidateContactViews(queryClient),
  });
};

export const useBulkDeleteContacts = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) =>
      apiJson(
        contactRoutes.bulkDelete,
        "/contacts/bulk-delete",
        jsonBody({ ids }),
      ),
    onSettled: () => {
      invalidateContactViews(queryClient);
    },
  });
};

export const useBulkUpdateContacts = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, data }: { ids: string[]; data: ContactUpdateData }) =>
      apiJson(
        contactRoutes.bulkUpdate,
        "/contacts/bulk-update",
        jsonBody({ ids, data }),
      ),
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
      return (await apiJson(
        contactRoutes.avatar,
        `/contacts/${contactId}/avatar`,
        {
          body: formData,
        },
      )) as Contact;
    },
    onSuccess: (contact) => void refreshContact(queryClient, contact),
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
    }): Promise<Contact> =>
      (await apiJson(
        contactRoutes.replace,
        `/contacts/${contactId}`,
        jsonBody({ avatarUrl }),
      )) as Contact,
    onSuccess: (contact) => void refreshContact(queryClient, contact),
  });
};
