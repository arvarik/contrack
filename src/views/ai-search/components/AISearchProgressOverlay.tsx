/**
 * AISearchProgressOverlay — Google Drive-style floating progress panel.
 *
 * Positioned fixed, bottom-right. Does NOT block interaction with the app.
 * Shows per-job status with icons, latency, and a summary progress bar.
 * Stays open until manually minimized or dismissed.
 */
import React, { useState, useMemo } from 'react';
import {
  Sparkles, Circle, Loader2, CheckCircle2, XCircle, ChevronDown, X,
} from 'lucide-react';
import { motion } from 'motion/react';
import type { AISearchBatch, AISearchJob } from '../../../types';
import { cn } from '../../../lib/utils';
import { CARD } from '../../../lib/styles';

interface Props {
  batch: AISearchBatch;
  onDismiss: () => void;
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  queued: <Circle className="w-3.5 h-3.5 text-on-surface-variant/40" />,
  searching: <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />,
  merging: <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin" />,
  success: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />,
  error: <XCircle className="w-3.5 h-3.5 text-rose-500" />,
};

export function AISearchProgressOverlay({ batch, onDismiss }: Props) {
  const [isMinimized, setIsMinimized] = useState(false);

  const completed = useMemo(() =>
    batch.jobs.filter(j => j.status === 'success' || j.status === 'error').length,
    [batch.jobs]
  );
  const succeeded = useMemo(() =>
    batch.jobs.filter(j => j.status === 'success').length,
    [batch.jobs]
  );
  const failed = useMemo(() =>
    batch.jobs.filter(j => j.status === 'error').length,
    [batch.jobs]
  );
  const totalFields = useMemo(() =>
    batch.jobs.reduce((sum, j) => sum + j.fieldsUpdated, 0),
    [batch.jobs]
  );
  const total = batch.jobs.length;
  const progress = total > 0 ? (completed / total) * 100 : 0;
  const isComplete = batch.status === 'complete' || batch.status === 'cancelled';

  // Auto-minimize removed — stays open until manually dismissed

  // Minimized compact badge
  if (isMinimized) {
    return (
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="fixed bottom-6 right-6 z-50"
      >
        <button
          onClick={() => setIsMinimized(false)}
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 rounded-full shadow-xl",
            "bg-surface-container-lowest ring-1 ring-surface-container-highest/30",
            "hover:shadow-2xl transition-all cursor-pointer",
            "text-sm font-semibold"
          )}
        >
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-on-surface">
            {succeeded > 0 && <span className="text-emerald-500">{succeeded} updated</span>}
            {succeeded > 0 && failed > 0 && ', '}
            {failed > 0 && <span className="text-rose-500">{failed} failed</span>}
          </span>
        </button>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ y: 40, opacity: 0, scale: 0.95 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      transition={{ type: 'spring', damping: 24, stiffness: 300 }}
      className="fixed bottom-6 right-6 z-50 w-80"
    >
      <div className={cn(CARD, "p-0 shadow-2xl ring-1 ring-surface-container-highest/30 overflow-hidden")}>
        {/* Header */}
        <div className="px-4 py-3 bg-surface-container-low flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="font-bold text-sm text-on-surface flex-1">AI Search</span>
          <span className="text-xs text-on-surface-variant tabular-nums">
            {completed}/{total}
          </span>
          <button
            onClick={() => setIsMinimized(true)}
            className="p-1 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onDismiss}
            className="p-1 rounded-lg text-on-surface-variant hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-surface-container-high">
          <motion.div
            className="h-full bg-gradient-to-r from-primary-dim to-primary-container"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          />
        </div>

        {/* Job list */}
        <div className="max-h-64 overflow-y-auto nice-scrollbar">
          {batch.jobs.map((job) => (
            <JobRow key={job.id} job={job} />
          ))}
        </div>

        {/* Summary footer */}
        {isComplete && (
          <div className="px-4 py-2.5 bg-surface-container-low text-xs text-on-surface-variant flex items-center gap-2">
            <span className="flex-1">
              {totalFields > 0 ? (
                <span>
                  <span className="font-bold text-emerald-500">{totalFields}</span> field{totalFields !== 1 ? 's' : ''} enriched
                  {batch.totalTokens > 0 && (
                    <span className="ml-1 opacity-60">· ~{(batch.totalTokens / 1000).toFixed(1)}k tokens</span>
                  )}
                </span>
              ) : (
                <span className="opacity-60">No new data found</span>
              )}
            </span>
            <button
              onClick={onDismiss}
              className="text-xs font-bold text-on-surface-variant hover:text-on-surface px-2 py-1 rounded-lg hover:bg-surface-container-high transition-colors"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Individual Job Row
// ---------------------------------------------------------------------------

function JobRow({ job }: { job: AISearchJob }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 text-sm">
      <div className="shrink-0">{STATUS_ICONS[job.status]}</div>
      <span className={cn(
        "flex-1 truncate",
        job.status === 'success' ? 'text-on-surface' : '',
        job.status === 'error' ? 'text-rose-500' : '',
        job.status === 'queued' ? 'text-on-surface-variant/60' : '',
        (job.status === 'searching' || job.status === 'merging') ? 'text-on-surface font-medium' : '',
      )}>
        {job.contactName}
      </span>
      {/* Right side: latency or status text */}
      <span className="text-[10px] text-on-surface-variant shrink-0 tabular-nums">
        {job.status === 'success' && job.latencyMs != null && (
          <span className="text-emerald-500">{(job.latencyMs / 1000).toFixed(1)}s</span>
        )}
        {job.status === 'success' && job.fieldsUpdated > 0 && (
          <span className="ml-1 opacity-60">+{job.fieldsUpdated}</span>
        )}
        {job.status === 'success' && job.fieldsUpdated === 0 && (
          <span className="ml-1 opacity-40">✓ Up to date</span>
        )}
        {job.status === 'error' && (
          <span className="text-rose-500 font-bold" title={job.error}>Error</span>
        )}
        {job.status === 'searching' && (
          <span className="text-primary opacity-60">Searching…</span>
        )}
        {job.status === 'merging' && (
          <span className="text-amber-500 opacity-60">Merging…</span>
        )}
      </span>
    </div>
  );
}
