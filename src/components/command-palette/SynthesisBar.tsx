import { apiFetch } from "../../api/client";
import { readNdjson } from "../../api/ndjson";
import { z } from "zod";
/**
 * An opt-in brief over three or more AI results, in the palette and on Ask.
 * Streams NDJSON from POST /api/search/synthesize:
 *   { phase: "start" }                   keep the skeleton
 *   { phase: "delta", text: "..." }      add the next piece of the text
 *   { phase: "complete", text: "..." }   show the final text, which replaces it
 *   { phase: "error", error: "..." }     show the error state
 *
 * A cache hit sends start and complete with no deltas.
 */
import React, { useState, useCallback, useRef, useEffect } from "react";
import { Sparkles, X, AlertTriangle } from "lucide-react";
import { CorvidThinking } from "../brand/CorvidThinking";
import { LiveStatus } from "../ui/LiveStatus";
import { useBlockedAi } from "../../hooks/useAiSetup";
import { errorText } from "../../lib/utils";

interface SynthesisContact {
  id: string;
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

type SynthesisPhase = "idle" | "loading" | "streaming" | "complete" | "error";

const MIN_RESULTS_FOR_SYNTHESIS = 3;

/** The longest summary, whole or as the sum of its deltas. */
const MAX_SUMMARY_LENGTH = 20_000;

/** One line of the stream. A delta carries the next piece, not the whole text. */
const synthesisChunkSchema = z.discriminatedUnion("phase", [
  z.object({ phase: z.literal("start") }),
  z.object({ phase: z.literal("delta"), text: z.string() }),
  z.object({
    phase: z.literal("complete"),
    text: z.string().trim().min(1).max(MAX_SUMMARY_LENGTH),
  }),
  z.object({ phase: z.literal("error"), error: z.string() }),
]);

export const SynthesisBar: React.FC<SynthesisBarProps> = ({
  query,
  contacts,
  resultCount,
  compact = false,
}) => {
  const [phase, setPhase] = useState<SynthesisPhase>("idle");
  const blocked = useBlockedAi("briefings") !== null;
  const [synthesisText, setSynthesisText] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const identity = JSON.stringify([
    query,
    contacts.map((c) => [
      c.id,
      c.name,
      c.role,
      c.company,
      c.location,
      c.aiReason,
    ]),
  ]);
  // Reset when query or contacts change (new search)
  useEffect(() => {
    setPhase("idle");
    setSynthesisText("");
    setErrorMessage("");
    abortRef.current?.abort();
    abortRef.current = null;
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [identity]);

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
        contactIds: contacts.slice(0, 30).map((contact) => contact.id),
      };

      const res = await apiFetch("/search/synthesize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      let complete = false;
      let streamed = "";
      await readNdjson(
        res,
        (value) => {
          if (controller.signal.aborted || abortRef.current !== controller)
            return;
          // The final text is the answer. A line after it changes nothing.
          if (complete) return;
          const chunk = synthesisChunkSchema.parse(value);
          if (chunk.phase === "error") throw new Error(chunk.error);
          if (chunk.phase === "delta") {
            streamed += chunk.text;
            if (streamed.length > MAX_SUMMARY_LENGTH)
              throw new Error("The summary is too long");
            // The skeleton stays until there is text to show.
            if (!streamed.trim()) return;
            setSynthesisText(streamed);
            setPhase("streaming");
          }
          if (chunk.phase === "complete") {
            complete = true;
            setSynthesisText(chunk.text);
            setPhase("complete");
          }
        },
        controller.signal,
      );
      if (!complete)
        throw new Error("The summary connection ended early. Try again");
    } catch (err: unknown) {
      if (!controller.signal.aborted && abortRef.current === controller) {
        // The streamed text was never confirmed, so it goes.
        setSynthesisText("");
        setErrorMessage(errorText(err));
        setPhase("error");
      }
    }
  }, [query, contacts]);

  const handleDismiss = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase("idle");
    setSynthesisText("");
    setErrorMessage("");
  }, []);

  // Don't render if not enough results (AFTER all hooks)
  // No button that can only fail: with no model to write it, there is none.
  if (resultCount < MIN_RESULTS_FOR_SYNTHESIS || blocked) return null;

  const px = compact ? "px-3 py-2" : "px-4 py-3";
  const textSize = compact ? "text-xs" : "text-sm";
  const streaming = phase === "streaming";
  const showsText = streaming || phase === "complete";

  /*
   * One slot, one keyed crossfade. Not `<AnimatePresence mode="wait">` with
   * height 0 ↔ auto, which collapses the bar on each phase and shoves the
   * results up and down. Streaming and complete share one key, so the final
   * text replaces the streamed text with no flash.
   */
  return (
    <div>
      <div key={showsText ? "text" : phase} className="fade-enter">
        {/* Idle: Show synthesize button */}
        {phase === "idle" && (
          <div className={compact ? "px-1" : ""}>
            <button
              onClick={handleSynthesize}
              className={`
                state-layer w-full ${px} min-h-[44px] pointer-fine:min-h-0 rounded-xl flex items-center gap-2
                bg-primary/5 transition-colors group
                ${textSize} text-primary cursor-pointer
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

        {/* Loading: Shimmer skeleton */}
        {phase === "loading" && (
          <div
            className={`${compact ? "mx-1" : ""} rounded-xl bg-primary/5 ${px} space-y-2`}
            style={{ minHeight: compact ? "60px" : "80px" }}
          >
            <div className={`flex items-center gap-2 ${textSize} text-primary`}>
              {/* Decorative: "Synthesizing…" beside it says the same. */}
              <CorvidThinking decorative size={compact ? 14 : 16} />
              <span className="font-semibold">Synthesizing…</span>
            </div>
            <div className="space-y-1.5">
              <div className="h-3 bg-primary/10 rounded-full animate-pulse w-4/5" />
              <div className="h-3 bg-primary/10 rounded-full animate-pulse w-3/5" />
            </div>
          </div>
        )}

        {/*
          Streaming and complete. A model wrote the summary, so it sits on the
          AI color's wash with the AI glyph. While the text streams, the box
          is busy and has no dismiss button.
        */}
        {showsText && synthesisText && (
          <div
            aria-busy={streaming || undefined}
            className={`
              ${compact ? "mx-1" : ""} rounded-xl bg-ai/5
              ${px} relative group
            `}
          >
            <div className={`flex items-start gap-2 ${textSize}`}>
              <Sparkles
                className={`${compact ? "w-3 h-3" : "w-3.5 h-3.5"} text-ai shrink-0 mt-0.5`}
              />
              <p className="text-on-surface leading-relaxed flex-1">
                {synthesisText}
              </p>
            </div>
            {!streaming && (
              <button
                onClick={handleDismiss}
                className="hit-area state-layer absolute top-2 right-2 p-1 rounded-lg pointer-fine:opacity-0 pointer-fine:group-hover:opacity-60 pointer-coarse:opacity-60 hover:!opacity-100 transition-opacity"
                aria-label="Dismiss synthesis"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        )}

        {/* Error state */}
        {phase === "error" && (
          <div
            className={`${compact ? "mx-1" : ""} rounded-xl bg-error/5 ${px}`}
          >
            <div className={`flex items-center gap-2 ${textSize}`}>
              <AlertTriangle className="w-3.5 h-3.5 text-error shrink-0" />
              <span className="text-error">
                Could not write the summary
                {errorMessage ? `: ${errorMessage}` : ""}
              </span>
              <button
                onClick={handleSynthesize}
                className="hit-area ml-auto text-xs text-primary hover:underline"
              >
                Try again
              </button>
              <button
                onClick={handleDismiss}
                className="hit-area state-layer p-1 rounded-lg transition-colors"
                aria-label="Dismiss error"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/*
        Says the final text once. The growing text is not announced. The
        region stays mounted outside the keyed slot, as LiveStatus requires.
      */}
      <LiveStatus
        message={phase === "complete" ? synthesisText : ""}
        label="Summary status"
      />
    </div>
  );
};
