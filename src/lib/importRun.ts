/**
 * The parts of an import the browser has to get right without React.
 *
 * Two things went wrong before this file existed. The import stream was read
 * to its end and whatever had arrived by then was shown as the result, so a
 * connection that dropped mid-way showed "Import Complete" over an import the
 * server was still writing, or had never received. And every request made
 * fresh contacts, so the natural response to that uncertainty, trying again,
 * imported the address book twice.
 *
 * The stream reader here says which of two things happened: a `done` frame
 * arrived, or the stream ended without one. Only the first is a result. The
 * storage helpers keep the import id the browser made, per account, so a
 * reload can find the import the server is still running. Both are plain
 * functions with plain tests.
 *
 * @module lib/importRun
 */
import type { ImportPhase, ImportStatus, ImportSummary } from "../api/imports";

// ---------------------------------------------------------------------------
// The stream
// ---------------------------------------------------------------------------

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
 * How the stream ended.
 *
 * `done` is the server's word that it finished, with what it found.
 * `interrupted` is the connection ending before that word, which says
 * nothing about the import: it may be running, finished, or never received.
 * The caller polls the record to find out.
 */
export type ImportStreamResult =
  | {
      kind: "done";
      importId: string;
      status: ImportStatus;
      summary: ImportSummary | null;
      count: number;
      failed: number;
      /** The server already had this import and did not run it again. */
      repeated: boolean;
    }
  | { kind: "interrupted"; importId: string | null };

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
 * Read an import stream to its `done` frame, or to its end.
 *
 * Frames are `data: <json>` lines. A line that is not JSON is skipped, as it
 * always was. Bytes are decoded as a stream, so a multi-byte character split
 * across two chunks is still one character. Reading stops at the `done`
 * frame rather than at the end of the body, so a server that leaves the
 * connection open after finishing does not hold the modal open with it.
 */
export async function readImportStream(
  response: Response,
  onProgress: (progress: ImportProgress) => void,
): Promise<ImportStreamResult> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Import stream unavailable.");
  const decoder = new TextDecoder();
  let buffer = "";
  let importId: string | null = null;

  const consume = (line: string): ImportStreamResult | null => {
    if (!line.startsWith("data: ")) return null;
    let data: unknown;
    try {
      data = JSON.parse(line.slice(6));
    } catch {
      return null;
    }
    if (!isRecord(data)) return null;
    if (typeof data.importId === "string") importId = data.importId;
    if (data.done === true) {
      return {
        kind: "done",
        importId: typeof data.importId === "string" ? data.importId : "",
        status:
          typeof data.status === "string"
            ? (data.status as ImportStatus)
            : "complete",
        summary: summaryOf(data.summary),
        count: typeof data.count === "number" ? data.count : 0,
        failed: typeof data.failed === "number" ? data.failed : 0,
        repeated: data.repeated === true,
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
  return { kind: "interrupted", importId };
}

// ---------------------------------------------------------------------------
// Remembering the import across a reload
// ---------------------------------------------------------------------------

/** What the browser keeps about the import it started. */
export interface RememberedImport {
  importId: string;
  fileName: string;
  /** Epoch milliseconds. */
  startedAt: number;
}

export const IMPORT_KEY_PREFIX = "contrack:import:";

/** The account an un-gated instance runs as, when no user id is known. */
const LOCAL_ACCOUNT = "local";

/**
 * The storage key for one account's import.
 *
 * `localStorage` is keyed by origin, not by account, so without the account
 * in the key one person signing in after another would be offered a
 * reconnect to an import that is not theirs and that the server would
 * answer 404 for. The id is encoded so a colon in it cannot read as a
 * different account.
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
    typeof parsed.fileName !== "string" ||
    typeof parsed.startedAt !== "number"
  ) {
    forgetImport(accountId);
    return null;
  }
  return {
    importId: parsed.importId,
    fileName: parsed.fileName,
    startedAt: parsed.startedAt,
  };
}

export function forgetImport(accountId: string | null | undefined): void {
  try {
    localStorage.removeItem(importKey(accountId));
  } catch {
    // Nothing to remove, or nowhere to remove it from.
  }
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

/**
 * How the modal follows an import it is no longer streaming.
 *
 * A record is asked for every `intervalMs` until its status settles. A poll
 * that cannot reach the server at all counts as a miss rather than an
 * answer, because the server may be restarting, and after `maxMisses` in a
 * row the modal stops and says so. Mutable so a test can shorten the wait.
 */
export const POLLING = {
  intervalMs: 1500,
  maxMisses: 40,
};

/** True when the status will not change again on its own. */
export function isSettled(status: ImportStatus): boolean {
  return status === "complete" || status === "failed";
}
