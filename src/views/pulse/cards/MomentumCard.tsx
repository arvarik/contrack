import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { TrendingUp, TrendingDown, Clock, Info } from "lucide-react";
import { CardFrame } from "../components/CardFrame";
import { ScoreRingAvatar } from "../../../components/ScoreRingAvatar";
import { useDashboardMomentum } from "../../../api";
import type {
  DashboardMomentumResponse,
  MomentumCard as MomentumContact,
  SilentCard as SilentContact,
} from "../../../../shared/pulse";

export interface MomentumCardProps {
  momentum?: DashboardMomentumResponse | null;
  isLoading?: boolean;
}

const ContactRow = ({
  contact,
  badge,
  badgeVariant = "neutral",
  onClick,
}: {
  contact: {
    id: string;
    name: string;
    avatarUrl?: string | null;
    relationshipScore?: number | null;
    company?: string | null;
  };
  badge: React.ReactNode;
  badgeVariant?: "success" | "warning" | "error" | "neutral";
  onClick: () => void;
}) => {
  const badgeClasses = {
    success: "bg-success/10 text-success border-success/20",
    warning: "bg-warning/10 text-warning border-warning/20",
    error: "bg-error/10 text-error border-error/20",
    neutral:
      "bg-surface-container-high text-on-surface-variant border-outline/10",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="hit-area flex items-center justify-between gap-2 p-1.5 rounded-xl hover:bg-surface-container transition-colors cursor-pointer w-full text-left group"
    >
      <div className="flex items-center gap-2 min-w-0 pr-1">
        <ScoreRingAvatar
          contact={{
            name: contact.name,
            avatarUrl: contact.avatarUrl,
            relationshipScore: contact.relationshipScore,
          }}
          size={28}
          ring="list"
          decorative
        />
        <span className="text-xs font-semibold text-on-surface truncate group-hover:text-primary transition-colors">
          {contact.name}
        </span>
      </div>
      <span
        className={`shrink-0 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${badgeClasses[badgeVariant]}`}
      >
        {badge}
      </span>
    </button>
  );
};

export const MomentumCard = ({
  momentum: initialMomentum,
  isLoading: initialLoading,
}: MomentumCardProps) => {
  const navigate = useNavigate();
  const { data: fetchedMomentum, isLoading: queryLoading } =
    useDashboardMomentum();

  const momentum = initialMomentum ?? fetchedMomentum;
  const isLoading = initialLoading ?? (queryLoading && !momentum);
  const snapshotWeeks = momentum?.snapshotWeeks ?? 0;

  const rising = useMemo(
    () => (momentum?.rising ?? []).slice(0, 5),
    [momentum?.rising],
  );
  const cooling = useMemo(
    () => (momentum?.cooling ?? []).slice(0, 5),
    [momentum?.cooling],
  );
  const silent = useMemo(
    () => (momentum?.silent ?? []).slice(0, 5),
    [momentum?.silent],
  );

  if (isLoading || !momentum) {
    return (
      <CardFrame cardId="momentum" title="Momentum" icon={TrendingUp} compact>
        <div className="animate-pulse space-y-3 py-2">
          <div className="h-4 bg-surface-container-high rounded w-1/3" />
          <div className="h-16 bg-surface-container-high rounded-xl" />
        </div>
      </CardFrame>
    );
  }

  const handleOpenContact = (id: string) => {
    navigate(`/contact/${id}`);
  };

  // Render when fewer than 4 weeks of snapshot history
  if (snapshotWeeks < 4) {
    return (
      <CardFrame cardId="momentum" title="Momentum" icon={TrendingUp} compact>
        <div className="flex flex-col gap-4">
          {/* Four-week message */}
          <div className="p-3.5 rounded-xl bg-surface-container-low border border-outline/10 flex items-start gap-2.5">
            <Info className="w-4 h-4 text-on-surface-variant shrink-0 mt-0.5" />
            <div className="text-xs text-on-surface-variant leading-relaxed">
              <strong className="text-on-surface block font-semibold mb-0.5">
                Momentum needs four weeks of history.
              </strong>
              Rising and cooling relationship movements appear once weekly score
              snapshots establish a four-week baseline.
            </div>
          </div>

          {/* Silent column still shows */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5 text-xs font-bold text-error px-1">
              <Clock className="w-3.5 h-3.5" />
              <span>Silent</span>
            </div>
            {silent.length > 0 ? (
              <div className="flex flex-col gap-1">
                {silent.map((c: SilentContact) => (
                  <ContactRow
                    key={c.id}
                    contact={c}
                    badge={`${c.overshootDays} d over`}
                    badgeVariant="error"
                    onClick={() => handleOpenContact(c.id)}
                  />
                ))}
              </div>
            ) : (
              <p className="text-xs text-on-surface-variant px-1 italic">
                No silent contacts past cadence
              </p>
            )}
          </div>
        </div>
      </CardFrame>
    );
  }

  return (
    <CardFrame cardId="momentum" title="Momentum" icon={TrendingUp} compact>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Rising Column */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-xs font-bold text-success px-1">
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Rising</span>
          </div>
          {rising.length > 0 ? (
            <div className="flex flex-col gap-1">
              {rising.map((c: MomentumContact) => (
                <ContactRow
                  key={c.id}
                  contact={c}
                  badge={c.delta > 0 ? `+${c.delta}` : `${c.delta}`}
                  badgeVariant="success"
                  onClick={() => handleOpenContact(c.id)}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-on-surface-variant px-1 italic">None</p>
          )}
        </div>

        {/* Cooling Column */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-xs font-bold text-warning px-1">
            <TrendingDown className="w-3.5 h-3.5" />
            <span>Cooling</span>
          </div>
          {cooling.length > 0 ? (
            <div className="flex flex-col gap-1">
              {cooling.map((c: MomentumContact) => (
                <ContactRow
                  key={c.id}
                  contact={c}
                  badge={`${c.delta}`}
                  badgeVariant="warning"
                  onClick={() => handleOpenContact(c.id)}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-on-surface-variant px-1 italic">None</p>
          )}
        </div>

        {/* Silent Column */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-xs font-bold text-error px-1">
            <Clock className="w-3.5 h-3.5" />
            <span>Silent</span>
          </div>
          {silent.length > 0 ? (
            <div className="flex flex-col gap-1">
              {silent.map((c: SilentContact) => (
                <ContactRow
                  key={c.id}
                  contact={c}
                  badge={`${c.overshootDays} d over`}
                  badgeVariant="error"
                  onClick={() => handleOpenContact(c.id)}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-on-surface-variant px-1 italic">None</p>
          )}
        </div>
      </div>
    </CardFrame>
  );
};
