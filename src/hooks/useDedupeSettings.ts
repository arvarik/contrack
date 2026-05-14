/**
 * useDedupeSettings — User-configurable dedupe preferences (localStorage).
 *
 * Stores the auto-merge confidence threshold preset that controls which
 * clusters are automatically merged vs. sent to the review queue.
 *
 * Presets:
 *   - "aggressive"   → 0.88 — more auto-merges, fewer manual reviews
 *   - "default"      → 0.93 — balanced (high confidence only)
 *   - "conservative" → 0.97 — only near-certain matches auto-merge
 */
import { useState, useCallback } from "react";

const STORAGE_KEY = "contrack_dedupe_settings";

/** The three user-facing preset labels */
export type MergePreset = "aggressive" | "default" | "conservative";

/** Maps each preset to its numeric confidence threshold */
export const PRESET_THRESHOLDS: Record<MergePreset, number> = {
  aggressive: 0.88,
  default: 0.93,
  conservative: 0.97,
};

/** Fallback threshold exported for consumers that need the raw number */
export const DEFAULT_AUTO_MERGE_THRESHOLD = PRESET_THRESHOLDS.default;

interface DedupeSettings {
  preset: MergePreset;
}

function resolvePreset(raw: string | undefined): MergePreset {
  if (raw === "aggressive" || raw === "default" || raw === "conservative")
    return raw;
  return "default";
}

/**
 * Migrate legacy settings: if the stored value has a raw `autoMergeThreshold`
 * number (from the old slider UI) instead of a `preset`, map it to the
 * closest preset and update storage.
 */
function loadSettings(): DedupeSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);

      // New format — has a preset key
      if (parsed.preset) {
        return { preset: resolvePreset(parsed.preset) };
      }

      // Legacy format — has a numeric threshold, map to closest preset
      if (typeof parsed.autoMergeThreshold === "number") {
        const t = parsed.autoMergeThreshold;
        let preset: MergePreset = "default";
        if (t <= 0.9) preset = "aggressive";
        else if (t >= 0.95) preset = "conservative";
        // Migrate to new format
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ preset }));
        return { preset };
      }
    }
  } catch {
    /* ignore corrupt localStorage */
  }
  return { preset: "default" };
}

export function useDedupeSettings() {
  const [settings, setSettings] = useState<DedupeSettings>(loadSettings);

  const setPreset = useCallback((preset: MergePreset) => {
    setSettings(() => {
      const next = { preset };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return {
    preset: settings.preset,
    autoMergeThreshold: PRESET_THRESHOLDS[settings.preset],
    setPreset,
    /** @deprecated Use setPreset instead. Kept for backward compat. */
    setAutoMergeThreshold: (value: number) => {
      let p: MergePreset = "default";
      if (value <= 0.9) p = "aggressive";
      else if (value >= 0.95) p = "conservative";
      setPreset(p);
    },
  };
}
