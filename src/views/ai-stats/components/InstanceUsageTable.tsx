/**
 * Who spent it.
 *
 * The provider key is one key and the bill is one bill, so an operator asking
 * "why is this month expensive" needs the answer broken down by account. This
 * is the whole of what an admin sees about somebody else's AI use: counts,
 * tokens and cost. Not one prompt, not one description — the instance feed
 * omits that column for the same reason.
 */
import type { AIStatsUserUsage } from "../../../api/aiStats";
import { SECTION_HEADING } from "../../../lib/styles";
import { cn } from "../../../lib/utils";

const COLUMNS = "grid-cols-[minmax(0,1fr)_72px_72px_84px]";

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export const InstanceUsageTable = ({
  byUser,
  showCost,
}: {
  byUser: AIStatsUserUsage[];
  /** Hidden on a free tier, where every cost is zero and says nothing. */
  showCost: boolean;
}) => {
  if (byUser.length === 0) {
    return (
      <p className="text-sm text-on-surface-variant">
        No AI calls have been made on this instance yet.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <div
        className={cn(
          SECTION_HEADING,
          "grid gap-2 px-3 py-1.5 text-[10px]",
          COLUMNS,
        )}
      >
        <span>Account</span>
        <span className="text-right">Calls</span>
        <span className="text-right">Tokens</span>
        <span className="text-right">{showCost ? "Cost" : "Cached"}</span>
      </div>
      {byUser.map((row) => (
        <div
          key={row.userId}
          className={cn(
            "grid gap-2 px-3 py-2 rounded-lg text-xs tabular-nums",
            "odd:bg-surface-container-low/60",
            COLUMNS,
          )}
        >
          {/*
            A null username is an account that has been deleted while its
            invocation rows remain: `ai_invocations.ownerId` is not what the
            purge removes last, and the LEFT JOIN reports the gap honestly
            rather than dropping the spend from the total.
          */}
          <span className="truncate font-bold text-on-surface">
            {row.username ?? "Deleted account"}
          </span>
          <span className="text-right text-on-surface-variant">
            {compact(row.totalInvocations)}
          </span>
          <span className="text-right text-on-surface-variant">
            {compact(row.totalTokens)}
          </span>
          <span className="text-right text-on-surface-variant">
            {showCost
              ? `$${row.estimatedCostUsd.toFixed(row.estimatedCostUsd >= 1 ? 2 : 4)}`
              : compact(row.cachedCalls)}
          </span>
        </div>
      ))}
    </div>
  );
};
