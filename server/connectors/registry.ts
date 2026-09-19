/**
 * server/connectors/registry.ts — Registry of connector adapters and available kinds.
 *
 * Maps connector kinds to adapters and computes available kinds based on configuration.
 *
 * @module server/connectors/registry
 */

import fs from "node:fs";
import type { ConnectorKind, KindInfo } from "../../shared/connectors.ts";
import type { ConnectorAdapter } from "./types.ts";
import { icsAdapter } from "./adapters/ics.ts";
import { imapAdapter } from "./adapters/imap.ts";
import { googleAdapter } from "./adapters/google.ts";

const adapters = new Map<ConnectorKind, ConnectorAdapter<unknown, unknown>>();

export function registerAdapter(
  adapter: ConnectorAdapter<unknown, unknown>,
): void {
  adapters.set(adapter.kind, adapter);
}

// Register connector adapters
registerAdapter(icsAdapter as unknown as ConnectorAdapter<unknown, unknown>);
registerAdapter(imapAdapter as unknown as ConnectorAdapter<unknown, unknown>);
registerAdapter(googleAdapter as unknown as ConnectorAdapter<unknown, unknown>);

export function getAdapter(
  kind: ConnectorKind | string,
): ConnectorAdapter<unknown, unknown> | undefined {
  return adapters.get(kind as ConnectorKind);
}

export function isDocker(): boolean {
  try {
    return (
      fs.existsSync("/.dockerenv") ||
      process.env.DOCKER === "true" ||
      process.env.IS_DOCKER === "true" ||
      process.env.DOCKER_CONTAINER === "true"
    );
  } catch {
    return false;
  }
}

/**
 * Returns available connector kinds for a given platform and Docker state.
 */
export function kindsFor(
  _platform: string = process.platform,
  _isDockerEnv: boolean = isDocker(),
  options: { googleConfigured?: boolean } = {},
): KindInfo[] {
  const kinds: KindInfo[] = [
    {
      kind: "ics",
      label: "Calendar",
      description:
        "Sync meetings and see what is coming up from a private ICS URL.",
      capabilities: {
        schedule: true,
      },
    },
    {
      kind: "imap",
      label: "Mailbox (IMAP)",
      description: "Sync sent and received mail headers from any IMAP account.",
      capabilities: {
        schedule: true,
        summaries: true,
      },
    },
    {
      kind: "google",
      label: "Google Workspace",
      description: "Sync contacts, mail and calendar with Google.",
      configured: options.googleConfigured ?? false,
      capabilities: {
        schedule: true,
        oauth: true,
        summaries: true,
      },
    },
  ];

  return kinds;
}
