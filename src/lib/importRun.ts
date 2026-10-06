/**
 * The parts of an import the browser must get right without React. The
 * stream reader tells a `done` frame from a stream that ended without one,
 * because only the first is a result: a dropped connection says nothing
 * about the import. The storage helpers keep the import id per account, so
 * a reload finds the import the server is still running instead of
 * importing the address book twice.
 */
import type { ImportPhase, ImportStatus, ImportSummary } from "../api/imports";

// The stream

/** One progress frame from the import stream. */
export interface ImportProgress {
  phase: ImportPhase;
  processed?: number;
  total?: number;
  message?: string;
  autoMerged?: number;
  needsReview?: number;
}

/**
 * How the stream ended. `done` is the server's word that it finished.
 * `interrupted` is the connection ending first: the import may be running,
 * finished or never received, so the caller polls the record.
 */
export type ImportStreamResult =
  | { kind: "done"; status: ImportStatus; summary: ImportSummary | null }
  | { kind: "interrupted" };

const PROGRESS_PHASES: ReadonlySet<string> = new Set([
  "importing",
  "embedding",
  "scanning",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function summaryOf(value: unknown): ImportSummary | null {
  if (!isRecord(value)) return null;
  const n = (key: string) =>
    typeof value[key] === "number" ? (value[key] as number) : 0;
  return {
    imported: n("imported"),
    autoMerged: n("autoMerged"),
    needsReview: n("needsReview"),
    newUnique: n("newUnique"),
    failed: n("failed"),
  };
}

/**
 * Read an import stream of `data: <json>` lines to its `done` frame, or to
 * its end. A line that is not JSON is skipped. The decoder streams, so a
 * character split across two chunks stays whole. Reading stops at `done`, so
 * a connection left open does not hold the modal open.
 */
export async function readImportStream(
  response: Response,
  onProgress: (progress: ImportProgress) => void,
): Promise<ImportStreamResult> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Import stream unavailable");
  const decoder = new TextDecoder();
  let buffer = "";

  const consume = (line: string): ImportStreamResult | null => {
    if (!line.startsWith("data: ")) return null;
    let data: unknown;
    try {
      data = JSON.parse(line.slice(6));
    } catch {
      return null;
    }
    if (!isRecord(data)) return null;
    if (data.done === true) {
      return {
        kind: "done",
        status:
          typeof data.status === "string"
            ? (data.status as ImportStatus)
            : "complete",
        summary: summaryOf(data.summary),
      };
    }
    if (typeof data.phase === "string" && PROGRESS_PHASES.has(data.phase)) {
      onProgress(data as unknown as ImportProgress);
    }
    return null;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        const last = consume(buffer);
        if (last) return last;
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const result = consume(line);
        if (result) return result;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return { kind: "interrupted" };
}

// Remembering the import across a reload

/** What the browser keeps about the import it started. */
interface RememberedImport {
  importId: string;
  fileName: string;
}

export const IMPORT_KEY_PREFIX = "contrack:import:";

/** The account an un-gated instance runs as, when no user id is known. */
const LOCAL_ACCOUNT = "local";

/**
 * The storage key for one account's import. `localStorage` is per origin, so
 * the account is in the key, or the next person to sign in would be offered
 * someone else's import. The id is encoded, so a colon cannot read as
 * another account.
 */
export function importKey(accountId: string | null | undefined): string {
  const account = accountId && accountId.trim() ? accountId : LOCAL_ACCOUNT;
  return `${IMPORT_KEY_PREFIX}${encodeURIComponent(account)}`;
}

export function rememberImport(
  accountId: string | null | undefined,
  entry: RememberedImport,
): void {
  try {
    localStorage.setItem(importKey(accountId), JSON.stringify(entry));
  } catch {
    // A private window or a full quota. The import still runs, and only the
    // reconnect after a reload is lost.
  }
}

/** The remembered import, or null when there is none or it is not readable. */
export function recallImport(
  accountId: string | null | undefined,
): RememberedImport | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(importKey(accountId));
  } catch {
    return null;
  }
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    forgetImport(accountId);
    return null;
  }
  if (
    !isRecord(parsed) ||
    typeof parsed.importId !== "string" ||
    parsed.importId.length === 0 ||
    typeof parsed.fileName !== "string"
  ) {
    forgetImport(accountId);
    return null;
  }
  return {
    importId: parsed.importId,
    fileName: parsed.fileName,
  };
}

export function forgetImport(accountId: string | null | undefined): void {
  try {
    localStorage.removeItem(importKey(accountId));
  } catch {
    // Nothing to remove, or nowhere to remove it from.
  }
}

/**
 * How the modal polls an import it is no longer streaming: every
 * `intervalMs` until the status settles. A poll that cannot reach the server
 * is a miss, since it may be restarting, and after `maxMisses` in a row the
 * modal stops and says so. Mutable, so a test can shorten the wait.
 */
export const POLLING = {
  intervalMs: 1500,
  maxMisses: 40,
};
