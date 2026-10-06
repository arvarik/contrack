/**
 * Hooks for Settings → Administration: accounts, invitations, instance
 * settings, the audit log and snapshots.
 *
 * Every endpoint is class `admin` and answers a member with `403
 * ADMIN_REQUIRED`. `RequireAdmin` only hides the UI. The 403 is the guard.
 *
 * An admin sees about an account, never into it: counts, not contacts. The
 * one exception is the export, which writes an audit row naming the account.
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch, apiJson, jsonBody } from "./client";
import { emitAuthStatusStale } from "../lib/appEvents";

// Shapes. These mirror server/services/adminService exactly.

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
  avatarUrl: string | null;
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
  /** What this instance calls itself, or "" when nobody has named it. */
  instanceName: string;
  instanceNameMax: number;
  mailConfigured?: boolean;
  /** Mail is set up and PUBLIC_URL is set, so a mail can carry a link. */
  mailLinksReady?: boolean;
  magicLinkSignIn?: boolean;
  trashRetentionDays?: number;
  trashRetentionDaysSource?: "setting" | "env" | "default";
  backupIntervalHours?: number;
  backupIntervalHoursSource?: "setting" | "env" | "default";
  backupKeep?: number;
  backupKeepSource?: "setting" | "env" | "default";
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

interface AuditPage {
  entries: AuditEntry[];
  /**
   * The cursor for the next page, or null at the end. Opaque, not a
   * timestamp: `createdAt` has one-second resolution, so a timestamp cursor
   * skips rows that share the last row's second.
   */
  nextBefore: string | null;
}

/**
 * What opening a snapshot found. Each snapshot is read back once written:
 * opened read only, put through `PRAGMA quick_check`, and counted against the
 * live database, so an empty snapshot is caught before a restore.
 */
export interface BackupVerification {
  ok: boolean;
  checkedAt: string;
  /** `PRAGMA quick_check`, "ok" when the file is sound. */
  integrity: string;
  /** Row counts inside the snapshot, by table. */
  rows: Record<string, number>;
  /** The same counts in the live database when the check ran. */
  liveRows: Record<string, number>;
  /** Why `ok` is false. Absent when it is true. */
  problem?: string;
}

export interface BackupInfo {
  filename: string;
  sizeBytes: number;
  createdAt: string;
  /** Null for a snapshot with no check on record. That is not a failed check. */
  verification: BackupVerification | null;
}

// Instance health

/** An account named by something other than its id. */
export interface HealthAccount {
  id: string;
  username: string;
}

export interface InstanceHealth {
  uptimeSeconds: number;
  startedAt: string;
  schema: {
    migration: string | null;
    migrationExpected: string;
    fts: number;
    ftsExpected: number;
    vec: string;
    upToDate: boolean;
  };
  database: {
    bytes: number;
    walBytes: number;
    truncateAtBytes: number;
    lastCheckpoint: {
      at: string;
      mode: "passive" | "truncate";
      busy: boolean;
      logPages: number;
      checkpointedPages: number;
      bytesBefore: number;
      bytesAfter: number;
    } | null;
    busyErrors: number;
    lastBusyErrorAt: string | null;
    startedAt: string;
    rows: Record<string, number>;
  };
  backup: BackupInfo | null;
  queues: {
    dedupe: { running: HealthAccount | null; pending: HealthAccount[] };
    aiSearch: {
      running: HealthAccount | null;
      activeBatches: number;
      contactsRemaining: number;
    };
  };
  embeddings: {
    available: boolean;
    byUser: { user: HealthAccount; contacts: number; embedded: number }[];
  };
  aiCache: Record<
    string,
    { entries: number; hits: number; misses: number; hitRate: number }
  >;
  provider: {
    /** What each kind of AI work runs on now. Null when nothing can serve it. */
    capabilities: Record<
      "quick" | "deep" | "research",
      { providerId: string; model: string | null } | null
    >;
    /** Gemini models paused after a 429, a 5xx or a timeout. */
    circuitBreakers: string[];
    /** Grounded Gemini requests sent today. */
    grounding: { rpd: number };
    /** Google answered the Gemini key with a free-tier quota error. */
    freeTier: boolean;
  };
}

