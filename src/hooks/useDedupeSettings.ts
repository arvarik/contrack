/**
 * useDedupeSettings — User-configurable dedupe preferences (localStorage).
 *
 * Stores the auto-merge confidence threshold that controls which clusters
 * are automatically merged vs. sent to the review queue.
 *
 * Pattern: same localStorage approach as useRecentContactsLimit.
 */
import { useState, useCallback } from 'react';

const STORAGE_KEY = 'contrack_dedupe_settings';

export const DEFAULT_AUTO_MERGE_THRESHOLD = 0.93;
export const MIN_THRESHOLD = 0.85;
export const MAX_THRESHOLD = 0.99;
export const THRESHOLD_STEP = 0.01;

interface DedupeSettings {
  autoMergeThreshold: number;
}

function loadSettings(): DedupeSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        autoMergeThreshold: clamp(
          parsed.autoMergeThreshold ?? DEFAULT_AUTO_MERGE_THRESHOLD,
          MIN_THRESHOLD,
          MAX_THRESHOLD,
        ),
      };
    }
  } catch { /* ignore corrupt localStorage */ }
  return { autoMergeThreshold: DEFAULT_AUTO_MERGE_THRESHOLD };
}

function clamp(value: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, value)) * 100) / 100;
}

export function useDedupeSettings() {
  const [settings, setSettings] = useState<DedupeSettings>(loadSettings);

  const setAutoMergeThreshold = useCallback((value: number) => {
    const clamped = clamp(value, MIN_THRESHOLD, MAX_THRESHOLD);
    setSettings(prev => {
      const next = { ...prev, autoMergeThreshold: clamped };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return {
    autoMergeThreshold: settings.autoMergeThreshold,
    setAutoMergeThreshold,
  };
}
