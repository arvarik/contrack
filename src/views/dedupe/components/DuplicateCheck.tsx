/**
 * One button that checks every contact for duplicates, and what the check is
 * doing or found. With AI on it asks AI about unclear pairs. With AI off it
 * finds exact matches only, and says so.
 *
 * The card is for Settings. The review page shows it `inline` only while a
 * check runs or once it is done.
 */
import { formatDistanceToNowStrict } from "date-fns";
import {
  AlertCircle,
  CheckCircle2,
  Hourglass,
  Loader2,
  ScanSearch,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useDedupe } from "../../../contexts/DedupeContext";
import { useAiAllowed } from "../../../hooks/useAiAllowed";
import { useInstanceAi } from "../../../api/aiSettings";
import { useDedupeCount } from "../../../api";
import { cn, plural } from "../../../lib/utils";
import { TONE_WASH, TONE_TEXT } from "../../../lib/styles";
import { SETTINGS_CARD } from "../../settings/layout";
import { CHECK_STEPS, runsAiPass, stepStatus } from "../utils/scanPhases";
import type { DedupeScanMode, DedupeScanProgress } from "../../../types";
import { TEXT_LINK } from "../../../lib/styles";

/** The check that runs: with AI when the account and the instance allow it. */
export function useDuplicateCheck() {
  const dedupe = useDedupe();
  const accountAi = useAiAllowed();
  const { data: instanceAi } = useInstanceAi();
  const aiOn = accountAi && instanceAi?.aiOff !== true;
  const mode: DedupeScanMode = aiOn ? "deep" : "quick";
  const aiOffReason = aiOn
    ? null
    : instanceAi?.aiOff
      ? "AI is off on this instance, so a check finds exact matches only"
      : "AI is off for your account, so a check finds exact matches only";
  return {
    ...dedupe,
    aiOffReason,
    start: () => {
      dedupe.reset();
      dedupe.startScan(mode);
    },
  };
}

/** "just now" or "4 minutes ago". */
function finishedAgo(scan: DedupeScanProgress): string {
  if (!scan.completedAt) return "just now";
  const at = new Date(scan.completedAt);
  if (Number.isNaN(at.getTime()) || Date.now() - at.getTime() < 60_000) {
    return "just now";
  }
  return formatDistanceToNowStrict(at, { addSuffix: true });
}

