/**
 * Imports API client.
 *
 * An import has an account-scoped id that the browser makes when a file is
 * chosen, and the server keeps a durable record under it. These three calls
 * are how the browser finds that record again after the connection that
 * started the import is gone: the status to poll, the rows that failed, and
 * the retry that re-runs them.
 *
 * Through `apiJson` like the rest of the app, so a `401` here reaches
 * AuthGate and a `404` is an `ApiError` the modal can read the status off.
 *
 * @module api/imports
 */
import { apiJson } from "./client";
import { useQuery } from "@tanstack/react-query";

/**
 * Where an import is.
 *
 * `running` is before anything is committed. `imported` is after the
 * contacts are committed and while the duplicate check runs. `complete` is
 * the end, with a summary. `failed` means nothing was imported and the same
 * request is safe to send again under the same id.
 */
export type ImportStatus = "running" | "imported" | "complete" | "failed";

export type ImportPhase = "importing" | "embedding" | "scanning" | "done";

export interface ImportSummary {
  imported: number;
  autoMerged: number;
  needsReview: number;
  newUnique: number;
  /** Rows the server could not write. Each is kept and can be retried. */
  failed: number;
}

/** One import as `GET /api/imports/:id` describes it. */
export interface ImportRecord {
  id: string;
  status: ImportStatus;
  phase: ImportPhase | null;
  message: string | null;
  total: number;
  processed: number;
  imported: number;
  failed: number;
  /** Set once the status is `complete`, null before. */
  summary: ImportSummary | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/** One row of an import, as `GET /api/imports/:id/rows` lists it. */
export interface ImportRow {
  index: number;
  status: "failed" | "done";
  name: string;
  error: string | null;
  contactId: string | null;
}

export interface ImportRetryResult {
  importId: string;
  status: ImportStatus;
  retried: number;
  imported: number;
  failed: number;
}

const path = (id: string) => `/imports/${encodeURIComponent(id)}`;

export const fetchImports = async (): Promise<ImportRecord[]> => {
  const data = await apiJson<{ imports: ImportRecord[] }>("/imports");
  return data.imports;
};

export const useImports = () =>
  useQuery({
    queryKey: ["imports"],
    queryFn: fetchImports,
    refetchInterval: (query) => {
      const hasActive = query.state.data?.some(
        (imp) => imp.status === "running" || imp.status === "imported",
      );
      return hasActive ? 2500 : false;
    },
  });

export const fetchImport = (id: string): Promise<ImportRecord> =>
  apiJson<ImportRecord>(path(id));

export const fetchImportRows = async (
  id: string,
  status: ImportRow["status"] = "failed",
  limit = 200,
): Promise<ImportRow[]> => {
  const query = new URLSearchParams({ status, limit: String(limit) });
  const data = await apiJson<{ rows: ImportRow[] }>(
    `${path(id)}/rows?${query.toString()}`,
  );
  return data.rows;
};

export const retryImport = (id: string): Promise<ImportRetryResult> =>
  apiJson<ImportRetryResult>(`${path(id)}/retry`, { method: "POST" });
