/**
 * Administration API hooks.
 *
 * Backs Settings → Administration: the accounts on this instance, the
 * invitations that create them, the two instance settings, the audit log, and
 * the database snapshots.
 *
 * Every endpoint here is class `admin` on the server and answers a member
 * with `403 ADMIN_REQUIRED`. `RequireAdmin` hides the UI; that 403 is what
 * actually stops anyone. The two are not the same guard and this module
 * assumes only the second.
 *
 * One rule shapes the read hooks: an admin sees *about* an account, never
 * *into* it. The list carries how many contacts each account holds and never
 * a contact. The single exception is the export, which exists for the day
 * somebody leaves and writes an audit row naming the account it read.
 *
 * @module api/admin
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch, apiJson, jsonBody } from "./client";

// ---------------------------------------------------------------------------
// Shapes — these mirror the server exactly. See server/services/adminService.
// ---------------------------------------------------------------------------

export type UserRole = "admin" | "member";

export interface AdminUser {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  role: string;
  /** 'active' | 'disabled'. */
  status: string;
  /** 'password', or 'none' for the local owner nobody signs in as. */
  credentialState: string;
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  passwordChangedAt: string | null;
  /** Contacts the account can see today. Trashed rows are not counted. */
  contactCount: number;
  sessionCount: number;
  tokenCount: number;
  /** The account nobody can sign in to, which owns this device's data. */
  isLocalOwner: boolean;
  isSelf: boolean;
}

/** What an account owns, as the delete confirmation reports it. */
export interface OwnedCounts {
  contacts: number;
  interactions: number;
  lists: number;
  files: number;
}

export interface Invitation {
  id: string;
  email: string | null;
  role: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  acceptedBy: string | null;
  revokedAt: string | null;
  invitedBy: string;
}

export interface InstanceSettings {
  registrationOpen: boolean;
  sessionTtlDays: number;
  sessionTtlRange: { min: number; max: number; default: number };
}

export interface AuditEntry {
  id: string;
  actor: { id: string; username: string } | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

export interface AuditPage {
  entries: AuditEntry[];
  /**
   * The cursor for the next page, or null at the end.
   *
   * Opaque, and deliberately not a bare timestamp: `createdAt` has
   * one-second resolution, so a timestamp cursor skips every row that shares
   * a second with the last row of the page.
   */
  nextBefore: string | null;
}

export interface BackupInfo {
  filename: string;
  sizeBytes: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const adminKeys = {
  users: ["admin", "users"] as const,
  user: (id: string) => ["admin", "users", id] as const,
  invitations: ["admin", "invitations"] as const,
  settings: ["admin", "settings"] as const,
  audit: ["admin", "audit"] as const,
  backups: ["admin", "backups"] as const,
};

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export const useAdminUsers = () =>
  useQuery({
    queryKey: adminKeys.users,
    queryFn: ({ signal }) =>
      apiJson<{ users: AdminUser[] }>("/admin/users", { signal }).then(
        (data) => data.users,
      ),
    staleTime: 15_000,
  });

/** One account with what it owns. Used by the delete confirmation. */
export const useAdminUser = (id: string | null) =>
  useQuery({
    queryKey: adminKeys.user(id ?? ""),
    queryFn: ({ signal }) =>
      apiJson<{ user: AdminUser; counts: OwnedCounts }>(
        `/admin/users/${encodeURIComponent(id!)}`,
        { signal },
      ),
    enabled: !!id,
  });

/**
 * Invalidate everything an account change can touch.
 *
 * A role change moves an account in and out of the admin count, a disable
 * ends its sessions, and every one of them writes an audit row. Refreshing
 * the list alone leaves the log a page behind, which is the one view somebody
 * checks precisely because they are not sure what happened.
 */
function useAccountsChanged() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: adminKeys.users });
    qc.invalidateQueries({ queryKey: adminKeys.audit });
  };
}