const adminKeys = {
  users: ["admin", "users"] as const,
  invitations: ["admin", "invitations"] as const,
  settings: ["admin", "settings"] as const,
  audit: ["admin", "audit"] as const,
  backups: ["admin", "backups"] as const,
  health: ["admin", "health"] as const,
  mail: ["admin", "mail"] as const,
  integrations: ["admin", "integrations"] as const,
};

// Accounts

export const useAdminUsers = () =>
  useQuery({
    queryKey: adminKeys.users,
    queryFn: ({ signal }) =>
      apiJson<{ users: AdminUser[] }>("/admin/users", { signal }).then(
        (data) => data.users,
      ),
    staleTime: 15_000,
  });

/**
 * Invalidates everything an account change can touch, the audit log
 * included: every change writes an audit row.
 */
function useAccountsChanged() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: adminKeys.users });
    qc.invalidateQueries({ queryKey: adminKeys.audit });
    // A deleted account's invitations go too (ON DELETE CASCADE).
    qc.invalidateQueries({ queryKey: adminKeys.invitations });
    // The caller may have demoted themselves, and nothing caches
    // `/api/auth/status`.
    emitAuthStatusStale();
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
      // No `temporaryPassword`: the server generates a random one, so no two
      // accounts share a password an admin made up.
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

export const useSendResetLink = () => {
  const changed = useAccountsChanged();
  return useMutation({
    mutationFn: (id: string) =>
      apiJson<{ sentTo: string; expiresAt: string }>(
        `/admin/users/${encodeURIComponent(id)}/reset-link`,
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
 * Deletes an account in two steps. Without `purge` the server answers `409
 * USER_HAS_DATA` with what the account owns, for the confirmation dialog.
 * Only a call with `purge` removes anything.
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
 * Downloads a server file (an account's data or a snapshot) as `filename`.
 * Fetched as a blob, not linked, so an expired session reaches the shared
 * client and signs the admin back in instead of opening a JSON error.
 */
export async function downloadFile(
  path: string,
  filename: string,
): Promise<void> {
  const res = await apiFetch(path);
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on the next tick: revoking synchronously races the download in
  // Safari, which reads the blob after the click handler returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// Invitations

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
      send?: boolean;
    }) =>
      // `link` is in this response only. The database holds its SHA-256.
      apiJson<{
        id: string;
        link: string;
        expiresAt: string;
        sent: boolean;
      }>("/admin/invitations", { method: "POST", ...jsonBody(input) }),
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

// Instance settings

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
      instanceName?: string;
      magicLinkSignIn?: boolean;
      trashRetentionDays?: number;
      backupIntervalHours?: number;
      backupKeep?: number;
    }) =>
      apiJson<InstanceSettings>("/admin/settings", {
        method: "PUT",
        ...jsonBody(input),
      }),
    onSuccess: (settings) => {
      qc.setQueryData(adminKeys.settings, settings);
      qc.invalidateQueries({ queryKey: adminKeys.audit });
      // The gate holds `registrationOpen` and `instanceName` from
      // `/api/auth/status` in state, not in the query cache, so it must
      // re-read them.
      emitAuthStatusStale();
    },
  });
};

// Integrations

/** The General page's integrations. SearXNG is on Administration → AI. */
interface IntegrationsConfig {
  googleOAuth: {
    configured: boolean;
    source: "setting" | "env" | "none";
    clientId: string | null;
    clientSecretPreview: string | null;
  };
}

interface UpdateIntegrationsInput {
  googleOAuth?: { clientId: string; clientSecret: string } | null;
}

