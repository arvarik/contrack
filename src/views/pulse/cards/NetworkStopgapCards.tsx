import React, { useState, Suspense } from "react";
import {
  ActivitySquare,
  TrendingUp,
  PieChart,
  Users,
  UserPlus,
} from "lucide-react";
import { CardFrame } from "../components/CardFrame";
import { MetricCard } from "../MetricCard";
import {
  useDashboardActivity,
  useDashboardMomentum,
  DashboardPayload,
} from "../../../api";

const NetworkCompositionModal = React.lazy(() =>
  import("../NetworkCompositionModal").then((m) => ({
    default: m.NetworkCompositionModal,
  })),
);
const InteractionVelocityModal = React.lazy(() =>
  import("../InteractionVelocityModal").then((m) => ({
    default: m.InteractionVelocityModal,
  })),
);
const NetworkGrowthModal = React.lazy(() =>
  import("../NetworkGrowthModal").then((m) => ({
    default: m.NetworkGrowthModal,
  })),
);

export interface NetworkStopgapProps {
  dashboard: DashboardPayload;
}

export const ActivityCardStopgap = ({ dashboard }: NetworkStopgapProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const { data: _activity } = useDashboardActivity();

  return (
    <>
      <CardFrame
        cardId="activity"
        title="Activity"
        icon={ActivitySquare}
        compact
      >
        <div className="space-y-3">
          <MetricCard
            label="Interactions"
            value={dashboard.metrics.totalInteractions30d}
            subValue="interactions last month"
            icon={ActivitySquare}
            onClick={() => setIsOpen(true)}
          />
        </div>
      </CardFrame>

      {isOpen && (
        <Suspense fallback={null}>
          <InteractionVelocityModal
            isOpen={isOpen}
            onClose={() => setIsOpen(false)}
            breakdown={dashboard.interactionBreakdown30d || []}
          />
        </Suspense>
      )}
    </>
  );
};

export const MomentumCardStopgap = ({ dashboard }: NetworkStopgapProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const { data: momentum } = useDashboardMomentum();
  const snapshotWeeks = momentum?.snapshotWeeks ?? 0;

  return (
    <>
      <CardFrame cardId="momentum" title="Momentum" icon={TrendingUp} compact>
        <div className="space-y-3">
          {snapshotWeeks < 4 ? (
            <p className="text-xs text-on-surface-variant">
              Momentum needs four weeks of history.
            </p>
          ) : (
            <div className="text-xs text-on-surface">
              {momentum?.rising.length ?? 0} rising ·{" "}
              {momentum?.cooling.length ?? 0} cooling
            </div>
          )}

          <MetricCard
            label="Active Network"
            value={dashboard.metrics.totalActive}
            icon={Users}
            onClick={() => setIsOpen(true)}
          />
        </div>
      </CardFrame>

      {isOpen && (
        <Suspense fallback={null}>
          <NetworkCompositionModal
            isOpen={isOpen}
            onClose={() => setIsOpen(false)}
            composition={dashboard}
          />
        </Suspense>
      )}
    </>
  );
};

export const CompositionCardStopgap = ({ dashboard }: NetworkStopgapProps) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <CardFrame
        cardId="composition"
        title="Composition"
        icon={PieChart}
        compact
      >
        <div className="space-y-3">
          <MetricCard
            label="Network Growth"
            value={dashboard.metrics.newContacts30d}
            subValue="added this month"
            icon={UserPlus}
            onClick={() => setIsOpen(true)}
          />
        </div>
      </CardFrame>

      {isOpen && (
        <Suspense fallback={null}>
          <NetworkGrowthModal
            isOpen={isOpen}
            onClose={() => setIsOpen(false)}
            timeline={dashboard.networkGrowthTimeline30d || []}
            totalCount={dashboard.metrics.newContacts30d || 0}
          />
        </Suspense>
      )}
    </>
  );
};