function Steps({ scan }: { scan: DedupeScanProgress }) {
  const steps = CHECK_STEPS.filter((s) => !s.ai || runsAiPass(scan.mode));
  return (
    <ol className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
      {steps.map((step) => {
        const status = stepStatus(scan.phase, step.from, step.to);
        return (
          <li
            key={step.label}
            className={cn(
              "flex items-center gap-1.5",
              status === "pending"
                ? "text-on-surface-variant"
                : "text-on-surface",
            )}
          >
            {status === "done" ? (
              <CheckCircle2
                aria-hidden="true"
                className={cn("w-3.5 h-3.5", TONE_TEXT.success)}
              />
            ) : status === "active" ? (
              <Loader2
                aria-hidden="true"
                className="w-3.5 h-3.5 animate-spin text-primary"
              />
            ) : (
              <span
                aria-hidden="true"
                className="w-3.5 h-3.5 rounded-full ring-1 ring-inset ring-on-surface-variant/40"
              />
            )}
            {step.label}
            <span className="sr-only">
              {status === "done"
                ? ", done"
                : status === "active"
                  ? ", running"
                  : ", waiting"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The bar, from contacts read. Indeterminate before the total is known. */
function Bar({ scan }: { scan: DedupeScanProgress }) {
  const share =
    scan.totalContacts > 0 ? scan.contactsScanned / scan.totalContacts : 0;
  return (
    <div
      role="progressbar"
      aria-label="Check for duplicates"
      aria-valuemin={0}
      aria-valuemax={scan.totalContacts || undefined}
      aria-valuenow={scan.totalContacts ? scan.contactsScanned : undefined}
      className="h-1.5 rounded-full bg-surface-container-high overflow-hidden"
    >
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-(--dur-slow) ease-(--ease)"
        style={{ width: `${Math.max(4, share * 100)}%` }}
      />
    </div>
  );
}

interface DuplicateCheckProps {
  variant?: "card" | "inline";
}

export const DuplicateCheck = ({ variant = "card" }: DuplicateCheckProps) => {
  const { scan, isScanning, isStarting, isQueued, start, aiOffReason } =
    useDuplicateCheck();
  const { data: count } = useDedupeCount();
  const toReview = count?.count ?? 0;
  const inline = variant === "inline";

  const status =
    isQueued && !scan
      ? "queued"
      : isScanning || isStarting
        ? "running"
        : scan?.phase === "error"
          ? "error"
          : scan?.phase === "complete"
            ? "done"
            : "idle";

  // Inline, the empty state holds the button.
  if (inline && status === "idle") return null;

  const body = (() => {
    switch (status) {
      case "queued":
        return (
          <div className="flex items-start gap-3" role="status">
            <Hourglass
              aria-hidden="true"
              className="w-4 h-4 mt-0.5 shrink-0 text-primary"
            />
            <p className="text-sm text-on-surface text-pretty">
              Waiting for another account's check to finish. Yours starts by
              itself, and you can leave this page
            </p>
          </div>
        );
      case "running":
        return (
          // One announcement at the start: the bar carries the numbers.
          <div className="space-y-3">
            <span role="status" className="sr-only">
              Checking for duplicates
            </span>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-bold text-on-surface">
                {scan && scan.totalContacts > 0
                  ? `Checking ${scan.contactsScanned} of ${scan.totalContacts} contacts`
                  : "Checking for duplicates"}
              </p>
              {!inline && (
                <span className="text-xs text-on-surface-variant">
                  You can leave this page
                </span>
              )}
            </div>
            {scan ? (
              <>
                <Bar scan={scan} />
                <Steps scan={scan} />
              </>
            ) : (
              <div className="h-1.5 rounded-full bg-surface-container-high" />
            )}
          </div>
        );
      case "error":
        return (
          <div className="flex flex-wrap items-center gap-3" role="alert">
            <AlertCircle
              aria-hidden="true"
              className="w-4 h-4 shrink-0 text-error"
            />
            <p className="flex-1 min-w-[12rem] text-sm text-on-surface">
              The check stopped
              {scan?.error ? `: ${scan.error.replace(/\.$/, "")}` : ""}
            </p>
            <button
              type="button"
              onClick={start}
              className="btn-secondary btn-sm"
            >
              Try again
            </button>
          </div>
        );
      case "done": {
        const merged = scan?.autoMerged ?? 0;
        return (
          <div className="space-y-3" role="status">
            <div className="flex items-start gap-3">
              <CheckCircle2
                aria-hidden="true"
                className={cn("w-4 h-4 mt-0.5 shrink-0", TONE_TEXT.success)}
              />
              <div className="min-w-0 text-sm">
                <p className="font-bold text-on-surface">
                  Checked{" "}
                  {plural(scan?.totalContacts ?? 0, "contact", "contacts")}{" "}
                  {scan ? finishedAgo(scan) : ""}
                </p>
                <p className="text-on-surface-variant text-pretty">
                  {merged > 0 && (
                    <>
                      <Link
                        to="/pulse/duplicates?view=merged"
                        className={TEXT_LINK}
                      >
                        {merged} merged automatically
                      </Link>
                      {" · "}
                    </>
                  )}
                  {toReview > 0
                    ? `${plural(toReview, "possible duplicate", "possible duplicates")} to review`
                    : "No duplicates left to review"}
                </p>
              </div>
            </div>
            {/* The page callout holds Review: the card only checks again. */}
            {!inline && (
              <div className="sm:pl-7">
                <button
                  type="button"
                  onClick={start}
                  className="btn-secondary btn-sm"
                >
                  Check again
                </button>
              </div>
            )}
          </div>
        );
      }
      default:
        return (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <span
                className={cn("p-2 rounded-lg shrink-0", TONE_WASH.primary)}
              >
                <ScanSearch aria-hidden="true" className="w-5 h-5" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold text-on-surface">
                  Check for duplicates
                </p>
                <p className="text-sm text-on-surface-variant text-pretty">
                  Contrack checks new contacts and imports by itself. A check
                  compares all your contacts again
                </p>
                {aiOffReason && (
                  <p className="text-xs text-on-surface-variant mt-1">
                    {aiOffReason}
                  </p>
                )}
              </div>
            </div>
            {/* Secondary while duplicates wait for review. */}
            <button
              type="button"
              onClick={start}
              className={cn(
                toReview > 0 ? "btn-secondary" : "btn-primary",
                "max-sm:w-full shrink-0",
              )}
            >
              <ScanSearch aria-hidden="true" className="w-4 h-4" />
              Check now
            </button>
          </div>
        );
    }
  })();

  return inline ? (
    <div className="rounded-2xl bg-surface-container-low px-4 py-3">{body}</div>
  ) : (
    <div className={SETTINGS_CARD}>{body}</div>
  );
};
