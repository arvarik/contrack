/**
 * The connector adapters by kind, and which kinds the configuration offers.
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

/**
 * Whether the server runs in a container, for `GET /api/connectors/kinds`:
 * Docker writes /.dockerenv and Podman writes /run/.containerenv.
 */
export function isDocker(): boolean {
  try {
    return fs.existsSync("/.dockerenv") || fs.existsSync("/run/.containerenv");
  } catch {
    return false;
  }
}

/** The connector kinds this server offers. Every kind runs everywhere. */
export function kindsFor(
  options: { googleConfigured?: boolean } = {},
): KindInfo[] {
  const kinds: KindInfo[] = [
    {
      kind: "ics",
      label: "Calendar",
      description:
        "Sync meetings and see what is coming up from a private ICS URL",
      capabilities: {
        schedule: true,
      },
    },
    {
      kind: "imap",
      label: "Mailbox (IMAP)",
      description: "Sync sent and received mail headers from any IMAP account",
      capabilities: {
        schedule: true,
        summaries: true,
      },
    },
    {
      kind: "google",
      label: "Google Workspace",
      description: "Sync contacts, mail and calendar with Google",
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