export const useIntegrations = () =>
  useQuery({
    queryKey: adminKeys.integrations,
    queryFn: ({ signal }) =>
      apiJson<IntegrationsConfig>("/admin/integrations", { signal }),
    staleTime: 30_000,
  });

export const useUpdateIntegrations = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateIntegrationsInput) =>
      apiJson<IntegrationsConfig>("/admin/integrations", {
        method: "PUT",
        ...jsonBody(input),
      }),
    onSuccess: (data) => {
      qc.setQueryData(adminKeys.integrations, data);
      qc.invalidateQueries({ queryKey: adminKeys.audit });
    },
  });
};

// Audit log

const AUDIT_PAGE_SIZE = 50;

/**
 * The log, newest first, a page at a time. A cursor, not an offset, because
 * rows arrive while somebody reads, and an offset would repeat and skip rows.
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
      // Filtered in SQL, not here: a filtered page would hide the rest.
      if (filter) params.set("action", filter);
      return apiJson<AuditPage>(`/admin/audit?${params}`, { signal });
    },
    getNextPageParam: (last) => last.nextBefore,
    staleTime: 10_000,
  });
};

/**
 * The logged actions in the groups a person looks for, such as "who has
 * been signing in". Each group expands to the exact actions the server
 * validates against.
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
      "auth.password.reset",
      "auth.magic_link.used",
    ],
  },
  {
    key: "tokens",
    label: "Tokens",
    actions: [
      "auth.token.created",
      "auth.token.revoked",
      "auth.oauth.granted",
      "auth.oauth.denied",
      "auth.oauth.refresh_reused",
    ],
  },
  {
    key: "instance",
    label: "Instance",
    actions: [
      "settings.changed",
      "backup.created",
      "mail.settings.changed",
      "mail.test.sent",
      "integrations.changed",
    ],
  },
] as const;

// Backups

export const useBackups = () =>
  useQuery({
    queryKey: adminKeys.backups,
    queryFn: ({ signal }) =>
      apiJson<{ backups: BackupInfo[] }>("/backups", { signal }).then(
        (data) => data.backups,
      ),
    staleTime: 30_000,
  });

/**
 * The instance health panel, refetched every fifteen seconds because its
 * numbers move: running scans, the write-ahead log, refused requests.
 */
export const useInstanceHealth = () =>
  useQuery({
    queryKey: adminKeys.health,
    queryFn: ({ signal }) =>
      apiJson<InstanceHealth>("/admin/health", { signal }),
    staleTime: 5_000,
    refetchInterval: 15_000,
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

// Mail

interface MailConfig {
  source: "env" | "settings" | "none";
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  replyTo: string;
  hasPassword: boolean;
  /**
   * The PUBLIC_URL that mailed links point at, or null when it is not set. The
   * server sends no sign-in, reset or invitation link by mail while it is null.
   */
  publicUrl?: string | null;
}

interface UpdateMailInput {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
  replyTo?: string;
}

export const useMailConfig = () =>
  useQuery({
    queryKey: adminKeys.mail,
    queryFn: ({ signal }) => apiJson<MailConfig>("/admin/mail", { signal }),
    staleTime: 15_000,
  });

export const useUpdateMailConfig = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateMailInput) =>
      apiJson<MailConfig>("/admin/mail", {
        method: "PUT",
        ...jsonBody(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminKeys.mail });
      qc.invalidateQueries({ queryKey: adminKeys.settings });
      qc.invalidateQueries({ queryKey: adminKeys.audit });
    },
  });
};

export const useDeleteMailConfig = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiJson<{ deleted: true }>("/admin/mail", {
        method: "DELETE",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminKeys.mail });
      qc.invalidateQueries({ queryKey: adminKeys.settings });
      qc.invalidateQueries({ queryKey: adminKeys.audit });
    },
  });
};

export const useSendTestMail = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body?: { to?: string }) =>
      apiJson<{ sentTo: string }>("/admin/mail/test", {
        method: "POST",
        ...jsonBody(body ?? {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminKeys.audit });
    },
  });
};
