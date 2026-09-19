/**
 * server/connectors/types.ts — Core interfaces for Contrack connectors and adapters.
 *
 * Every source implements `ConnectorAdapter`: `test` proves credentials,
 * `sync` yields normalized events and returns a cursor. The framework owns
 * scheduling, retries, matching people, writing rows, idempotency, and run history.
 * An adapter never touches SQL.
 *
 * @module server/connectors/types
 */

import { z } from "zod";
import type { ConnectorKind, Participant } from "../../shared/connectors.ts";

export type { ConnectorKind, Participant };

export type SyncEvent =
  | {
      kind: "contact";
      externalId: string;
      contact: Record<string, unknown>;
      photoUrl?: string;
    }
  | {
      kind: "interaction";
      externalId: string;
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

export interface ConnectorAdapter<C = unknown, S = unknown> {
  kind: ConnectorKind;
  label: string;
  description: string;
  capabilities: {
    schedule: boolean;
    upload?: { accept: string[]; maxBytes: number };
    oauth?: boolean;
    localOnly?: "darwin";
    summaries?: boolean;
  };
  configSchema: z.ZodType<C>;
  secretSchema: z.ZodType<S> | null;
  test(config: C, secret: S | null): Promise<{ ok: true; detail: string }>;
  sync(ctx: SyncContext<C, S>): AsyncGenerator<SyncEvent, unknown | null>;
}
