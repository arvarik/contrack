/**
 * ScoreBreakdown — makes the relationship score inspectable.
 *
 * A number out of 100 attached to a person is a judgement, and a judgement you
 * cannot interrogate is one you either over-trust or ignore. Neither is what
 * the score is for. This turns "42" into the five things that produced it,
 * each with the measurement behind it, so the answer to "why is this low" is
 * one click rather than a guess.
 *
 * The breakdown is fetched on open rather than with the contact: computing it
 * runs an aggregate query per contact, which is fine for one and wasteful for
 * a list of four hundred.
 *
 * @module components/ScoreBreakdown
 */
import React, { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info, Loader2 } from "lucide-react";
import { apiFetch } from "../api/client";
import { cn } from "../lib/utils";

interface ScoreComponent {
  key: string;
  label: string;
  value: number;
  weight: number;
  detail: string;
}

interface ScoreBreakdownData {
  score: number;
  components: ScoreComponent[];
}

async function fetchScoreBreakdown(
  contactId: string,
): Promise<ScoreBreakdownData> {
  const res = await apiFetch(`/contacts/${contactId}/score`);
  return res.json();
}

/** Breathing room kept between the panel and the edge of the window. */
const VIEWPORT_MARGIN = 16;

/** Colour the bar by how healthy that one signal is, not by the total. */
function barTone(value: number): string {
  if (value >= 67) return "bg-success";
  if (value >= 34) return "bg-warning";
  return "bg-error";
}

const Panel = ({ contactId }: { contactId: string }) => {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["contacts", contactId, "score"],
    queryFn: () => fetchScoreBreakdown(contactId),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 text-xs text-on-surface-variant">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Working it out…
      </p>
    );
  }
  if (isError || !data) {
    return (
      <p className="text-xs text-on-surface-variant">
        Couldn't load the breakdown.
      </p>
    );
  }

  return (
    <>
      <p className="text-xs text-on-surface-variant text-pretty">
        Scored <strong className="text-on-surface">{data.score}</strong> out of
        100, from five signals:
      </p>
      <ul className="space-y-2.5">
        {data.components.map((c) => (
          <li key={c.key}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-bold text-on-surface">
                {c.label}
                <span className="ml-1.5 font-normal text-on-surface-variant">
                  {Math.round(c.weight * 100)}% of the score
                </span>
              </span>
              <span className="text-xs font-bold tabular-nums text-on-surface">
                {c.value}
              </span>
            </div>
            <div
              className="mt-1 h-1.5 rounded-full bg-surface-container-highest overflow-hidden"
              role="img"
              aria-label={`${c.label}: ${c.value} out of 100`}
            >
              <div
                className={cn("h-full rounded-full", barTone(c.value))}
                style={{ width: `${Math.max(2, c.value)}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-on-surface-variant text-pretty">
              {c.detail}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
};

/**
 * A button that reveals the score's reasoning.
 *
 * Click rather than hover: the content is a paragraph per signal, and hover
 * panels that size are unreadable on touch and hostile to anyone whose pointer
 * drifts. Escape and outside-click both close it, and focus returns to the
 * trigger, which is the disclosure pattern people already know.
 */
export const ScoreBreakdown = ({
  contactId,
  score,
  className,
  children,
}: {
  contactId: string;
  score: number;
  className?: string;
  /** The trigger's visible content — usually the score badge itself. */
  children?: React.ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  /**
   * Which way the panel opens, and how tall it may be.
   *
   * The badge is often near the bottom of a card or the viewport, and a panel
   * that always drops downward gets its last two signals clipped by the
   * window — worse than useless, because clipped content looks like content
   * that simply ends.
   *
   * Both values are *measured*, not guessed. A first attempt compared the
   * space below against a hard-coded estimate of the panel's height; the
   * estimate was 50px short and the panel still overflowed. Taking the larger
   * side and capping the height to what is actually there cannot be wrong by
   * a constant.
   */
  const [panelBox, setPanelBox] = useState<{
    placement: "below" | "above";
    maxHeight: number;
  }>({ placement: "below", maxHeight: 400 });
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      // Send focus back where it came from, or a keyboard user is stranded at
      // the top of the document.
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <span ref={wrapperRef} className={cn("relative inline-flex", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-label={`Relationship score ${score} out of 100 — explain`}
        onClick={() => {
          // Measured at the moment of opening — the row may have scrolled
          // since mount, so anything computed earlier is already stale.
          const rect = triggerRef.current?.getBoundingClientRect();
          if (rect) {
            const below = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
            const above = rect.top - VIEWPORT_MARGIN;
            const openBelow = below >= above;
            setPanelBox({
              placement: openBelow ? "below" : "above",
              // Never negative, and never so small the panel is a sliver.
              maxHeight: Math.max(160, openBelow ? below : above),
            });
          }
          setOpen((v) => !v);
        }}
        className="inline-flex items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {children ?? <Info className="w-3.5 h-3.5" />}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="How this score was calculated"
          // Anchored right so it cannot push the viewport wider on a phone,
          // which a left-anchored panel on a right-aligned badge would.
          style={{ maxHeight: panelBox.maxHeight }}
          className={cn(
            "absolute z-50 right-0 w-72 max-w-[calc(100vw-2rem)]",
            panelBox.placement === "above"
              ? "bottom-full mb-2"
              : "top-full mt-2",
            "bg-surface-container-lowest rounded-2xl shadow-xl ring-1 ring-black/5",
            "p-4 space-y-3 text-left cursor-default",
            // Scrolls inside rather than spilling out of the window.
            "overflow-y-auto overscroll-contain",
          )}
        >
          <Panel contactId={contactId} />
          <p className="text-[11px] text-on-surface-variant text-pretty">
            Recalculated hourly, and whenever you log an interaction.
          </p>
        </div>
      )}
    </span>
  );
};
