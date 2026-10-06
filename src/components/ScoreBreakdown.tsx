/**
 * ScoreBreakdown — makes the relationship score inspectable.
 *
 * A number out of 100 attached to a person is a judgment, and a judgment you
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
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info, Loader2 } from "lucide-react";
import { apiFetch } from "../api/client";
import { usePanelPlacement } from "../hooks/usePanelPlacement";
import { useCloseRequest } from "../hooks/useCloseRequest";
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

/** Color the bar by how healthy that one signal is, not by the total. */
function barTone(value: number): string {
  if (value >= 67) return "bg-success";
  if (value >= 34) return "bg-warning";
  return "bg-error";
}

const Panel = ({
  data,
  isLoading,
  isError,
}: {
  data: ScoreBreakdownData | undefined;
  isLoading: boolean;
  isError: boolean;
}) => {
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
        Couldn't load the breakdown
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
  children,
}: {
  contactId: string;
  score: number;
  /** The trigger's visible content — usually the score badge itself. */
  children?: React.ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useCloseRequest(open, close);

  const breakdown = useQuery({
    queryKey: ["contacts", contactId, "score"],
    queryFn: () => fetchScoreBreakdown(contactId),
    staleTime: 60_000,
    enabled: open,
  });

  /**
   * Where the panel opens, measured from the trigger.
   *
   * The panel used to hang from the trigger's right edge inside the page.
   * On the contact header the ring sits at the pane's left edge, so the
   * panel ran about 150 px past the pane and the pane clipped it. In the
   * top layer nothing clips it, and it lines up with whichever edge of the
   * trigger keeps it inside the window. The breakdown loads after the panel
   * opens and makes it taller, so the answer measures it again.
   */
  const placement = usePanelPlacement({
    open,
    align: "end",
    trigger: triggerRef,
    panel: panelRef,
    measureKey: breakdown.data ? "ready" : breakdown.isError,
    onClose: close,
  });

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
    <span ref={wrapperRef} className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-label={`Relationship score ${score} out of 100, explain`}
        onClick={() => setOpen((v) => !v)}
        // 24px minimum on screen for the bare-icon form, and a 44px tap box
        // from `hit-area`. A badge passed as children is larger than that.
        className="hit-area inline-flex items-center justify-center rounded-full min-w-6 min-h-6"
      >
        {children ?? <Info className="w-3.5 h-3.5" />}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="How this score was calculated"
          {...placement.panelProps}
          className={cn(
            placement.panelProps.className,
            "w-72 max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-1rem)]",
            "menu-panel menu-enter",
            "p-4 space-y-3 text-left cursor-default",
            // Scrolls inside rather than spilling out of the window.
            "overflow-y-auto overscroll-contain",
          )}
        >
          <Panel
            data={breakdown.data}
            isLoading={breakdown.isPending}
            isError={breakdown.isError}
          />
          <p className="text-[11px] text-on-surface-variant text-pretty">
            Recalculated hourly, and whenever you log an interaction
          </p>
        </div>
      )}
    </span>
  );
};
