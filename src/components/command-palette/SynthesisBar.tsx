/**
 * SynthesisBar — Opt-in executive brief for AI search results (Feature 6).
 *
 * States: idle → loading → streaming → complete
 * Visible when ≥3 AI results are present in either Cmd+K or SearchView.
 *
 * Streams NDJSON from POST /api/search/synthesize:
 *   { phase: "start" }     — show skeleton
 *   { phase: "complete", text: "..." } — show final text
 *   { phase: "error", error: "..." }   — show error state
 *
 * @module components/command-palette/SynthesisBar
 */
import React, { useState, useCallback, useRef, useEffect } from "react";
import { Sparkles, X, Loader2, AlertTriangle } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SynthesisContact {
  name: string;
  role?: string | null;
  company?: string | null;
  location?: string | null;
  aiReason?: string | null;
}

interface SynthesisBarProps {
  query: string;
  contacts: SynthesisContact[];
  resultCount: number;
  /** Compact mode for Cmd+K (smaller padding/text) vs full-page SearchView */
  compact?: boolean;
}

type SynthesisPhase = "idle" | "loading" | "complete" | "error";

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_RESULTS_FOR_SYNTHESIS = 3;
const API_BASE = "/api";

// ─── Component ────────────────────────────────────────────────────────────────

export const SynthesisBar: React.FC<SynthesisBarProps> = ({
  query,
  contacts,
  resultCount,
  compact = false,
}) => {
  const [phase, setPhase] = useState<SynthesisPhase>("idle");
  const [synthesisText, setSynthesisText] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  // Reset when query or contacts change (new search)
  useEffect(() => {
    setPhase("idle");
    setSynthesisText("");
    setErrorMessage("");
    abortRef.current?.abort();
  }, [query, resultCount]);

  const handleSynthesize = useCallback(async () => {
    // Abort any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase("loading");
    setSynthesisText("");
    setErrorMessage("");

    try {
      const payload = {
        query,
        contacts: contacts.slice(0, 30).map((c) => ({
          name: c.name,
          role: c.role || undefined,
          company: c.company || undefined,
          location: c.location || undefined,
          aiReason: c.aiReason || undefined,
        })),
      };

      const res = await fetch(`${API_BASE}/search/synthesize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`Synthesis failed (${res.status})`);

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const chunk = JSON.parse(line);
            if (chunk.phase === "complete" && chunk.text) {
              setSynthesisText(chunk.text);
              setPhase("complete");
            } else if (chunk.phase === "error") {
              setErrorMessage(chunk.error || "Unknown error");
              setPhase("error");
            }
          } catch {
            // Ignore malformed lines
          }
        }
      }
    } catch (err: unknown) {
      if (!(err instanceof Error && err.name === "AbortError")) {
        setErrorMessage(
          (err instanceof Error ? err.message : String(err)) ||
            "Synthesis failed",
        );
        setPhase("error");
      }
    }
  }, [query, contacts]);

  const handleDismiss = useCallback(() => {
    abortRef.current?.abort();
    setPhase("idle");
    setSynthesisText("");
    setErrorMessage("");
  }, []);

  // Don't render if not enough results (AFTER all hooks)
  if (resultCount < MIN_RESULTS_FOR_SYNTHESIS) return null;

  const px = compact ? "px-3 py-2" : "px-4 py-3";
  const textSize = compact ? "text-xs" : "text-sm";

  /*
   * One slot, one keyed crossfade — deliberately NOT `<AnimatePresence
   * mode="wait">` with height 0 ↔ auto. That combination collapsed the bar to
   * zero on every phase change before re-expanding, so each transition shoved
   * the entire result list up and back down. Phases still change height (a
   * button is shorter than a paragraph), but now it happens once, in one
   * direction, instead of twice.
   */
  return (
    <div key={phase} className="fade-enter">
      {/* ── Idle: Show synthesize button ── */}
      {phase === "idle" && (
        <div className={compact ? "px-1" : ""}>
          <button
            onClick={handleSynthesize}
            className={`
              w-full ${px} rounded-xl flex items-center gap-2
              bg-primary/5 hover:bg-primary/10 transition-colors group
              ${textSize} text-primary hover:text-primary cursor-pointer
            `}
          >
            <Sparkles
              className={`${compact ? "w-3 h-3" : "w-3.5 h-3.5"} group-hover:scale-110 transition-transform`}
            />
            <span className="font-semibold">Synthesize these results</span>
            <span className="text-on-surface-variant ml-auto">
              {resultCount} contacts
            </span>
          </button>
        </div>
      )}

      {/* ── Loading: Shimmer skeleton ── */}
      {phase === "loading" && (
        <div
          className={`${compact ? "mx-1" : ""} rounded-xl bg-primary/5 ${px} space-y-2`}
          style={{ minHeight: compact ? "60px" : "80px" }}
        >
          <div className={`flex items-center gap-2 ${textSize} text-primary`}>
            <Loader2
              className={`${compact ? "w-3 h-3" : "w-3.5 h-3.5"} animate-spin`}
            />
            <span className="font-semibold">Synthesizing…</span>
          </div>
          <div className="space-y-1.5">
            <div className="h-3 bg-primary/10 rounded-full animate-pulse w-4/5" />
            <div className="h-3 bg-primary/10 rounded-full animate-pulse w-3/5" />
          </div>
        </div>
      )}

      {/* ── Complete: Show synthesis text ── */}
      {phase === "complete" && synthesisText && (
        <div
          className={`
            ${compact ? "mx-1" : ""} rounded-xl bg-primary/5
            ${px} relative group
          `}
        >
          <div className={`flex items-start gap-2 ${textSize}`}>
            <Sparkles
              className={`${compact ? "w-3 h-3" : "w-3.5 h-3.5"} text-primary shrink-0 mt-0.5`}
            />
            <p className="text-on-surface leading-relaxed flex-1">
              {synthesisText}
            </p>
          </div>
          <button
            onClick={handleDismiss}
            className="absolute top-2 right-2 p-1 rounded-lg sm:opacity-0 sm:group-hover:opacity-60 hover:!opacity-100 hover:bg-surface-container-high transition-all"
            aria-label="Dismiss synthesis"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* ── Error state ── */}
      {phase === "error" && (
        <div
          className={`${compact ? "mx-1" : ""} rounded-xl bg-rose-500/5 ${px}`}
        >
          <div className={`flex items-center gap-2 ${textSize}`}>
            <AlertTriangle className="w-3.5 h-3.5 text-error shrink-0" />
            <span className="text-error">
              Synthesis failed{errorMessage ? `: ${errorMessage}` : ""}
            </span>
            <button
              onClick={handleSynthesize}
              className="ml-auto text-xs text-primary hover:underline"
            >
              Retry
            </button>
            <button
              onClick={handleDismiss}
              className="p-1 rounded-lg hover:bg-surface-container-high transition-colors"
              aria-label="Dismiss error"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
