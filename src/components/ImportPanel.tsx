/**
 * ImportPanel — The inline import workbench.
 *
 * Extracted from ImportModal so it can be mounted inline on the Import settings
 * page (/settings/import) or inside the ImportModal opened from the contact list.
 *
 * Supports Apple (vCard), LinkedIn (CSV), Google Contacts (CSV), and Facebook (JSON).
 * Handles streaming progress, polling reconnection, error reporting, and retry.
 *
 * @module components/ImportPanel
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  UploadCloud,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Search,
  GitMerge,
  UserPlus,
  ArrowRight,
  RotateCw,
  WifiOff,
  ChevronDown,
} from "lucide-react";
import {
  SOURCE_FILES,
  parseImportFile,
  type ImportSource,
  type ImportedContact,
} from "../lib/importers";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, NetworkError, apiFetch } from "../api/client";
import { refreshDuplicates } from "../api/suggestions";
import { flyWhenClear } from "../lib/corvid";
import {
  fetchImport,
  fetchImportRows,
  retryImport,
  type ImportRecord,
  type ImportRow,
  type ImportSummary,
} from "../api/imports";
import {
  POLLING,
  forgetImport,
  readImportStream,
  recallImport,
  rememberImport,
  type ImportProgress,
  type ImportStreamResult,
} from "../lib/importRun";
import { useAuth } from "./auth/AuthGate";
import { TAB_CONTAINER, TONE_WASH, tabItem } from "../lib/styles";
import { DURATION, EASE } from "../lib/motion";
import { cn, errorText } from "../lib/utils";
import { motion, AnimatePresence } from "motion/react";

interface ImportPanelProps {
  onComplete?: (summary: ImportSummary) => void;
  onClose?: () => void;
}

type ImportTab = ImportSource;

type ImportPhaseState =
  | "idle"
  | "importing"
  | "embedding"
  | "scanning"
  | "reconnecting"
  | "complete"
  | "failed"
  | "lost";

const STREAM_PHASES = ["importing", "embedding", "scanning"] as const;

/** The source tabs' names. Brand names, so LinkedIn keeps its capital I. */
const SOURCE_LABELS: Record<ImportTab, string> = {
  apple: "Apple",
  linkedin: "LinkedIn",
  google: "Google",
  facebook: "Facebook",
};

/** Each phase's panel arrives the same way, on the slow duration. */
const PHASE_MOTION = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -12 },
  transition: { duration: DURATION.slow, ease: EASE },
};

/** The line that says what went wrong, in the error tone. */
const ERROR_BANNER = cn(
  "p-4 rounded-xl flex items-center gap-3 text-sm font-medium",
  TONE_WASH.error,
);

const IMPORT_LAST_SOURCE_KEY = "contrack.import.lastSource";
const SOURCES = Object.keys(SOURCE_LABELS) as ImportTab[];

function readInitialSource(): ImportTab {
  try {
    const saved = localStorage.getItem(IMPORT_LAST_SOURCE_KEY);
    if (saved && (SOURCES as string[]).includes(saved)) {
      return saved as ImportTab;
    }
  } catch {
    // localStorage might throw
  }
  return "apple";
}

