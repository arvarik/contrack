import React from "react";
import { Link } from "react-router-dom";
import { Calendar, Cake, Video } from "lucide-react";
import { CardFrame } from "../components/CardFrame";
import { SETTINGS_PAGES } from "../../settings/registry";
import { fallbackAvatarUrl } from "../../../lib/avatar";
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
  contactsMap?: Map<
    string,
    { name: string; avatarUrl?: string | null; themeColor?: string }
  >;
}

export const ComingUpCard = ({
  birthdays = [],
  meetings = [],
  contactsMap = new Map(),
}: ComingUpCardProps) => {
  const hasConnectorsPage = SETTINGS_PAGES.some(
    (p) => p.id === "connectors" || p.path === "/settings/connectors",
  );

  const totalCount = birthdays.length + meetings.length;
  const isEmpty = totalCount === 0;

  return (
    <CardFrame
      cardId="coming-up"
      title="Coming up"
      icon={Calendar}
      count={totalCount}
    >
      {isEmpty ? (
        <div className="py-3 text-xs text-on-surface-variant">
          {hasConnectorsPage ? (
            <p>
              <Link
                to="/settings/connectors"
                className="text-primary hover:underline font-medium hit-area inline-block"
              >
                Connect a calendar
              </Link>{" "}
              to see upcoming meetings here.
            </p>
          ) : (
            <p className="italic">Nothing scheduled in the next 14 days.</p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Birthdays Section */}
          {birthdays.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                <Cake className="w-3 h-3 text-amber-500" />
                <span>Birthdays</span>
              </div>
              <div className="space-y-1.5">
                {birthdays.map((b) => (
                  <Link
                    key={b.contactId}
                    to={`/contact/${b.contactId}`}
                    className="flex items-center justify-between p-2 rounded-xl bg-surface-container-lowest hover:bg-surface-container border border-outline/10 transition-colors group text-xs"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 pr-2">
                      <img
                        src={b.avatarUrl || fallbackAvatarUrl(b.name)}
                        alt={b.name}
                        className="w-6 h-6 rounded-full object-cover shrink-0"
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="font-semibold text-on-surface group-hover:text-primary transition-colors truncate">
                          {b.name}
                        </span>
                        {b.turningAge !== null && (
                          <span className="text-[11px] text-on-surface-variant">
                            Turning {b.turningAge}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400 shrink-0 tabular-nums">
                      {b.daysUntil === 0
                        ? "Today"
                        : b.daysUntil === 1
                          ? "Tomorrow"
                          : `in ${b.daysUntil} days`}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Meetings Section */}
          {meetings.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                <Video className="w-3 h-3 text-primary" />
                <span>Meetings</span>
              </div>
              <div className="space-y-1.5">
                {meetings.map((m, idx) => {
                  let formattedTime = m.startsAt;
                  try {
                    const d = new Date(m.startsAt);
                    formattedTime = d.toLocaleDateString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    });
                  } catch {}

                  return (
                    <div
                      key={idx}
                      className="p-2 rounded-xl bg-surface-container-lowest border border-outline/10 text-xs flex flex-col gap-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-on-surface truncate">
                          {m.title}
                        </span>
                        <span className="text-[11px] text-on-surface-variant shrink-0 tabular-nums">
                          {formattedTime}
                        </span>
                      </div>
                      {m.contactIds.length > 0 && (
                        <div className="flex items-center gap-1 overflow-hidden">
                          {m.contactIds.map((cid) => {
                            const c = contactsMap.get(cid);
                            if (!c) return null;
                            return (
                              <Link
                                key={cid}
                                to={`/contact/${cid}`}
                                title={c.name}
                                className="hit-area shrink-0"
                              >
                                <img
                                  src={c.avatarUrl || fallbackAvatarUrl(c.name)}
                                  alt={c.name}
                                  className="w-5 h-5 rounded-full object-cover ring-1 ring-surface"
                                />
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </CardFrame>
  );
};
