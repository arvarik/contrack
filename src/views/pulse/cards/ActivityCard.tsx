import { CardFrame } from "../components/CardFrame";
import { Heatmap } from "./Heatmap";
import { Sparkline } from "./Sparkline";
import { useDashboardActivity } from "../../../api";
import { usePreferences } from "../../../contexts/PreferencesContext";
import type { DashboardActivityResponse } from "../../../../shared/pulse";

export interface ActivityCardProps {
  activity?: DashboardActivityResponse | null;
  isLoading?: boolean;
}

export const ActivityCard = ({
  activity: initialActivity,
  isLoading: initialLoading,
}: ActivityCardProps) => {
  const { data: fetchedActivity, isLoading: queryLoading } =
    useDashboardActivity();
  const { preferences } = usePreferences();

  const activity = initialActivity ?? fetchedActivity;
  const isLoading = initialLoading ?? (queryLoading && !activity);
  const weekStart = preferences?.weekStart ?? "monday";

  if (isLoading || !activity) {
    return (
      <CardFrame cardId="activity" title="Activity" compact>
        <div className="animate-pulse space-y-4 py-2">
          <div className="h-24 bg-surface-container-high rounded-xl" />
          <div className="h-10 bg-surface-container-high rounded-xl" />
        </div>
      </CardFrame>
    );
  }

  return (
    <CardFrame cardId="activity" title="Activity" compact>
      <div className="flex flex-col gap-3">
        <Heatmap
          days={activity.days}
          weekTotals={activity.weekTotals}
          thisWeekLogged={activity.thisWeek?.logged ?? 0}
          weekStartPref={weekStart}
        />
        <Sparkline
          weekTotals={activity.weekTotals}
          streak={activity.streak}
          thisWeek={activity.thisWeek}
        />
      </div>
    </CardFrame>
  );
};