function persistSource(source: ImportTab) {
  try {
    localStorage.setItem(IMPORT_LAST_SOURCE_KEY, source);
  } catch {
    // Gracefully handle storage errors
  }
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export const ImportPanel = ({ onComplete, onClose }: ImportPanelProps) => {
  const { user } = useAuth();
  const accountId = user?.id ?? null;
  const [activeTab, setActiveTabState] = useState<ImportTab>(readInitialSource);

  const handleTabChange = useCallback((tab: ImportTab) => {
    setActiveTabState(tab);
    persistSource(tab);
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<ImportPhaseState>("idle");
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  /** Entries of the chosen file that had no name, so were not sent. */
  const [skipped, setSkipped] = useState(0);
  /** Set when the contacts were saved but the duplicate check failed. */
  const [checkError, setCheckError] = useState<string | null>(null);
  const [failedRows, setFailedRows] = useState<ImportRow[]>([]);
  const [importId, setImportId] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const pendingRef = useRef<{ id: string; contacts: ImportedContact[] } | null>(
    null,
  );
  const pollGeneration = useRef(0);
  const phaseRef = useRef<ImportPhaseState>("idle");
  phaseRef.current = phase;

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["contacts"] });
    queryClient.invalidateQueries({ queryKey: ["imports"] });
    refreshDuplicates(queryClient);
  }, [queryClient]);

  const finish = useCallback(
    async (id: string, done: ImportSummary, failedCheck: string | null) => {
      setSummary(done);
      setCheckError(failedCheck);
      setPhase("complete");
      setProgress(null);
      setError(null);
      invalidate();
      onComplete?.(done);
      // The network grew: the corvid takes a turn round the room for it,
      // once the import's dialog is out of the way. The overlay decides
      // whether it actually flies.
      if (done.imported > 0) flyWhenClear({ kind: "swoop" });
      if (done.failed > 0) {
        try {
          setFailedRows(await fetchImportRows(id, "failed"));
        } catch {
          setFailedRows([]);
        }
      } else {
        setFailedRows([]);
      }
    },
    [invalidate, onComplete],
  );

  const poll = useCallback(
    async (id: string) => {
      const generation = ++pollGeneration.current;
      const live = () => pollGeneration.current === generation;
      setPhase("reconnecting");
      setError(null);
      let misses = 0;

      while (live()) {
        try {
          const record: ImportRecord = await fetchImport(id);
          if (!live()) return;
          misses = 0;
          if (record.status === "complete" && record.summary) {
            await finish(id, record.summary, record.error);
            return;
          }
          if (record.status === "failed") {
            setError(record.error ?? "The import did not finish");
            setPhase("failed");
            setProgress(null);
            return;
          }
          if (record.status === "complete") {
            await finish(
              id,
              {
                imported: record.imported,
                autoMerged: 0,
                needsReview: 0,
                newUnique: record.imported,
                failed: record.failed,
              },
              record.error,
            );
            return;
          }
          setProgress({
            phase: record.phase ?? "importing",
            processed: record.processed,
            total: record.total,
            message: record.message ?? undefined,
          });
        } catch (err: unknown) {
          if (!live()) return;
          if (err instanceof ApiError && err.status === 404) {
            forgetImport(accountId);
            setProgress(null);
            if (pendingRef.current?.id === id) {
              setError("The server never received this import");
              setPhase("failed");
            } else {
              setError(
                "That import is no longer on the server. Choose the file again",
              );
              setPhase("idle");
            }
            return;
          }
          if (err instanceof NetworkError) {
            misses += 1;
            if (misses >= POLLING.maxMisses) {
              setPhase("lost");
              setProgress(null);
              return;
            }
          } else {
            setError(errorText(err));
            setPhase("failed");
            setProgress(null);
            return;
          }
        }
        await sleep(POLLING.intervalMs);
      }
    },
    [accountId, finish],
  );

  const runImport = useCallback(
    async (id: string, contacts: ImportedContact[]) => {
      pollGeneration.current += 1;
      setError(null);
      setCheckError(null);
      setSummary(null);
      setFailedRows([]);
      setPhase("importing");
      setProgress({
        phase: "importing",
        processed: 0,
        total: contacts.length,
        message: "Importing contacts…",
      });

      let res: Response;
      try {
        res = await apiFetch("/contacts/bulk", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            "X-Import-Id": id,
          },
          body: JSON.stringify(contacts),
        });
      } catch (err: unknown) {
        if (err instanceof NetworkError) {
          await poll(id);
          return;
        }
        if (
          err instanceof ApiError &&
          err.status === 409 &&
          err.code === "IMPORT_IN_PROGRESS"
        ) {
          await poll(id);
          return;
        }
        setError(errorText(err) || "Could not import the file");
        setPhase("idle");
        setProgress(null);
        return;
      }

      let result: ImportStreamResult;
      try {
        result = await readImportStream(res, (p) => {
          if (p.phase !== "done") setPhase(p.phase);
          setProgress(p);
        });
      } catch {
        result = { kind: "interrupted" };
      }

      if (
        result.kind === "done" &&
        result.status === "complete" &&
        result.summary
      ) {
        // The stream's last frame has the counts but not the error of a
        // duplicate check that failed. The record has it.
        const record = await fetchImport(id).catch(() => null);
        await finish(id, result.summary, record?.error ?? null);
        return;
      }
      await poll(id);
    },
    [finish, poll],
  );

  const processFile = async (file: File) => {
    setError(null);
    setSkipped(0);
    setSummary(null);
    setFailedRows([]);
    setPhase("importing");
    setProgress({
      phase: "importing",
      processed: 0,
      total: 0,
      message: "Parsing file…",
    });

    let newContacts: ImportedContact[] = [];
    try {
      const parsed = await parseImportFile(
        file.name,
        await file.text(),
        activeTab,
      );
      newContacts = parsed.contacts;
      setSkipped(parsed.skipped);
    } catch (err: unknown) {
      setError(errorText(err) || "Could not read the file");
      setPhase("idle");
      setProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const id = crypto.randomUUID();
    pendingRef.current = { id, contacts: newContacts };
    setImportId(id);
    setFileName(file.name);
    rememberImport(accountId, { importId: id, fileName: file.name });
    if (fileInputRef.current) fileInputRef.current.value = "";
    await runImport(id, newContacts);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processFile(file);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await processFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleTryAgain = () => {
    const pending = pendingRef.current;
    if (!pending) return;
    void runImport(pending.id, pending.contacts);
  };

  const handleCheckAgain = () => {
    if (importId) void poll(importId);
  };

  const handleRetryFailedRows = async () => {
    if (!importId || isRetrying) return;
    setIsRetrying(true);
    try {
      await retryImport(importId);
      await poll(importId);
    } catch (err: unknown) {
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        err.code === "IMPORT_IN_PROGRESS"
      ) {
        await poll(importId);
      } else {
        setError(errorText(err));
      }
    } finally {
      setIsRetrying(false);
    }
  };

  const resetState = () => {
    pollGeneration.current += 1;
    pendingRef.current = null;
    setPhase("idle");
    setProgress(null);
    setSummary(null);
    setSkipped(0);
    setCheckError(null);
    setFailedRows([]);
    setError(null);
    setImportId(null);
    setFileName(null);
  };

  const dismiss = () => {
    forgetImport(accountId);
    resetState();
  };

  const handleDone = () => {
    if (summary) onComplete?.(summary);
    onClose?.();
    dismiss();
  };

  const handleReviewSuggestions = () => {
    if (summary) onComplete?.(summary);
    onClose?.();
    dismiss();
    navigate("/pulse/duplicates");
  };

  useEffect(() => {
    if (phaseRef.current === "idle" && !pendingRef.current) {
      const remembered = recallImport(accountId);
      if (remembered) {
        setImportId(remembered.importId);
        setFileName(remembered.fileName);
        void poll(remembered.importId);
      }
    }
  }, [accountId, poll]);

  useEffect(
    () => () => {
      pollGeneration.current += 1;
    },
    [],
  );

  const formats = SOURCE_FILES[activeTab];

  /** The tabs pattern: ← and → move and choose, Home and End jump. */
  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const at = SOURCES.indexOf(activeTab);
    const next =
      e.key === "ArrowRight"
        ? SOURCES[(at + 1) % SOURCES.length]
        : e.key === "ArrowLeft"
          ? SOURCES[(at - 1 + SOURCES.length) % SOURCES.length]
          : e.key === "Home"
            ? SOURCES[0]
            : e.key === "End"
              ? SOURCES[SOURCES.length - 1]
              : null;
    if (!next) return;
    e.preventDefault();
    handleTabChange(next);
    document.getElementById(`import-tab-${next}`)?.focus();
  };

  const progressPct =
    progress?.processed && progress?.total
      ? Math.round((progress.processed / Math.max(progress.total, 1)) * 100)
      : 0;

  const getPhaseLabel = (): string => {
    switch (phase) {
      case "importing":
        return progress?.message || "Importing contacts…";
      case "embedding":
        return "Preparing the contacts for search…";
      case "scanning":
        return progress?.message || "Looking for duplicates…";
      default:
        return "";
    }
  };

  const isProcessing =
    phase === "importing" || phase === "embedding" || phase === "scanning";
  const showUploadChrome = phase === "idle";
  const canTryAgain = !!importId && pendingRef.current?.id === importId;

  return (
    <div className="w-full space-y-6">
      <input
        aria-label="Choose a file to import"
        type="file"
        ref={fileInputRef}
        className="sr-only"
        tabIndex={-1}
        accept={formats.accept}
        onChange={handleFileChange}
      />
      {/* Tab bar */}
      {/* Four sources: a 2 by 2 grid on a phone, where one row does not fit */}
      {showUploadChrome && (
        <div
          className={cn(TAB_CONTAINER, "mb-4 grid grid-cols-2 sm:flex")}
          role="tablist"
          aria-label="Import sources"
        >
          {SOURCES.map((tab) => (
            <button
              key={tab}
              id={`import-tab-${tab}`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              aria-controls="import-source-panel"
              tabIndex={activeTab === tab ? 0 : -1}
              onClick={() => handleTabChange(tab)}
              onKeyDown={handleTabKeyDown}
              className={cn(
                tabItem(activeTab === tab),
                "min-h-[44px] sm:pointer-fine:min-h-0",
              )}
            >
              {SOURCE_LABELS[tab]}
            </button>
          ))}
        </div>
      )}

      {/* Main content area */}
      <div
        id="import-source-panel"
        role={showUploadChrome ? "tabpanel" : undefined}
        aria-labelledby={
          showUploadChrome ? `import-tab-${activeTab}` : undefined
        }
      >
        <AnimatePresence mode="wait" initial={false}>
          {phase === "complete" && summary ? (
            <motion.div key="summary" {...PHASE_MOTION} className="space-y-5">
              <div className="flex flex-col items-center text-center">
                <div className={cn("p-3 rounded-full mb-3", TONE_WASH.success)}>
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <h3 className="font-headline font-bold text-lg text-on-surface">
                  Import complete
                </h3>
                <p className="text-sm text-on-surface-variant mt-1">
                  {summary.imported}{" "}
                  {summary.imported === 1 ? "contact" : "contacts"} imported
                </p>
              </div>

              <div className="bg-surface-container-low rounded-2xl divide-y divide-surface-container-high">
                {summary.autoMerged > 0 && (
                  <div className="flex items-center gap-3 px-5 py-3.5">
                    <div className={cn("p-2 rounded-lg", TONE_WASH.success)}>
                      <GitMerge className="w-4 h-4" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-bold text-on-surface">
                        Merged {summary.autoMerged}{" "}
                        {summary.autoMerged === 1 ? "duplicate" : "duplicates"}{" "}
                        automatically
                      </p>
                      <p className="text-xs text-on-surface-variant">
                        Each can be undone in Merge history
                      </p>
                    </div>
                  </div>
                )}

                {summary.needsReview > 0 && (
                  <div className="flex items-center gap-3 px-5 py-3.5">
                    <div className={cn("p-2 rounded-lg", TONE_WASH.warning)}>
                      <Search className="w-4 h-4" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-bold text-on-surface">
                        {summary.needsReview} possible{" "}
                        {summary.needsReview === 1 ? "duplicate" : "duplicates"}{" "}
                        to review
                      </p>
                      <p className="text-xs text-on-surface-variant">
                        Contacts that may be the same person
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3 px-5 py-3.5">
                  <div className={cn("p-2 rounded-lg", TONE_WASH.primary)}>
                    <UserPlus className="w-4 h-4" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-on-surface">
                      {summary.newUnique} new{" "}
                      {summary.newUnique === 1 ? "contact" : "contacts"}
                    </p>
                    <p className="text-xs text-on-surface-variant">
                      Added to Network
                    </p>
                  </div>
                </div>

                {skipped > 0 && (
                  <div className="flex items-center gap-3 px-5 py-3.5">
                    <div className={cn("p-2 rounded-lg", TONE_WASH.warning)}>
                      <AlertCircle className="w-4 h-4" />
                    </div>
                    <p className="flex-1 text-sm font-bold text-on-surface">
                      {skipped} {skipped === 1 ? "entry has" : "entries have"}{" "}
                      no name and {skipped === 1 ? "was" : "were"} not imported
                    </p>
                  </div>
                )}

                {checkError && (
                  <div className="flex items-center gap-3 px-5 py-3.5">
                    <div className={cn("p-2 rounded-lg", TONE_WASH.warning)}>
                      <AlertCircle className="w-4 h-4" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-bold text-on-surface">
                        The duplicate check did not finish
                      </p>
                      <p className="text-xs text-on-surface-variant">
                        The contacts are saved. Choose Check now in Settings →
                        Duplicates to look for duplicates
                      </p>
                    </div>
                  </div>
                )}

                {summary.failed > 0 && (
                  <div className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className={cn("p-2 rounded-lg", TONE_WASH.warning)}>
                        <AlertCircle className="w-4 h-4" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-bold text-on-surface">
                          {summary.failed} row{summary.failed === 1 ? "" : "s"}{" "}
                          could not be imported
                        </p>
                        <p className="text-xs text-on-surface-variant">
                          Kept on the server with the reason. Retry them below
                        </p>
                      </div>
                    </div>
                    {failedRows.length > 0 && (
                      <ul
                        aria-label="Rows that could not be imported"
                        className="mt-3 space-y-1.5 text-xs max-h-40 overflow-y-auto"
                      >
                        {failedRows.map((row) => (
                          <li
                            key={row.index}
                            className="flex flex-wrap gap-x-2 gap-y-0.5 rounded-lg bg-surface-container-lowest px-3 py-2"
                          >
                            <span className="font-bold text-on-surface">
                              {row.name || `Row ${row.index + 1}`}
                            </span>
                            <span className="text-on-surface-variant">
                              {row.error ?? "Could not be saved"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              {error && (
                <div className={ERROR_BANNER}>
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  {error}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3 pt-1">
                {summary.failed > 0 && (
                  <button
                    type="button"
                    onClick={handleRetryFailedRows}
                    disabled={isRetrying}
                    className="btn-primary flex-1"
                  >
                    <RotateCw
                      className={cn("w-4 h-4", isRetrying && "animate-spin")}
                    />
                    Retry failed rows
                  </button>
                )}
                {summary.needsReview > 0 && (
                  <button
                    type="button"
                    onClick={handleReviewSuggestions}
                    className={cn(
                      "flex-1",
                      summary.failed > 0 ? "btn-secondary" : "btn-primary",
                    )}
                  >
                    Review {summary.needsReview} possible{" "}
                    {summary.needsReview === 1 ? "duplicate" : "duplicates"}
                    <ArrowRight className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleDone}
                  className={
                    summary.needsReview > 0 || summary.failed > 0
                      ? "btn-secondary"
                      : "btn-primary flex-1"
                  }
                >
                  Done
                </button>
              </div>
            </motion.div>
          ) : isProcessing ? (
            <motion.div
              key="processing"
              {...PHASE_MOTION}
              className="bg-surface-container-low rounded-2xl p-8 flex flex-col items-center justify-center text-center"
            >
              <div className="flex items-center gap-2 mb-6">
                {STREAM_PHASES.map((p, i) => (
                  <div key={p} className="flex items-center gap-2">
                    <div
                      className={cn(
                        "w-2 h-2 rounded-full transition-colors duration-(--dur-slow)",
                        phase === p
                          ? "bg-primary scale-125"
                          : STREAM_PHASES.indexOf(
                                phase as (typeof STREAM_PHASES)[number],
                              ) > i
                            ? "bg-success"
                            : "bg-surface-container-high",
                      )}
                    />
                    {i < 2 && (
                      <div
                        className={cn(
                          "w-8 h-0.5 rounded-full transition-colors duration-(--dur-slow)",
                          STREAM_PHASES.indexOf(
                            phase as (typeof STREAM_PHASES)[number],
                          ) > i
                            ? "bg-success"
                            : "bg-surface-container-high",
                        )}
                      />
                    )}
                  </div>
                ))}
              </div>

              <div className="relative mb-4">
                <Loader2 className="w-10 h-10 text-primary animate-spin" />
              </div>

              <p className="font-bold text-on-surface mb-1">
                {getPhaseLabel()}
              </p>

              {phase === "importing" && progress?.total ? (
                <div className="w-full max-w-xs space-y-2 mt-3">
                  <div className="flex justify-between text-xs font-bold">
                    <span className="text-on-surface-variant">Importing</span>
                    <span className="text-primary tabular-nums">
                      {progress.processed ?? 0}/{progress.total}
                    </span>
                  </div>
                  <div className="h-1.5 bg-surface-container-high rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-primary rounded-full"
                      animate={{ width: `${progressPct}%` }}
                      transition={{ duration: DURATION.slow, ease: EASE }}
                    />
                  </div>
                </div>
              ) : phase === "scanning" && progress?.autoMerged !== undefined ? (
                <p className="text-xs text-on-surface-variant mt-2">
                  {progress.autoMerged > 0 && (
                    <span className="text-success font-bold">
                      {progress.autoMerged} merged
                    </span>
                  )}
                  {progress.autoMerged > 0 &&
                    progress.needsReview! > 0 &&
                    " · "}
                  {progress.needsReview! > 0 && (
                    <span className="text-warning font-bold">
                      {progress.needsReview} to review
                    </span>
                  )}
                </p>
              ) : (
                <p className="text-xs text-on-surface-variant mt-1">
                  This may take a moment
                </p>
              )}
            </motion.div>
          ) : phase === "reconnecting" ? (
            <motion.div
              key="reconnecting"
              {...PHASE_MOTION}
              className="bg-surface-container-low rounded-2xl p-8 flex flex-col items-center justify-center text-center"
            >
              <div className="relative mb-4">
                <Loader2 className="w-10 h-10 text-primary animate-spin" />
              </div>
              <p className="font-bold text-on-surface mb-1">
                Reconnecting to your import
              </p>
              <p className="text-xs text-on-surface-variant mt-1">
                {fileName
                  ? `Checking on ${fileName} with the server…`
                  : "Checking with the server…"}
              </p>
              {progress?.message && (
                <p className="text-xs text-on-surface-variant mt-2">
                  {progress.message}
                  {progress.total
                    ? ` (${progress.processed ?? 0}/${progress.total})`
                    : ""}
                </p>
              )}
            </motion.div>
          ) : phase === "failed" ? (
            <motion.div key="failed" {...PHASE_MOTION} className="space-y-5">
              <div className="flex flex-col items-center text-center">
                <div className={cn("p-3 rounded-full mb-3", TONE_WASH.error)}>
                  <AlertCircle className="w-8 h-8" />
                </div>
                <h3 className="font-headline font-bold text-lg text-on-surface">
                  Import did not finish
                </h3>
                <p className="text-sm text-on-surface-variant mt-1">
                  {fileName ? `Nothing from ${fileName} was saved` : ""}
                </p>
              </div>
              <div className={ERROR_BANNER}>
                <AlertCircle className="w-5 h-5 shrink-0" />
                {error ?? "The import did not finish"}
              </div>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                {canTryAgain ? (
                  <button
                    type="button"
                    onClick={handleTryAgain}
                    className="btn-primary flex-1"
                  >
                    <RotateCw className="w-4 h-4" />
                    Try again
                  </button>
                ) : (
                  <p className="flex-1 text-xs text-on-surface-variant">
                    The file is no longer in memory. Choose it again to import
                  </p>
                )}
                <button
                  type="button"
                  onClick={dismiss}
                  className="btn-secondary"
                >
                  Dismiss
                </button>
              </div>
            </motion.div>
          ) : phase === "lost" ? (
            <motion.div key="lost" {...PHASE_MOTION} className="space-y-5">
              <div className="flex flex-col items-center text-center">
                <div className={cn("p-3 rounded-full mb-3", TONE_WASH.warning)}>
                  <WifiOff className="w-8 h-8" />
                </div>
                <h3 className="font-headline font-bold text-lg text-on-surface">
                  Lost contact with the server
                </h3>
                <p className="text-sm text-on-surface-variant mt-1">
                  Your import may still be running. Check again when you are
                  back online. Nothing is imported twice
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleCheckAgain}
                  className="btn-primary flex-1"
                >
                  <RotateCw className="w-4 h-4" />
                  Check again
                </button>
                <button
                  type="button"
                  onClick={dismiss}
                  className="btn-secondary"
                >
                  Dismiss
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="upload"
              initial={false}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              role="button"
              tabIndex={0}
              aria-label={`Choose a ${formats.label} file`}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              className={cn(
                "state-layer bg-surface-container-low rounded-2xl p-8 flex flex-col items-center justify-center text-center transition-colors",
                "cursor-pointer border-2 border-dashed",
                isDragging
                  ? "border-primary bg-primary/5"
                  : "border-transparent",
              )}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="bg-surface-container-high p-4 rounded-full mb-4">
                <UploadCloud className="w-8 h-8 text-primary" />
              </div>
              <p className="font-bold text-on-surface mb-1">
                Choose a file
                <span className="hidden pointer-fine:inline">
                  {" "}
                  or drop it here
                </span>
              </p>
              <p className="text-xs text-on-surface-variant">
                {formats.label} files only
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Instructions disclosure under the drop zone */}
      {showUploadChrome && (
        <details className="group bg-surface-container-low p-4 sm:p-5 rounded-xl text-sm text-on-surface-variant">
          <summary className="font-bold text-on-surface flex items-center justify-between cursor-pointer list-none select-none">
            <span className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary shrink-0" />
              How to export from{" "}
              {activeTab === "apple"
                ? "Apple Contacts"
                : activeTab === "linkedin"
                  ? "LinkedIn"
                  : activeTab === "google"
                    ? "Google Contacts"
                    : "Facebook"}
            </span>
            <ChevronDown className="w-4 h-4 text-on-surface-variant transition-transform group-open:rotate-180 shrink-0" />
          </summary>
          <div className="mt-3 pt-3 border-t border-surface-container-high/60">
            {activeTab === "apple" && (
              <ol className="list-decimal list-inside space-y-1 ml-1">
                <li>
                  Open the <strong>Contacts</strong> app on your Mac
                </li>
                <li>Select the contacts you want to export (or ⌘A for all)</li>
                <li>
                  Go to <strong>File &gt; Export &gt; Export vCard…</strong>
                </li>
                <li>
                  Save the <strong>.vcf</strong> file and upload it above
                </li>
              </ol>
            )}
            {activeTab === "linkedin" && (
              <ol className="list-decimal list-inside space-y-1 ml-1">
                <li>
                  Go to LinkedIn <strong>Settings & Privacy</strong>
                </li>
                <li>
                  Select <strong>Data privacy</strong> &gt;{" "}
                  <strong>Get a copy of your data</strong>
                </li>
                <li>
                  Choose <strong>Connections</strong> and request archive
                </li>
                <li>
                  Download the archive, extract it, and upload the{" "}
                  <strong>Connections.csv</strong> file above
                </li>
                <li className="text-xs text-on-surface-variant mt-1">
                  Fields imported: name, company, position, email, profile URL,
                  connection date
                </li>
              </ol>
            )}
            {activeTab === "google" && (
              <ol className="list-decimal list-inside space-y-1 ml-1">
                <li>
                  Go to <strong>contacts.google.com</strong>
                </li>
                <li>
                  Choose <strong>Export</strong> in the menu
                </li>
                <li>
                  Select <strong>Google CSV</strong> and choose{" "}
                  <strong>Export</strong>
                </li>
                <li>
                  Upload the downloaded <strong>.csv</strong> file above
                </li>
                <li className="text-xs text-on-surface-variant mt-1">
                  Fields imported: name, emails, phones, company, role,
                  addresses, birthday, notes, website, labels as tags
                </li>
              </ol>
            )}
            {activeTab === "facebook" && (
              <ol className="list-decimal list-inside space-y-1 ml-1">
                <li>
                  Go to Facebook <strong>Settings & Privacy</strong> &gt;{" "}
                  <strong>Settings</strong>
                </li>
                <li>
                  Navigate to <strong>Accounts Center</strong> &gt;{" "}
                  <strong>Your information and permissions</strong>
                </li>
                <li>
                  Select <strong>Download your information</strong>
                </li>
                <li>
                  Choose <strong>JSON</strong> format and select the{" "}
                  <strong>Friends and Followers</strong> category
                </li>
                <li>
                  Download, extract, and upload the{" "}
                  <strong>friends.json</strong> file above
                </li>
                <li className="text-xs text-on-surface-variant mt-1">
                  Facebook exports only friend names and connection dates, with
                  no emails or phone numbers
                </li>
              </ol>
            )}
          </div>
        </details>
      )}

      {error && phase === "idle" && (
        <div className={ERROR_BANNER}>
          <AlertCircle className="w-5 h-5 shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
};