export const useCreateUser = () => {
  const changed = useAccountsChanged();
  return useMutation({
    mutationFn: (input: {
      email: string;
      username: string;
      displayName?: string;
      role: UserRole;
    }) =>
      // No `temporaryPassword`: the server generates twenty characters from a
      // 62-character alphabet, and an admin typing one they thought of is the
      // reason instances end up with three accounts sharing a password.
      apiJson<{ user: AdminUser; temporaryPassword: string }>("/admin/users", {
        method: "POST",
        ...jsonBody(input),
      }),
    onSuccess: changed,
  });
};

export const useUpdateUser = () => {
  const changed = useAccountsChanged();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      role?: UserRole;
      displayName?: string | null;
    }) =>
      apiJson<{ user: AdminUser }>(`/admin/users/${encodeURIComponent(id)}`, {
        method: "PATCH",
        ...jsonBody(body),
      }),
    onSuccess: changed,
  });
};

export const useResetPassword = () => {
  const changed = useAccountsChanged();
  return useMutation({
    mutationFn: (id: string) =>
      apiJson<{ temporaryPassword: string }>(
        `/admin/users/${encodeURIComponent(id)}/reset-password`,
        { method: "POST" },
      ),
    onSuccess: changed,
  });
};

export const useSetUserEnabled = () => {
  const changed = useAccountsChanged();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      apiJson<{ user: AdminUser }>(
        `/admin/users/${encodeURIComponent(id)}/${enabled ? "enable" : "disable"}`,
        { method: "POST" },
      ),
    onSuccess: changed,
  });
};

/**
 * Delete an account.
 *
 * Two steps, and the first one is a refusal. Called without a decision the
 * server answers `409 USER_HAS_DATA` carrying what the account owns, which is
 * how the confirmation dialog knows the four numbers to show. Only a call
 * that says `purge` removes anything.
 */
export const useDeleteUser = () => {
  const changed = useAccountsChanged();
  return useMutation({
    mutationFn: ({ id, purge }: { id: string; purge: boolean }) =>
      apiJson<{ deleted: true; counts: OwnedCounts }>(
        `/admin/users/${encodeURIComponent(id)}`,
        { method: "DELETE", ...jsonBody(purge ? { decision: "purge" } : {}) },
      ),
    onSuccess: changed,
  });
};

/**
 * Download one account's data.
 *
 * Fetched and turned into a blob rather than linked to directly. A plain
 * `<a href>` leaves the browser to render whatever comes back, so an expired
 * session would open a tab containing a JSON error instead of signing the
 * admin back in — and the shared client, which is what notices that, would
 * never have seen the request.
 */
export async function downloadUserExport(
  id: string,
  username: string,
): Promise<void> {
  const res = await apiFetch(`/admin/users/${encodeURIComponent(id)}/export`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `contrack-export-${username}-${new Date()
    .toISOString()
    .slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on the next tick: revoking synchronously races the download in
  // Safari, which reads the blob after the click handler returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

export const useInvitations = () =>
  useQuery({
    queryKey: adminKeys.invitations,
    queryFn: ({ signal }) =>
      apiJson<{ invitations: Invitation[] }>("/admin/invitations", {
        signal,
      }).then((data) => data.invitations),
    staleTime: 15_000,
  });

export const useCreateInvitation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      email?: string | null;
      role: UserRole;
      expiresInDays?: number;
    }) =>
      // `link` is in this response and nowhere else. The database holds only
      // the SHA-256 of the secret inside it.
      apiJson<{ id: string; link: string; expiresAt: string }>(
        "/admin/invitations",
        { method: "POST", ...jsonBody(input) },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminKeys.invitations });
      qc.invalidateQueries({ queryKey: adminKeys.audit });
    },
  });
};

export const useRevokeInvitation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiJson<{ revoked: true }>(
        `/admin/invitations/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminKeys.invitations });
      qc.invalidateQueries({ queryKey: adminKeys.audit });
    },
  });
};

