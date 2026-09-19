/**
 * shared/connectors.ts — Shared types and constants for Contrack Connectors.
 *
 * Used by both server (routes, services, scheduler) and client (Settings UI, timeline).
 *
 * @module shared/connectors
 */

export type ConnectorKind =
  "ics" | "imap" | "google" | "imessage" | "whatsapp_export";

export type ConnectorStatus = "active" | "paused" | "error" | "needs_reauth";

export interface Participant {
  email?: string;
  phone?: string;
  name?: string;
}

export interface RunStats {
  fetched?: number;
  interactions?: number;
  meetings?: number;
  messages?: number;
  upcoming?: number;
  contacts?: number;
  ghosts?: number;
  correspondents?: number;
  skipped?: number;
  errors?: number;
  [key: string]: unknown;
}

export interface ConnectorSummary {
  id: string;
  kind: ConnectorKind;
  name: string;
  status: ConnectorStatus;
  config: Record<string, unknown>;
  secretPresent: boolean;
  intervalMinutes: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastError: string | null;
  lastRunStats?: RunStats | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectorDetail extends ConnectorSummary {
  recentRuns: ConnectorRun[];
}

export interface ConnectorRun {
  id: string;
  connectorId: string;
  trigger: "schedule" | "manual" | "upload";
  status: "running" | "ok" | "error";
  startedAt: string;
  finishedAt: string | null;
  stats: RunStats | null;
  error: string | null;
}

export interface KindInfo {
  kind: ConnectorKind;
  label: string;
  description: string;
  configured?: boolean;
  capabilities: {
    schedule: boolean;
    upload?: { accept: string[]; maxBytes: number };
    oauth?: boolean;
    localOnly?: "darwin";
    summaries?: boolean;
  };
}

export interface Correspondent {
  connectorId: string;
  connectorName?: string;
  kind: string;
  externalId: string;
  email?: string;
  phone?: string;
  name?: string;
  localId: string | null;
  seenCount: number;
  lastSeenAt: string;
  ignoredAt: string | null;
}

export const CONNECTOR_KINDS: Record<
  ConnectorKind,
  {
    label: string;
    description: string;
    viaLabel: string;
  }
> = {
  ics: {
    label: "Calendar",
    description:
      "Sync meetings and see what is coming up from a private ICS URL.",
    viaLabel: "via Calendar",
  },
  imap: {
    label: "Mailbox (IMAP)",
    description: "Sync sent and received mail headers from any IMAP account.",
    viaLabel: "via Email",
  },
  google: {
    label: "Google Workspace",
    description: "Sync contacts, mail and calendar with Google.",
    viaLabel: "via Google",
  },
  imessage: {
    label: "iMessage",
    description: "Sync iMessage conversations from this Mac.",
    viaLabel: "via iMessage",
  },
  whatsapp_export: {
    label: "WhatsApp",
    description: "Import chats from a WhatsApp export file.",
    viaLabel: "via WhatsApp",
  },
};

/**
 * Returns the "via X" badge label for an interaction source, or null if not a connector.
 */
export function connectorViaLabel(
  source: string | null | undefined,
): string | null {
  if (!source) return null;
  if (source in CONNECTOR_KINDS) {
    return CONNECTOR_KINDS[source as ConnectorKind].viaLabel;
  }
  return null;
}
