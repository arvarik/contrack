/**
 * KeepingUpCard: the state of the people you track, and their trend.
 *
 * One card on Pulse for tracking. It absorbs the Momentum card: rising and
 * cooling are the trend of the people you track, so they belong on the
 * card that shows the state of the people you track. From the top:
 *
 * 1. The bar: one `role="img"` named "42 tracked: 30 strong, 8 fading, 4
 *    at risk, 0 with no interactions yet", with a legend of links to the
 *    groups on the Tracked contacts page.
 * 2. One line: "31 of 42 within cadence, 11 to catch up". Catch up is on
 *    the same page, so the words are not a link.
 * 3. Rising and Cooling, up to three rows each, or one quiet line before
 *    four snapshot weeks exist.
 * 4. "5 tracked in the last 30 days", when above zero.
 *
 * Empty, when nobody is tracked, it is the upgrade moment: the words and
 * one button to the Tracked contacts page.
 */
import { Link, useNavigate } from "react-router-dom";
import { Radar } from "lucide-react";
import { CardFrame } from "../components/CardFrame";
import { EmptyState } from "../../../components/ui/EmptyState";
import { ScoreRingAvatar } from "../../../components/ScoreRingAvatar";
import { TRACKED_INTRO } from "../../../lib/names";
import { BTN_QUIET } from "../../../lib/styles";
import { cn } from "../../../lib/utils";
import type { MomentumCard, TrackingSummary } from "../../../../shared/pulse";

export interface KeepingUpCardProps {
  tracking: TrackingSummary | undefined;
}

/** The four segments of the bar, in order, with the group each links to. */
const SEGMENTS = [
  { key: "strong", label: "Strong", tone: "bg-success", hash: "strong" },
  { key: "fading", label: "Fading", tone: "bg-warning", hash: "fading" },
  { key: "atRisk", label: "At risk", tone: "bg-error", hash: "at-risk" },
  {
    key: "unscored",
    label: "No interactions yet",
    tone: "bg-surface-container-highest",
    hash: "unscored",
  },
] as const;

/** "1 strong" or "2 with no interactions yet", for the bar's name. */
function segmentWords(key: (typeof SEGMENTS)[number]["key"], n: number) {
  if (key === "unscored") return `${n} with no interactions yet`;
  return `${n} ${SEGMENTS.find((s) => s.key === key)!.label.toLowerCase()}`;
}

const TrendRow = ({
  contact,
  tone,
}: {
  contact: MomentumCard;
  tone: "success" | "error";
}) => (
  <li className="flex items-center justify-between gap-2 min-w-0">
    <div className="flex items-center gap-2 min-w-0">
      <ScoreRingAvatar
        contact={{
          name: contact.name,
          avatarUrl: contact.avatarUrl,
          // Every card on Pulse names a contact somebody tracks.
          isTracked: true,
          relationshipScore: contact.relationshipScore,
          lastContactedAt: contact.lastContactedAt,
        }}
        size={28}
        ring="list"
        decorative
      />
      <Link
        to={`/contact/${contact.id}`}
        className="hit-area text-xs font-semibold text-on-surface hover:text-primary truncate transition-colors"
      >
        {contact.name}
      </Link>
    </div>
    <span
      className={cn(
        "shrink-0 px-2 py-0.5 rounded-md text-[11px] font-semibold tabular-nums",
        tone === "success"
          ? "bg-success/10 text-success"
          : "bg-error/10 text-error",
      )}
    >
      {contact.delta > 0 ? `+${contact.delta}` : `−${Math.abs(contact.delta)}`}
    </span>
  </li>
);

export const KeepingUpCard = ({ tracking }: KeepingUpCardProps) => {
  const navigate = useNavigate();

  if (!tracking) {
    return (
      <CardFrame cardId="keeping-up" title="Keeping up" icon={Radar} compact>
        <div className="animate-pulse space-y-3 py-2" aria-busy="true">
          <div className="h-2 bg-surface-container-high rounded-full" />
          <div className="h-4 bg-surface-container-high rounded w-2/3" />
        </div>
      </CardFrame>
    );
  }

  const { count, bands, catchUpCount, startedLast30d, snapshotWeeks } =
    tracking;

  if (count === 0) {
    return (
      <CardFrame cardId="keeping-up" title="Keeping up" icon={Radar} compact>
        <EmptyState
          level={3}
          icon={Radar}
          title="Nobody is tracked yet"
          body={TRACKED_INTRO}
          action={{
            label: "Choose people",
            onClick: () => navigate("/tracked"),
          }}
        />
      </CardFrame>
    );
  }

  const withinCadence = Math.max(0, count - catchUpCount);
  const barName = `${count} tracked: ${SEGMENTS.map((s) =>
    segmentWords(s.key, bands[s.key]),
  ).join(", ")}`;
  const trendReady = snapshotWeeks >= 4;

  return (
    <CardFrame
      cardId="keeping-up"
      title="Keeping up"
      icon={Radar}
      count={count}
      compact
      headerAction={
        <Link to="/tracked" className={BTN_QUIET}>
          Manage
        </Link>
      }
    >
      <div className="flex flex-col gap-4">
        {/* The bar, and its legend */}
        <div className="flex flex-col gap-2">
          <div
            role="img"
            aria-label={barName}
            className="flex h-2 w-full rounded-full overflow-hidden bg-surface-container-low"
          >
            {SEGMENTS.map((s) =>
              bands[s.key] > 0 ? (
                <span
                  key={s.key}
                  className={cn("h-full", s.tone)}
                  style={{ width: `${(bands[s.key] / count) * 100}%` }}
                />
              ) : null,
            )}
          </div>
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {SEGMENTS.map((s) =>
              bands[s.key] > 0 ? (
                <li key={s.key}>
                  <Link
                    to={`/tracked#${s.hash}`}
                    className="hit-area inline-flex items-center gap-1.5 font-medium text-on-surface-variant hover:text-primary transition-colors"
                  >
                    <span
                      aria-hidden="true"
                      className={cn("w-2 h-2 rounded-full", s.tone)}
                    />
                    <span className="tabular-nums">{bands[s.key]}</span>{" "}
                    {s.label}
                  </Link>
                </li>
              ) : null,
            )}
          </ul>
        </div>

        <p className="text-sm text-on-surface tabular-nums">
          {withinCadence} of {count} within cadence, {catchUpCount} to catch up
        </p>

        {/* Rising and Cooling, or the four-week line */}
        {trendReady ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(
              [
                ["Rising", tracking.rising, "success"],
                ["Cooling", tracking.cooling, "error"],
              ] as const
            ).map(([title, rows, tone]) => (
              <div key={title} className="flex flex-col gap-1.5 min-w-0">
                <h3
                  className={cn(
                    "text-xs font-bold px-0.5",
                    tone === "success" ? "text-success" : "text-error",
                  )}
                >
                  {title}
                </h3>
                {rows.length > 0 ? (
                  <ul className="flex flex-col gap-1">
                    {rows.map((c) => (
                      <TrendRow key={c.id} contact={c} tone={tone} />
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-on-surface-variant px-0.5">
                    None this month
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-on-surface-variant">
            Rising and cooling show after four weeks of tracking.
          </p>
        )}

        {startedLast30d > 0 && (
          <p className="text-xs text-on-surface-variant tabular-nums">
            {startedLast30d} tracked in the last 30 days
          </p>
        )}
      </div>
    </CardFrame>
  );
};
