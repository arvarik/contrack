import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from './ui/Modal';
import { UploadCloud, FileText, CheckCircle2, AlertCircle, Loader2, Search, GitMerge, UserPlus, ArrowRight } from 'lucide-react';
import Papa from 'papaparse';
import { parseVCard, parseLinkedInCSV, parseGoogleCSV, parseFacebookJSON, parseGenericCSV } from '../lib/importers';
import { useQueryClient } from '@tanstack/react-query';
import { Contact } from '../types';
import { TAB_CONTAINER, tabItem, SECTION_BG } from '../lib/styles';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type ImportTab = 'apple' | 'linkedin' | 'facebook' | 'google';

/** Import phase for the multi-step SSE pipeline. */
type ImportPhase = 'idle' | 'importing' | 'embedding' | 'scanning' | 'complete';

interface ImportSummary {
  imported: number;
  autoMerged: number;
  needsReview: number;
  newUnique: number;
}

interface StreamProgress {
  phase: ImportPhase;
  processed?: number;
  total?: number;
  message?: string;
  autoMerged?: number;
  needsReview?: number;
}

/**
 * Bulk-create contacts via SSE for progress tracking.
 * Returns the full import summary including deduplication results.
 * Falls back to standard JSON POST for small batches (< 20 contacts).
 */
async function bulkImportWithProgress(
  contacts: Partial<Contact>[],
  onProgress: (p: StreamProgress) => void,
): Promise<{ count: number; summary?: ImportSummary }> {
  // Always stream — the multi-phase pipeline (import → embedding → scan) needs SSE
  const useStream = true;

  const res = await fetch('/api/contacts/bulk', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(useStream ? { Accept: 'text/event-stream' } : {}),
    },
    body: JSON.stringify(contacts),
  });

  if (!res.ok) throw new Error('Failed to import contacts');

  if (useStream && res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: { count: number; summary?: ImportSummary } = { count: 0 };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.done) {
              result = { count: data.count, summary: data.summary };
            } else {
              onProgress(data);
            }
          } catch {}
        }
      }
    }
    return result;
  } else {
    const data = await res.json();
    return { count: data.count };
  }
}