/** pending | accepted | revoked | expired, derived the way the server does. */
export function invitationState(
  invitation: Invitation,
  now: number = Date.now(),
): "pending" | "accepted" | "revoked" | "expired" {
  if (invitation.acceptedAt) return "accepted";
  if (invitation.revokedAt) return "revoked";
  if (new Date(invitation.expiresAt).getTime() <= now) return "expired";
  return "pending";
}

// ---------------------------------------------------------------------------
// Instance settings
// ---------------------------------------------------------------------------

export const useInstanceSettings = () =>
  useQuery({
    queryKey: adminKeys.settings,
    queryFn: ({ signal }) =>
      apiJson<InstanceSettings>("/admin/settings", { signal }),
    staleTime: 30_000,
  });

export const useUpdateInstanceSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      registrationOpen?: boolean;
      sessionTtlDays?: number;
    }) =>
      apiJson<InstanceSettings>("/admin/settings", {
        method: "PUT",
        ...jsonBody(input),
      }),
    onSuccess: (settings) => {
      qc.setQueryData(adminKeys.settings, settings);
      qc.invalidateQueries({ queryKey: adminKeys.audit });
      // `/api/auth/status` reports `registrationOpen` to the sign-in screen,
      // and the gate reads it from there. Nothing else refreshes it.
      qc.invalidateQueries({ queryKey: ["auth"] });
    },
  });
};

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

const AUDIT_PAGE_SIZE = 50;

/**
 * The log, newest first, a page at a time.
 *
 * An infinite query rather than an offset one: rows arrive while somebody is
 * reading, and an offset would show them the same row twice and skip another.
 * The cursor is what the previous page returned.
 */
export const useAuditLog = (actions: readonly string[] | null) => {
  // The key must carry the filter, or the unfiltered pages already in the
  // cache are served for a filtered view.
  const filter = actions?.length ? [...actions].sort().join(",") : null;
  return useInfiniteQuery({
    queryKey: [...adminKeys.audit, filter ?? "all"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: String(AUDIT_PAGE_SIZE) });
      if (pageParam) params.set("before", pageParam);
      // Filtered in SQL, not here. Narrowing a fetched page would show two
      // sign-ins out of fifty rows with no way to reach the rest.
      if (filter) params.set("action", filter);
      return apiJson<AuditPage>(`/admin/audit?${params}`, { signal });
    },
    getNextPageParam: (last) => last.nextBefore,
    staleTime: 10_000,
  });
};

/**
 * The actions the log records, grouped the way somebody looks for them.
 *
 * Nobody arrives asking for `user.invitation.revoked`. They arrive asking
 * "what happened to the accounts" or "who has been signing in", so the filter
 * offers those and expands to the exact list the server validates against.
 */
export const AUDIT_GROUPS = [
  {
    key: "accounts",
    label: "Accounts",
    actions: [
      "user.created",
      "user.role.changed",
      "user.disabled",
      "user.enabled",
      "user.password.reset",
      "user.deleted",
      "user.exported",
    ],
  },
  {
    key: "invitations",
    label: "Invitations",
    actions: [
      "user.invited",
      "user.invitation.accepted",
      "user.invitation.revoked",
    ],
  },
  {
    key: "sign-in",
    label: "Sign-in",
    actions: [
      "auth.login.success",
      "auth.login.failed",
      "auth.logout",
      "auth.password.changed",
    ],
  },
  {
    key: "tokens",
    label: "Tokens",
    actions: ["auth.token.created", "auth.token.revoked"],
  },
  {
    key: "instance",
    label: "Instance",
    actions: ["settings.changed", "backup.created"],
  },
] as const;

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

export const useBackups = () =>
  useQuery({
    queryKey: adminKeys.backups,
    queryFn: ({ signal }) =>
      apiJson<{ backups: BackupInfo[] }>("/backups", { signal }).then(
        (data) => data.backups,
      ),
    staleTime: 30_000,
  });

export const useCreateBackup = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiJson<BackupInfo>("/backups", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminKeys.backups });
      qc.invalidateQueries({ queryKey: adminKeys.audit });
    },
  });
};
