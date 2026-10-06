/**
 * MergeHistory: the latest merges, each with Undo for 90 days.
 *
 * ```
 * TODAY
 * ┌───────────────────────────────────────────────┐
 * │ Merged automatically · 3 minutes ago  [ Undo ] │
 * │ Ben Quill · Woodgrove Bank, Miami              │
 * │ into Ada Quill · Adatum, Boston                │
 * │ Same name                                      │
 * └───────────────────────────────────────────────┘
 * ```
 *
 * Each entry names both contacts with what tells them apart, so two
 * entries for one name are two entries a person can tell apart. An Undo
 * here means the two are different people: the contact comes back, and
 * nothing merges or suggests the two again. The review list's own Undo,
 * right after a person's merge, only takes the merge back.
 *
 * The content only. The review page shows it in its side panel, or in a
 * sheet below `lg`, and Settings in a dialog.
 *
 * @module views/dedupe/components/MergeHistory
 */
import { useMemo, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { Bot, Clock, Undo2, User } from "lucide-react";
import { toast } from "sonner";
import { useMergeLog, useUndoMerge } from "../../../api";
import { cn } from "../../../lib/utils";
import { LABEL, TONE_WASH } from "../../../lib/styles";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Badge } from "../../../components/ui/Badge";
import type { MergeLogEntry } from "../../../types";
import { plainReason } from "../utils/reason";

/**
 * A time from the database. SQLite writes "2026-10-05 22:52:02" in UTC with
 * no zone, which `new Date` would read as local time, so a merge near
 * midnight landed under the wrong day.
 */
export function parseDbTime(value: string): Date {
  return new Date(
    value.includes("T") || value.endsWith("Z")
      ? value
      : `${value.replace(" ", "T")}Z`,
  );
}

const DAY_MS = 86_400_000;

/** The entries under Today, Yesterday, This week and Older, in that order. */
export function groupByDay(
  entries: MergeLogEntry[],
  now = new Date(),
): { label: string; items: MergeLogEntry[] }[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const labelOf = (at: Date) =>
    at >= today
      ? "Today"
      : at.getTime() >= today.getTime() - DAY_MS
        ? "Yesterday"
        : at.getTime() >= today.getTime() - 7 * DAY_MS
          ? "This week"
          : "Older";
  const groups = new Map<string, MergeLogEntry[]>();
  for (const entry of entries) {
    const label = labelOf(parseDbTime(entry.mergedAt));
    groups.set(label, [...(groups.get(label) ?? []), entry]);
  }
  return ["Today", "Yesterday", "This week", "Older"]
    .filter((label) => groups.has(label))
    .map((label) => ({ label, items: groups.get(label)! }));
}

/** "Woodgrove Bank, Miami": what tells a contact from a namesake. */
const hintOf = (company?: string | null, location?: string | null) =>
  [company, location?.split(",")[0]].filter(Boolean).join(", ");

function Entry({ entry }: { entry: MergeLogEntry }) {
  const undo = useUndoMerge();
  const [pending, setPending] = useState(false);
  const auto = entry.mergedBy === "auto";
  const undone = !!entry.undoneAt;
  const at = parseDbTime(entry.mergedAt);
  const duplicateHint = hintOf(entry.duplicateCompany, entry.duplicateLocation);
  const primaryHint = hintOf(entry.primaryCompany, entry.primaryLocation);
  const reason = entry.reasoning
    ? plainReason(entry.mergeType === "ai" ? "ai" : "", entry.reasoning)
    : null;

  const handleUndo = async () => {
    setPending(true);
    try {
      const res = await undo.mutateAsync({ mergeLogId: entry.id });
      const changed = res.conflicts?.length ?? 0;
      toast.success(`Restored ${entry.duplicateName}`, {
        description:
          changed > 0
            ? `${changed} ${changed === 1 ? "record" : "records"} changed since the merge stay on ${entry.primaryName}. Contrack will not suggest the two again`
            : "Contrack will not suggest the two again",
      });
    } catch (err) {
      toast.error(
        `Could not undo: ${err instanceof Error ? err.message.replace(/\.$/, "") : String(err)}`,
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <li
      className={cn(
        "rounded-xl px-3 py-3 space-y-1",
        undone ? "bg-surface-container-low/60" : "bg-surface-container-lowest",
      )}
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className={cn(
            "p-1 rounded-md shrink-0 mt-0.5",
            TONE_WASH[undone ? "neutral" : auto ? "primary" : "success"],
          )}
        >
          {undone ? (
            <Undo2 className="w-3.5 h-3.5" />
          ) : auto ? (
            <Bot className="w-3.5 h-3.5" />
          ) : (
            <User className="w-3.5 h-3.5" />
          )}
        </span>
        <p className="flex-1 min-w-0 text-xs text-on-surface-variant pt-0.5">
          <span className="font-semibold">
            {auto ? "Merged automatically" : "Merged by you"}
          </span>
          {" · "}
          <time dateTime={at.toISOString()} title={at.toLocaleString()}>
            {Number.isNaN(at.getTime())
              ? ""
              : formatDistanceToNowStrict(at, { addSuffix: true })}
          </time>
        </p>
        {undone ? (
          <Badge>Undone</Badge>
        ) : (
          <button
            type="button"
            onClick={() => void handleUndo()}
            disabled={pending}
            aria-label={`Undo the merge of ${entry.duplicateName} into ${entry.primaryName}`}
            className="btn-secondary btn-sm shrink-0"
          >
            <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
            Undo
          </button>
        )}
      </div>
      <div className={cn("text-sm pl-7", undone && "text-on-surface-variant")}>
        <p className="break-words">
          <span className="font-bold">{entry.duplicateName}</span>
          {duplicateHint && (
            <span className="text-on-surface-variant"> · {duplicateHint}</span>
          )}
        </p>
        <p className="break-words">
          <span className="text-on-surface-variant">into </span>
          <span className="font-bold">{entry.primaryName}</span>
          {primaryHint && (
            <span className="text-on-surface-variant"> · {primaryHint}</span>
          )}
        </p>
        {reason && !/^User-initiated/i.test(reason) && (
          <p className="text-xs text-on-surface-variant mt-0.5 line-clamp-2">
            {reason}
          </p>
        )}
      </div>
    </li>
  );
}

export const MergeHistory = () => {
  const { data: entries = [], isLoading } = useMergeLog();
  const groups = useMemo(() => groupByDay(entries), [entries]);

  if (isLoading) {
    return (
      <p className="text-sm text-on-surface-variant py-6 text-center">
        Loading merges
      </p>
    );
  }

  if (entries.length === 0) {
    return (
      <EmptyState
        level={3}
        icon={Clock}
        title="No merges yet"
        body="Each merge shows here, and can be undone for 90 days"
      />
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-xs text-on-surface-variant">
        The latest 50 merges. Each can be undone for 90 days
      </p>
      {groups.map((group) => (
        <section key={group.label} aria-label={group.label}>
          <h3 className={cn(LABEL, "px-1 mb-2")}>{group.label}</h3>
          <ul className="space-y-1.5">
            {group.items.map((entry) => (
              <Entry key={entry.id} entry={entry} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
};