export const ImportModal = ({ isOpen, onClose, onSuccess }: ImportModalProps) => {
  const [activeTab, setActiveTab] = useState<ImportTab>('apple');
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<ImportPhase>('idle');
  const [progress, setProgress] = useState<StreamProgress | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const resetState = () => {
    setPhase('idle');
    setProgress(null);
    setSummary(null);
    setError(null);
    setIsUploading(false);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setError(null);
    setSummary(null);
    setPhase('importing');
    setProgress({ phase: 'importing', processed: 0, total: 0, message: 'Parsing file…' });

    try {
      const text = await file.text();
      let newContacts: Partial<Contact>[] = [];

      if (file.name.endsWith('.vcf')) {
        newContacts = parseVCard(text, 'apple');
      } else if (file.name.endsWith('.csv')) {
        if (activeTab === 'linkedin') {
          newContacts = await parseLinkedInCSV(text);
        } else if (activeTab === 'google') {
          newContacts = await parseGoogleCSV(text);
        } else {
          newContacts = await parseGenericCSV(text, activeTab);
        }
      } else if (file.name.endsWith('.json')) {
        if (activeTab === 'facebook') {
          newContacts = parseFacebookJSON(text);
        } else {
          throw new Error('JSON import is only supported for Facebook data exports.');
        }
      } else {
        throw new Error('Unsupported file format. Please upload a .vcf, .csv, or .json file.');
      }

      if (newContacts.length === 0) {
        throw new Error('No valid contacts found in the file.');
      }

      setProgress({ phase: 'importing', processed: 0, total: newContacts.length, message: 'Importing contacts…' });

      const result = await bulkImportWithProgress(newContacts, (p) => {
        setPhase(p.phase);
        setProgress(p);
      });

      // Set the final summary
      if (result.summary) {
        setSummary(result.summary);
      } else {
        // Fallback for non-streaming (small imports)
        setSummary({ imported: result.count, autoMerged: 0, needsReview: 0, newUnique: result.count });
      }
      setPhase('complete');
      setProgress(null);

      // Invalidate all relevant queries
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['dedupe-suggestions-count'] });
      queryClient.invalidateQueries({ queryKey: ['dedupe-suggestions'] });
      queryClient.invalidateQueries({ queryKey: ['dedupe-merge-log'] });

    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : String(err)) || 'Failed to process file.');
      setPhase('idle');
      setProgress(null);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDone = () => {
    onSuccess();
    onClose();
    resetState();
  };

  const handleReviewSuggestions = () => {
    onSuccess();
    onClose();
    resetState();
    navigate('/pulse?tab=suggestions');
  };

  const getAcceptedFormats = () => {
    switch (activeTab) {
      case 'apple': return '.vcf';
      case 'linkedin': return '.csv';
      case 'facebook': return '.json';
      case 'google': return '.csv';
      default: return '.csv,.vcf,.json';
    }
  };

  const getFormatLabel = () => {
    switch (activeTab) {
      case 'apple': return 'vCard (.vcf)';
      case 'linkedin': return 'CSV (.csv)';
      case 'facebook': return 'JSON (.json)';
      case 'google': return 'CSV (.csv)';
      default: return '.csv, .vcf, .json';
    }
  };

  const progressPct = progress?.processed && progress?.total
    ? Math.round((progress.processed / Math.max(progress.total, 1)) * 100)
    : 0;

  // Determine the phase label for display
  const getPhaseLabel = (): string => {
    switch (phase) {
      case 'importing': return progress?.message || 'Importing contacts…';
      case 'embedding': return 'Generating contact fingerprints…';
      case 'scanning': return progress?.message || 'Looking for duplicates…';
      default: return '';
    }
  };

  const isProcessing = phase === 'importing' || phase === 'embedding' || phase === 'scanning';

  return (
    <Modal isOpen={isOpen} onClose={phase === 'complete' ? handleDone : onClose} title="Import Contacts">
      {/* Tab bar — hidden during processing/results */}
      {!isProcessing && phase !== 'complete' && (
        <div className={cn(TAB_CONTAINER, "mb-6")}>
          {(['apple', 'linkedin', 'google', 'facebook'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={tabItem(activeTab === tab)}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      )}

      {/* Instructions — hidden during processing/results */}
      {!isProcessing && phase !== 'complete' && (
        <div className="bg-surface-container-low p-6 rounded-xl mb-6 text-sm text-on-surface-variant">
          <h4 className="font-bold text-on-surface mb-2 flex items-center gap-2">
            <FileText className="w-4 h-4" />
            How to export from {activeTab === 'apple' ? 'Apple Contacts' : activeTab === 'linkedin' ? 'LinkedIn' : activeTab === 'google' ? 'Google Contacts' : 'Facebook'}
          </h4>
          {activeTab === 'apple' && (
            <ol className="list-decimal list-inside space-y-1 ml-1">
              <li>Open the <strong>Contacts</strong> app on your Mac.</li>
              <li>Select the contacts you want to export (or Cmd+A for all).</li>
              <li>Go to <strong>File &gt; Export &gt; Export vCard...</strong></li>
              <li>Save the <strong>.vcf</strong> file and upload it below.</li>
            </ol>
          )}
          {activeTab === 'linkedin' && (
            <ol className="list-decimal list-inside space-y-1 ml-1">
              <li>Go to LinkedIn <strong>Settings & Privacy</strong>.</li>
              <li>Select <strong>Data Privacy</strong> &gt; <strong>Get a copy of your data</strong>.</li>
              <li>Choose <strong>Connections</strong> and request archive.</li>
              <li>Download the archive, extract it, and upload the <strong>Connections.csv</strong> file below.</li>
              <li className="text-xs text-on-surface-variant/70 mt-1">Fields imported: Name, Company, Position, Email, Profile URL, Connection Date</li>
            </ol>
          )}
          {activeTab === 'google' && (
            <ol className="list-decimal list-inside space-y-1 ml-1">
              <li>Go to <strong>contacts.google.com</strong>.</li>
              <li>Click <strong>Export</strong> in the left sidebar.</li>
              <li>Select <strong>Google CSV</strong> format and click <strong>Export</strong>.</li>
              <li>Upload the downloaded <strong>.csv</strong> file below.</li>
              <li className="text-xs text-on-surface-variant/70 mt-1">Fields imported: Name, multiple Emails & Phones, Company, Role, Address, Birthday, Notes, Website</li>
            </ol>
          )}
          {activeTab === 'facebook' && (
            <ol className="list-decimal list-inside space-y-1 ml-1">
              <li>Go to Facebook <strong>Settings & Privacy</strong> &gt; <strong>Settings</strong>.</li>
              <li>Navigate to <strong>Accounts Center</strong> &gt; <strong>Your information and permissions</strong>.</li>
              <li>Select <strong>Download your information</strong>.</li>
              <li>Choose <strong>JSON</strong> format and select the <strong>Friends and Followers</strong> category.</li>
              <li>Download, extract, and upload the <strong>friends.json</strong> file below.</li>
              <li className="text-xs text-on-surface-variant/70 mt-1">Note: Facebook only exports friend names and connection dates — no emails or phone numbers.</li>
            </ol>
          )}
        </div>
      )}

      {/* ─── Main content area ─── */}
      <AnimatePresence mode="wait">
        {phase === 'complete' && summary ? (
          /* ── Import Summary ───────────────────────────────────── */
          <motion.div
            key="summary"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25 }}
            className="space-y-5"
          >
            {/* Success header */}
            <div className="flex flex-col items-center text-center">
              <div className="bg-emerald-500/10 p-3 rounded-full mb-3">
                <CheckCircle2 className="w-8 h-8 text-emerald-500" />
              </div>
              <h3 className="font-headline font-bold text-lg text-on-surface">
                Import Complete
              </h3>
              <p className="text-sm text-on-surface-variant mt-1">
                {summary.imported} contacts processed
              </p>
            </div>

            {/* Breakdown rows */}
            <div className="bg-surface-container-low rounded-2xl divide-y divide-surface-container-high">
              {summary.autoMerged > 0 && (
                <div className="flex items-center gap-3 px-5 py-3.5">
                  <div className="bg-emerald-500/10 p-2 rounded-lg">
                    <GitMerge className="w-4 h-4 text-emerald-500" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-on-surface">{summary.autoMerged} duplicates auto-merged</p>
                    <p className="text-xs text-on-surface-variant">Exact matches combined automatically</p>
                  </div>
                </div>
              )}

              {summary.needsReview > 0 && (
                <div className="flex items-center gap-3 px-5 py-3.5">
                  <div className="bg-amber-500/10 p-2 rounded-lg">
                    <Search className="w-4 h-4 text-amber-500" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-on-surface">{summary.needsReview} likely matches need review</p>
                    <p className="text-xs text-on-surface-variant">Possible duplicates for you to check</p>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3 px-5 py-3.5">
                <div className="bg-primary/10 p-2 rounded-lg">
                  <UserPlus className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-on-surface">{summary.newUnique} new unique contacts</p>
                  <p className="text-xs text-on-surface-variant">Added to your network</p>
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-3 pt-1">
              {summary.needsReview > 0 && (
                <button
                  onClick={handleReviewSuggestions}
                  className="flex-1 flex items-center justify-center gap-2 bg-primary text-on-primary font-bold rounded-xl px-5 py-3 transition-all hover:brightness-110 active:scale-[0.98]"
                >
                  Review {summary.needsReview} Suggestions
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={handleDone}
                className={cn(
                  "flex items-center justify-center gap-2 font-bold rounded-xl px-5 py-3 transition-all hover:brightness-95 active:scale-[0.98]",
                  summary.needsReview > 0
                    ? "bg-surface-container-low text-on-surface"
                    : "flex-1 bg-primary text-on-primary hover:brightness-110"
                )}
              >
                Done
              </button>
            </div>
          </motion.div>

        ) : isProcessing ? (
          /* ── Processing state (import / embedding / scanning) ── */
          <motion.div
            key="processing"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25 }}
            className="bg-surface-container-low rounded-2xl p-8 flex flex-col items-center justify-center text-center"
          >
            {/* Phase pipeline indicator */}
            <div className="flex items-center gap-2 mb-6">
              {(['importing', 'embedding', 'scanning'] as const).map((p, i) => (
                <div key={p} className="flex items-center gap-2">
                  <div className={cn(
                    "w-2 h-2 rounded-full transition-colors duration-300",
                    phase === p ? "bg-primary scale-125" :
                    (['importing', 'embedding', 'scanning'].indexOf(phase) > i ? "bg-emerald-500" : "bg-surface-container-high")
                  )} />
                  {i < 2 && (
                    <div className={cn(
                      "w-8 h-0.5 rounded-full transition-colors duration-300",
                      (['importing', 'embedding', 'scanning'].indexOf(phase) > i ? "bg-emerald-500" : "bg-surface-container-high")
                    )} />
                  )}
                </div>
              ))}
            </div>

            <div className="relative mb-4">
              <Loader2 className="w-10 h-10 text-primary animate-spin" />
            </div>

            <p className="font-bold text-on-surface mb-1">{getPhaseLabel()}</p>

            {/* Progress bar for importing phase */}
            {phase === 'importing' && progress?.total ? (
              <div className="w-full max-w-xs space-y-2 mt-3">
                <div className="flex justify-between text-xs font-bold">
                  <span className="text-on-surface-variant">Importing</span>
                  <span className="text-primary tabular-nums">{progress.processed ?? 0}/{progress.total}</span>
                </div>
                <div className="h-1.5 bg-surface-container-high rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-primary rounded-full"
                    animate={{ width: `${progressPct}%` }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                  />
                </div>
              </div>
            ) : phase === 'scanning' && progress?.autoMerged !== undefined ? (
              <p className="text-xs text-on-surface-variant mt-2">
                {progress.autoMerged > 0 && <span className="text-emerald-500 font-bold">{progress.autoMerged} merged</span>}
                {progress.autoMerged > 0 && progress.needsReview! > 0 && ' · '}
                {progress.needsReview! > 0 && <span className="text-amber-500 font-bold">{progress.needsReview} to review</span>}
              </p>
            ) : (
              <p className="text-xs text-on-surface-variant mt-1">This may take a moment</p>
            )}
          </motion.div>

        ) : (
          /* ── Upload area (idle state) ──────────────────────────── */
          <motion.div
            key="upload"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={cn(
              "bg-surface-container-low rounded-2xl p-8 flex flex-col items-center justify-center text-center transition-colors",
              "hover:bg-surface-container-high cursor-pointer"
            )}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept={getAcceptedFormats()}
              onChange={handleFileChange}
            />
            <div className="bg-surface-container-high p-4 rounded-full mb-4">
              <UploadCloud className="w-8 h-8 text-primary" />
            </div>
            <p className="font-bold text-on-surface mb-1">Click to upload or drag and drop</p>
            <p className="text-xs text-on-surface-variant">
              {getFormatLabel()} files only
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <div className="mt-4 p-4 bg-red-500/10 text-red-500 rounded-xl flex items-center gap-3 text-sm font-medium">
          <AlertCircle className="w-5 h-5 shrink-0" />
          {error}
        </div>
      )}
    </Modal>
  );
};
