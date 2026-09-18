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
} from "lucide-react";
import {
  parseVCard,
  parseLinkedInCSV,
  parseGoogleCSV,
  parseFacebookJSON,
  parseGenericCSV,
  type ImportedContact,
} from "../lib/importers";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, NetworkError, apiFetch } from "../api/client";
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
import { TAB_CONTAINER, tabItem } from "../lib/styles";
import { cn } from "../lib/utils";
import { motion, AnimatePresence } from "motion/react";

export interface ImportPanelProps {
  onComplete?: (summary: ImportSummary) => void;
  onClose?: () => void;
  className?: string;
}

export type ImportTab = "apple" | "linkedin" | "facebook" | "google";

export type ImportPhaseState =
  | "idle"
  | "importing"
  | "embedding"
  | "scanning"
  | "reconnecting"
  | "complete"
  | "failed"
  | "lost";

const STREAM_PHASES = ["importing", "embedding", "scanning"] as const;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export const ImportPanel = ({
  onComplete,
  onClose,
  className,
}: ImportPanelProps) => {
  const { user } = useAuth();
  const accountId = user?.id ?? null;
  const [activeTab, setActiveTab] = useState<ImportTab>("apple");
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<ImportPhaseState>("idle");
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
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
    queryClient.invalidateQueries({ queryKey: ["dedupe-suggestions-count"] });
    queryClient.invalidateQueries({ queryKey: ["dedupe-suggestions"] });
    queryClient.invalidateQueries({ queryKey: ["dedupe-merge-log"] });
  }, [queryClient]);

  const finish = useCallback(
    async (id: string, done: ImportSummary) => {
      setSummary(done);
      setPhase("complete");
      setProgress(null);
      setError(null);
      invalidate();
      onComplete?.(done);
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
            await finish(id, record.summary);
            return;
          }
          if (record.status === "failed") {
            setError(record.error ?? "The import did not finish.");
            setPhase("failed");
            setProgress(null);
            return;
          }
          if (record.status === "complete") {
            await finish(id, {
              imported: record.imported,
              autoMerged: 0,
              needsReview: 0,
              newUnique: record.imported,
              failed: record.failed,
            });
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
              setError("The server never received this import.");
              setPhase("failed");
            } else {
              setError(
                "That import is no longer on the server. Choose the file again.",
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
            setError(err instanceof Error ? err.message : String(err));
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
        setError(
          (err instanceof Error ? err.message : String(err)) ||
            "Failed to process file.",
        );
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
        result = { kind: "interrupted", importId: id };
      }

      if (
        result.kind === "done" &&
        result.status === "complete" &&
        result.summary
      ) {
        await finish(id, result.summary);
        return;
      }
      await poll(id);
    },
    [finish, poll],
  );

  const processFile = async (file: File) => {
    setError(null);
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
      const text = await file.text();

      if (file.name.endsWith(".vcf")) {
        newContacts = parseVCard(text, "apple");
      } else if (file.name.endsWith(".csv")) {
        if (activeTab === "linkedin") {
          newContacts = await parseLinkedInCSV(text);
        } else if (activeTab === "google") {
          newContacts = await parseGoogleCSV(text);
        } else {
          newContacts = await parseGenericCSV(text, activeTab);
        }
      } else if (file.name.endsWith(".json")) {
        if (activeTab === "facebook") {
          newContacts = parseFacebookJSON(text);
        } else {
          throw new Error(
            "JSON import is only supported for Facebook data exports.",
          );
        }
      } else {
        throw new Error(
          "Unsupported file format. Please upload a .vcf, .csv, or .json file.",
        );
      }

      if (newContacts.length === 0) {
        throw new Error("No valid contacts found in the file.");
      }
    } catch (err: unknown) {
      setError(
        (err instanceof Error ? err.message : String(err)) ||
          "Failed to process file.",
      );
      setPhase("idle");
      setProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const id = crypto.randomUUID();
    pendingRef.current = { id, contacts: newContacts };
    setImportId(id);
    setFileName(file.name);
    rememberImport(accountId, {
      importId: id,
      fileName: file.name,
      startedAt: Date.now(),
    });
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
        setError(err instanceof Error ? err.message : String(err));
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

  const getAcceptedFormats = () => {
    switch (activeTab) {
      case "apple":
        return ".vcf";
      case "linkedin":
        return ".csv";
      case "facebook":
        return ".json";
      case "google":
        return ".csv";
      default:
        return ".csv,.vcf,.json";
    }
  };

  const getFormatLabel = () => {
    switch (activeTab) {
      case "apple":
        return "vCard (.vcf)";
      case "linkedin":
        return "CSV (.csv)";
      case "facebook":
        return "JSON (.json)";
      case "google":
        return "CSV (.csv)";
      default:
        return ".csv, .vcf, .json";
    }
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
        return "Generating contact fingerprints…";
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
    <div className={cn("w-full space-y-6", className)}>
      {/* Tab bar */}
      {showUploadChrome && (
        <div className={cn(TAB_CONTAINER, "mb-4")}>
          {(["apple", "linkedin", "google", "facebook"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={cn(
                tabItem(activeTab === tab),
                "min-h-[44px] sm:min-h-0",
              )}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      )}

      {/* Instructions */}
      {showUploadChrome && (
        <div className="bg-surface-container-low p-5 sm:p-6 rounded-xl text-sm text-on-surface-variant">
          <h3 className="font-bold text-on-surface mb-2 flex items-center gap-2">
            <FileText className="w-4 h-4" />
            How to export from{" "}
            {activeTab === "apple"
              ? "Apple Contacts"
              : activeTab === "linkedin"
                ? "LinkedIn"
                : activeTab === "google"
                  ? "Google Contacts"
                  : "Facebook"}
          </h3>
          {activeTab === "apple" && (
            <ol className="list-decimal list-inside space-y-1 ml-1">
              <li>
                Open the <strong>Contacts</strong> app on your Mac.
              </li>
              <li>
                Select the contacts you want to export (or Cmd+A for all).
              </li>
              <li>
                Go to <strong>File &gt; Export &gt; Export vCard...</strong>
              </li>
              <li>
                Save the <strong>.vcf</strong> file and upload it below.
              </li>
            </ol>
          )}
          {activeTab === "linkedin" && (
            <ol className="list-decimal list-inside space-y-1 ml-1">
              <li>
                Go to LinkedIn <strong>Settings & Privacy</strong>.
              </li>
              <li>
                Select <strong>Data Privacy</strong> &gt;{" "}
                <strong>Get a copy of your data</strong>.
              </li>
              <li>
                Choose <strong>Connections</strong> and request archive.
              </li>
              <li>
                Download the archive, extract it, and upload the{" "}
                <strong>Connections.csv</strong> file below.
              </li>
              <li className="text-xs text-on-surface-variant mt-1">
                Fields imported: Name, Company, Position, Email, Profile URL,
                Connection Date
              </li>
            </ol>
          )}
          {activeTab === "google" && (
            <ol className="list-decimal list-inside space-y-1 ml-1">
              <li>
                Go to <strong>contacts.google.com</strong>.
              </li>
              <li>
                Click <strong>Export</strong> in the left sidebar.
              </li>
              <li>
                Select <strong>Google CSV</strong> format and click{" "}
                <strong>Export</strong>.
              </li>
              <li>
                Upload the downloaded <strong>.csv</strong> file below.
              </li>
              <li className="text-xs text-on-surface-variant mt-1">
                Fields imported: Name, multiple Emails & Phones, Company, Role,
                Address, Birthday, Notes, Website
              </li>
            </ol>
          )}
          {activeTab === "facebook" && (
            <ol className="list-decimal list-inside space-y-1 ml-1">
              <li>
                Go to Facebook <strong>Settings & Privacy</strong> &gt;{" "}
                <strong>Settings</strong>.
              </li>
              <li>
                Navigate to <strong>Accounts Center</strong> &gt;{" "}
                <strong>Your information and permissions</strong>.
              </li>
              <li>
                Select <strong>Download your information</strong>.
              </li>
              <li>
                Choose <strong>JSON</strong> format and select the{" "}
                <strong>Friends and Followers</strong> category.
              </li>
              <li>
                Download, extract, and upload the <strong>friends.json</strong>{" "}
                file below.
              </li>
              <li className="text-xs text-on-surface-variant mt-1">
                Note: Facebook only exports friend names and connection dates —
                no emails or phone numbers.
              </li>
            </ol>
          )}
        </div>
      )}

      {/* Main content area */}
      <AnimatePresence mode="wait">
        {phase === "complete" && summary ? (
          <motion.div
            key="summary"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25 }}
            className="space-y-5"
          >
            <div className="flex flex-col items-center text-center">
              <div className="bg-emerald-500/10 p-3 rounded-full mb-3">
                <CheckCircle2 className="w-8 h-8 text-success" />
              </div>
              <h3 className="font-headline font-bold text-lg text-on-surface">
                Import Complete
              </h3>
              <p className="text-sm text-on-surface-variant mt-1">
                {summary.imported} contacts processed
              </p>
            </div>

            <div className="bg-surface-container-low rounded-2xl divide-y divide-surface-container-high">
              {summary.autoMerged > 0 && (
                <div className="flex items-center gap-3 px-5 py-3.5">
                  <div className="bg-emerald-500/10 p-2 rounded-lg">
                    <GitMerge className="w-4 h-4 text-success" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-on-surface">
                      {summary.autoMerged} duplicates auto-merged
                    </p>
                    <p className="text-xs text-on-surface-variant">
                      Exact matches combined automatically
                    </p>
                  </div>
                </div>
              )}

              {summary.needsReview > 0 && (
                <div className="flex items-center gap-3 px-5 py-3.5">
                  <div className="bg-amber-500/10 p-2 rounded-lg">
                    <Search className="w-4 h-4 text-warning" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-on-surface">
                      {summary.needsReview} likely matches need review
                    </p>
                    <p className="text-xs text-on-surface-variant">
                      Possible duplicates for you to check
                    </p>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3 px-5 py-3.5">
                <div className="bg-primary/10 p-2 rounded-lg">
                  <UserPlus className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-on-surface">
                    {summary.newUnique} new unique contacts
                  </p>
                  <p className="text-xs text-on-surface-variant">
                    Added to your network
                  </p>
                </div>
              </div>

              {summary.failed > 0 && (
                <div className="px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    <div className="bg-amber-500/10 p-2 rounded-lg">
                      <AlertCircle className="w-4 h-4 text-warning" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-bold text-on-surface">
                        {summary.failed} row{summary.failed === 1 ? "" : "s"}{" "}
                        could not be imported
                      </p>
                      <p className="text-xs text-on-surface-variant">
                        Kept on the server with the reason. Retry them below.
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
              <div className="p-4 bg-red-500/10 text-error rounded-xl flex items-center gap-3 text-sm font-medium">
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
                  Review {summary.needsReview} Suggestions
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
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25 }}
            className="bg-surface-container-low rounded-2xl p-8 flex flex-col items-center justify-center text-center"
          >
            <div className="flex items-center gap-2 mb-6">
              {STREAM_PHASES.map((p, i) => (
                <div key={p} className="flex items-center gap-2">
                  <div
                    className={cn(
                      "w-2 h-2 rounded-full transition-colors duration-300",
                      phase === p
                        ? "bg-primary scale-125"
                        : STREAM_PHASES.indexOf(
                              phase as (typeof STREAM_PHASES)[number],
                            ) > i
                          ? "bg-emerald-500"
                          : "bg-surface-container-high",
                    )}
                  />
                  {i < 2 && (
                    <div
                      className={cn(
                        "w-8 h-0.5 rounded-full transition-colors duration-300",
                        STREAM_PHASES.indexOf(
                          phase as (typeof STREAM_PHASES)[number],
                        ) > i
                          ? "bg-emerald-500"
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

            <p className="font-bold text-on-surface mb-1">{getPhaseLabel()}</p>

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
                    transition={{ duration: 0.3, ease: "easeOut" }}
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
                {progress.autoMerged > 0 && progress.needsReview! > 0 && " · "}
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
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25 }}
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
          <motion.div
            key="failed"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25 }}
            className="space-y-5"
          >
            <div className="flex flex-col items-center text-center">
              <div className="bg-red-500/10 p-3 rounded-full mb-3">
                <AlertCircle className="w-8 h-8 text-error" />
              </div>
              <h3 className="font-headline font-bold text-lg text-on-surface">
                Import did not finish
              </h3>
              <p className="text-sm text-on-surface-variant mt-1">
                {fileName ? `Nothing from ${fileName} was saved.` : ""}
              </p>
            </div>
            <div className="p-4 bg-red-500/10 text-error rounded-xl flex items-center gap-3 text-sm font-medium">
              <AlertCircle className="w-5 h-5 shrink-0" />
              {error ?? "The import did not finish."}
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
                  The file is no longer in memory. Choose it again to import.
                </p>
              )}
              <button type="button" onClick={dismiss} className="btn-secondary">
                Dismiss
              </button>
            </div>
          </motion.div>
        ) : phase === "lost" ? (
          <motion.div
            key="lost"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25 }}
            className="space-y-5"
          >
            <div className="flex flex-col items-center text-center">
              <div className="bg-amber-500/10 p-3 rounded-full mb-3">
                <WifiOff className="w-8 h-8 text-warning" />
              </div>
              <h3 className="font-headline font-bold text-lg text-on-surface">
                Lost contact with the server
              </h3>
              <p className="text-sm text-on-surface-variant mt-1">
                Your import may still be running. Check again when you are back
                online. Nothing is imported twice.
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
              <button type="button" onClick={dismiss} className="btn-secondary">
                Dismiss
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="upload"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={cn(
              "bg-surface-container-low rounded-2xl p-8 flex flex-col items-center justify-center text-center transition-colors",
              "hover:bg-surface-container-high cursor-pointer border-2 border-dashed",
              isDragging ? "border-primary bg-primary/5" : "border-transparent",
            )}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input
              aria-label="Choose a file to import"
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept={getAcceptedFormats()}
              onChange={handleFileChange}
            />
            <div className="bg-surface-container-high p-4 rounded-full mb-4">
              <UploadCloud className="w-8 h-8 text-primary" />
            </div>
            <p className="font-bold text-on-surface mb-1">
              Click to upload or drag and drop
            </p>
            <p className="text-xs text-on-surface-variant">
              {getFormatLabel()} files only
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {error && phase === "idle" && (
        <div className="p-4 bg-red-500/10 text-error rounded-xl flex items-center gap-3 text-sm font-medium">
          <AlertCircle className="w-5 h-5 shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
};

export default ImportPanel;
