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
 * 2. The number: "31" large, then "of 42 within cadence", and when anybody
 *    is past cadence a quiet button, "11 to catch up", that scrolls to the
 *    Catch up group of the queue on this page.
 * 3. Rising and Cooling, up to three rows each, once four snapshot weeks
 *    exist. Before that the card says nothing about them: a line that
 *    promises a feature in four weeks is not a fact about the network.
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
import { BTN_QUIET, TONE_DOT, TONE_TEXT, TONE_WASH } from "../../../lib/styles";
import { cn } from "../../../lib/utils";
import { PULSE_CHIP, PULSE_TYPE } from "../lib/pulseStyles";
import { jumpToGroup } from "../lib/jumpToGroup";
import type { MomentumCard, TrackingSummary } from "../../../../shared/pulse";

export interface KeepingUpCardProps {
  tracking: TrackingSummary | undefined;
}

/**
 * The four segments of the bar, in order, with the group each links to.
 * Strong, fading and at risk are tones. "No interactions yet" is not a
 * state of a relationship, so it is the bar's neutral track colour.
 */
const SEGMENTS = [
  { key: "strong", label: "Strong", fill: TONE_DOT.success, hash: "strong" },
  { key: "fading", label: "Fading", fill: TONE_DOT.warning, hash: "fading" },
  { key: "atRisk", label: "At risk", fill: TONE_DOT.error, hash: "at-risk" },
  {
    key: "unscored",
    label: "No interactions yet",
    fill: "bg-surface-container-highest",
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
        className={cn(
          PULSE_TYPE.name,
          "hit-area hover:text-primary truncate transition-colors",
        )}
      >
        {contact.name}
      </Link>
    </div>
    <span className={cn(PULSE_CHIP, TONE_WASH[tone])}>
      {contact.delta > 0 ? `+${contact.delta}` : `−${Math.abs(contact.delta)}`}
    </span>
  </li>
);

export const KeepingUpCard = ({ tracking }: KeepingUpCardProps) => {
  const navigate = useNavigate();

  if (!tracking) {
    return (
      <CardFrame cardId="keeping-up" title="Keeping up">
        <div className="animate-pulse space-y-3 py-2" aria-busy="true">
          <div className="h-2.5 bg-surface-container-high rounded-full" />
          <div className="h-7 bg-surface-container-high rounded w-2/3" />
        </div>
      </CardFrame>
    );
  }

  const { count, bands, catchUpCount, snapshotWeeks } = tracking;

  if (count === 0) {
    return (
      <CardFrame cardId="keeping-up" title="Keeping up">
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
      count={count}
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
            className="flex h-2.5 w-full rounded-full overflow-hidden bg-surface-container-low"
          >
            {SEGMENTS.map((s) =>
              bands[s.key] > 0 ? (
                <span
                  key={s.key}
                  className={cn("h-full", s.fill)}
                  style={{ width: `${(bands[s.key] / count) * 100}%` }}
                />
              ) : null,
            )}
          </div>
          <ul className={cn(PULSE_TYPE.meta, "flex flex-wrap gap-x-3 gap-y-1")}>
            {SEGMENTS.map((s) =>
              bands[s.key] > 0 ? (
                <li key={s.key}>
                  <Link
                    to={`/tracked#${s.hash}`}
                    className="hit-area inline-flex items-center gap-1.5 font-medium hover:text-primary transition-colors"
                  >
                    <span
                      aria-hidden="true"
                      className={cn("w-2 h-2 rounded-full", s.fill)}
                    />
                    <span className="tabular-nums">{bands[s.key]}</span>{" "}
                    {s.label}
                  </Link>
                </li>
              ) : null,
            )}
          </ul>
        </div>

        {/* The number, and the door to the Catch up group of the queue */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="flex items-baseline gap-1.5 min-w-0">
            <span className={PULSE_TYPE.figure}>{withinCadence}</span>
            <span className={PULSE_TYPE.meta}>of {count} within cadence</span>
          </p>
          {catchUpCount > 0 && (
            <button
              type="button"
              onClick={() => jumpToGroup("catch-up")}
              className={cn(BTN_QUIET, "ml-auto -mr-2 cursor-pointer")}
            >
              {catchUpCount} to catch up
            </button>
          )}
        </div>

        {/* Rising and Cooling, once four snapshot weeks exist */}
        {trendReady && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(
              [
                ["Rising", tracking.rising, "success"],
                ["Cooling", tracking.cooling, "error"],
              ] as const
            ).map(([title, rows, tone]) => (
              <div key={title} className="flex flex-col gap-1.5 min-w-0">
                <h3 className={cn(PULSE_TYPE.group, "px-0.5", TONE_TEXT[tone])}>
                  {title}
                </h3>
                {rows.length > 0 ? (
                  <ul className="flex flex-col gap-1">
                    {rows.map((c) => (
                      <TrendRow key={c.id} contact={c} tone={tone} />
                    ))}
                  </ul>
                ) : (
                  <p className={cn(PULSE_TYPE.meta, "px-0.5")}>
                    None this month
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </CardFrame>
  );
};
