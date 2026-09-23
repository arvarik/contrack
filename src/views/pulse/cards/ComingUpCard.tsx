/**
 * ComingUpCard: what the next two weeks hold, in the order it arrives.
 *
 * One dated list. A birthday in days eight to fourteen and a meeting from a
 * connected calendar are both "coming up", so they sit in one list ordered
 * by date, each row with a chip that says when: "Tomorrow", "Thursday", "In
 * 10 days". A birthday in the next seven days is in Up next already, and a
 * fact appears once on this page, so the card starts where the queue ends.
 *
 * With nothing in two weeks the card is one line, and the line offers the
 * one thing that would fill it: a calendar.
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Cake, Video } from "lucide-react";
import { differenceInCalendarDays } from "date-fns";
import { CardFrame } from "../components/CardFrame";
import { ScoreRingAvatar } from "../../../components/ScoreRingAvatar";
import { SETTINGS_PAGES } from "../../settings/registry";
import { fallbackAvatarUrl } from "../../../lib/avatar";
import { TONE_TEXT, TONE_WASH } from "../../../lib/styles";
import { cn } from "../../../lib/utils";
import {
  PULSE_CHIP,
  PULSE_ROW,
  PULSE_ROW_STATIC,
  PULSE_TYPE,
} from "../lib/pulseStyles";
import { describeDueChip } from "../lib/upNext";
import type { UpcomingBirthday } from "../lib/birthdays";

export interface MeetingItem {
  title: string;
  startsAt: string;
  endsAt: string;
  contactIds: string[];
}

export interface ComingUpCardProps {
  birthdays?: UpcomingBirthday[];
  meetings?: MeetingItem[];
  contactsMap?: Map<string, { name: string; avatarUrl?: string | null }>;
}

/** Up next owns birthdays through day seven. This card starts at day eight. */
export const COMING_UP_FROM_DAY = 8;

type Entry =
  | { kind: "birthday"; key: string; when: Date; birthday: UpcomingBirthday }
  | { kind: "meeting"; key: string; when: Date; meeting: MeetingItem };

/** "Thu 2 Oct, 3:00 PM" in the person's own locale. */
function formatMeetingTime(startsAt: string): string {
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return startsAt;
  return date.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export const ComingUpCard = ({
  birthdays = [],
  meetings = [],
  contactsMap = new Map(),
}: ComingUpCardProps) => {
  const hasConnectorsPage = SETTINGS_PAGES.some(
    (p) => p.id === "connectors" || p.path === "/settings/connectors",
  );

  const entries = useMemo<Entry[]>(() => {
    const list: Entry[] = [];
    for (const b of birthdays) {
      if (b.daysUntil < COMING_UP_FROM_DAY) continue;
      list.push({
        kind: "birthday",
        key: `b-${b.contactId}`,
        when: b.nextDate,
        birthday: b,
      });
    }
    meetings.forEach((m, index) => {
      const when = new Date(m.startsAt);
      list.push({
        kind: "meeting",
        key: `m-${index}-${m.startsAt}`,
        when: Number.isNaN(when.getTime()) ? new Date(8640000000000000) : when,
        meeting: m,
      });
    });
    return list.sort((a, b) => a.when.getTime() - b.when.getTime());
  }, [birthdays, meetings]);

  if (entries.length === 0) {
    return (
      <CardFrame cardId="coming-up" title="Coming up" count={0} variant="line">
        Nothing in the next two weeks.
        {hasConnectorsPage && (
          <>
            {" "}
            <Link
              to="/settings/connectors"
              className="hit-area inline-flex items-center font-medium text-primary hover:underline underline-offset-4"
            >
              Connect a calendar
            </Link>
          </>
        )}
      </CardFrame>
    );
  }

  const now = new Date();

  return (
    <CardFrame cardId="coming-up" title="Coming up" count={entries.length}>
      <ul className="flex flex-col gap-1.5">
        {entries.map((entry) => {
          const days = differenceInCalendarDays(entry.when, now);
          const chip = (
            <span className={cn(PULSE_CHIP, TONE_WASH.neutral)}>
              {describeDueChip(days, entry.when)}
            </span>
          );

          if (entry.kind === "birthday") {
            const b = entry.birthday;
            return (
              <li key={entry.key}>
                <Link to={`/contact/${b.contactId}`} className={PULSE_ROW}>
                  <ScoreRingAvatar
                    contact={{
                      name: b.name,
                      avatarUrl: b.avatarUrl,
                      isTracked: b.isTracked,
                      relationshipScore: b.relationshipScore,
                      lastContactedAt: b.lastContactedAt,
                    }}
                    size={32}
                    ring="list"
                    decorative
                  />
                  <span className="flex flex-col min-w-0 flex-1">
                    <span className={cn(PULSE_TYPE.name, "truncate")}>
                      {b.name}
                    </span>
                    <span
                      className={cn(
                        PULSE_TYPE.meta,
                        "inline-flex items-center gap-1",
                      )}
                    >
                      <Cake
                        className={cn(
                          "w-3.5 h-3.5 shrink-0",
                          TONE_TEXT.warning,
                        )}
                        aria-hidden="true"
                      />
                      {b.turningAge !== null
                        ? `Turns ${b.turningAge}`
                        : "Birthday"}
                    </span>
                  </span>
                  {chip}
                </Link>
              </li>
            );
          }

          const m = entry.meeting;
          const people = m.contactIds
            .map((cid) => ({ cid, contact: contactsMap.get(cid) }))
            .filter((p) => p.contact);
          return (
            // Not a link, so the row has no hover layer. Its people are links.
            <li key={entry.key} className={cn(PULSE_ROW_STATIC, "items-start")}>
              <span
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                  TONE_WASH.primary,
                )}
                aria-hidden="true"
              >
                <Video className="w-4 h-4" />
              </span>
              <span className="flex flex-col min-w-0 flex-1 gap-1">
                <span
                  className={cn(PULSE_TYPE.rowTitle, "font-semibold truncate")}
                >
                  {m.title}
                </span>
                <span className={cn(PULSE_TYPE.meta, "tabular-nums")}>
                  {formatMeetingTime(m.startsAt)}
                </span>
                {people.length > 0 && (
                  <span className="flex items-center gap-1 pt-0.5">
                    {people.map(({ cid, contact }) => (
                      <Link
                        key={cid}
                        to={`/contact/${cid}`}
                        aria-label={contact!.name}
                        className="hit-area shrink-0"
                      >
                        <img
                          src={
                            contact!.avatarUrl ||
                            fallbackAvatarUrl(contact!.name)
                          }
                          alt=""
                          className="w-5 h-5 rounded-full object-cover ring-1 ring-surface"
                        />
                      </Link>
                    ))}
                  </span>
                )}
              </span>
              {chip}
            </li>
          );
        })}
      </ul>
    </CardFrame>
  );
};
