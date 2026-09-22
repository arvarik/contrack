/**
 * ActivityCard: the heatmap of the last twelve weeks and the sparkline of
 * their totals. It reads its data from its prop: `PulseView` fetches the
 * activity once for the masthead and this card, so the card does not ask
 * the server a second time.
 */
import { CardFrame } from "../components/CardFrame";
import { Heatmap } from "./Heatmap";
import { Sparkline } from "./Sparkline";
import { usePreferences } from "../../../contexts/PreferencesContext";
import type { DashboardActivityResponse } from "../../../../shared/pulse";

export interface ActivityCardProps {
  /** Undefined while the page loads it. */
  activity?: DashboardActivityResponse | null;
}

export const ActivityCard = ({ activity }: ActivityCardProps) => {
  const { preferences } = usePreferences();
  const weekStart = preferences?.weekStart ?? "monday";

  if (!activity) {
    return (
      <CardFrame cardId="activity" title="Activity" compact>
        <div className="animate-pulse space-y-4 py-2" aria-busy="true">
          <div className="h-32 bg-surface-container-high rounded-xl" />
          <div className="h-10 bg-surface-container-high rounded-xl" />
        </div>
      </CardFrame>
    );
  }

  return (
    <CardFrame cardId="activity" title="Activity" compact>
      <div className="flex flex-col gap-4">
        <Heatmap
          days={activity.days}
          weekTotals={activity.weekTotals}
          thisWeekLogged={activity.thisWeek?.logged ?? 0}
          weekStartPref={weekStart}
        />
        <Sparkline
          weekTotals={activity.weekTotals}
          thisWeek={activity.thisWeek}
        />
      </div>
    </CardFrame>
  );
};
