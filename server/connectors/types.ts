/**
 * The connector and adapter interfaces. Every source implements
 * `ConnectorAdapter`: `test` proves credentials, and `sync` yields normalized
 * events and returns a cursor. The framework does scheduling, retries, matching
 * people, writing rows, idempotency and run history; an adapter never touches
 * SQL.
 *
 * @module server/connectors/types
 */

import { z } from "zod";
import type { ConnectorKind, Participant } from "../../shared/connectors.ts";
import type { VCardInput } from "../../shared/vcard.ts";

export type { ConnectorKind, Participant };

export type SyncEvent =
  | {
      kind: "contact";
      externalId: string;
      contact: Record<string, unknown>;
      photoUrl?: string;
    }
  | {
      kind: "contact_deleted";
      externalId: string;
    }
  | {
      kind: "interaction";
      externalId: string;
      /**
       * The ids an earlier version of the adapter gave this interaction. Ingest
       * recognizes a link under one of them and moves it to `externalId`, so a
       * change of id form re-imports nothing.
       */
      legacyExternalIds?: string[];
      type: "email" | "meeting" | "message";
      title: string;
      content?: string;
      date: string;
      endsAt?: string;
      direction?: "in" | "out";
      participants: Participant[];
      raw?: unknown;
    }
  | {
      kind: "upcoming";
      externalId: string;
      title: string;
      startsAt: string;
      endsAt: string;
      participants: Participant[];
    }
  | {
      kind: "upcoming_cancelled";
      externalId: string;
    }
  | {
      kind: "progress";
      fetched: number;
      message?: string;
    };

export interface SyncContext<C = unknown, S = unknown> {
  config: C;
  secret: S | null;
  cursor: unknown | null;
  since: string; // ISO string; on first run: now minus config.lookbackDays (default 90)
  selfAddresses: { emails: string[]; phones: string[] };
  signal: AbortSignal;
  log: (msg: string) => void;
  accountId?: string;
  isContactParticipant?: (p: Participant) => boolean;
}

export interface PushContext<C = unknown, S = unknown> {
  config: C;
  secret: S | null;
  cursor: unknown | null;
  connectorCreatedAt?: string;
  contacts: Array<{
    id: string;
    addedAt?: string;
    updatedAt: string;
    isArchived?: boolean;
    vcardInput: VCardInput;
  }>;
  links: Array<{ externalId: string; localId: string | null }>;
  ingestedContactIds: ReadonlySet<string>;
  signal: AbortSignal;
  log: (msg: string) => void;
}

export interface PushResult {
  cursor: unknown | null;
  pushed: number;
  newLinks: Array<{ externalId: string; localId: string }>;
  removedExternalIds?: string[];
}

export interface ConnectorAdapter<C = unknown, S = unknown> {
  kind: ConnectorKind;
  label: string;
  description: string;
  capabilities: {
    schedule: boolean;
    oauth?: boolean;
    summaries?: boolean;
  };
  configSchema: z.ZodType<C>;
  secretSchema: z.ZodType<S> | null;
  test(
    config: C,
    secret: S | null,
  ): Promise<{
    ok: true;
    detail: string;
    addressBooks?: Array<{
      url: string;
      displayName: string;
      readOnly?: boolean;
    }>;
  }>;
  sync(ctx: SyncContext<C, S>): AsyncGenerator<SyncEvent, unknown | null>;
  push?(ctx: PushContext<C, S>): Promise<PushResult>;
}
