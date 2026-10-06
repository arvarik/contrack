/**
 * The interactions of one contact, in one column, newest first: a date
 * column, the type glyph, and a full-width card per entry.
 *
 * Entries group under "This week" or their month (with the year when it is
 * not this one). Delete asks first, then hides the entry and offers Undo.
 * The server delete waits until the undo window ends (`lib/pendingDeletes`).
 */
import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import { Facebook, Linkedin } from "../../../components/socialIcons";
import {
  CalendarCheck,
  ExternalLink,
  File,
  FileText,
  Handshake,
  Mail,
  MessageSquare,
  Pencil,
  Phone,
  Sparkles,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import DOMPurify from "dompurify";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { weekStartsOn } from "../../../../shared/dates";
import { connectorViaLabel } from "../../../../shared/connectors";

import type { Interaction } from "../../../types";
import { cn, safeHref } from "../../../lib/utils";
import {
  LABEL,
  SECTION_HEADING,
  TIMELINE_CARD,
  TONE_WASH,
} from "../../../lib/styles";
import { TIPTAP_SANITIZE_CONFIG } from "../../../lib/sanitize";
import { formatDay, parseServerTime } from "../../../lib/datetime";
import {
  startPendingDelete,
  useHiddenPendingIds,
} from "../../../lib/pendingDeletes";
import { ActionMenu } from "../../../components/ui/ActionMenu";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { useMarkFollowUpDone } from "../../../hooks/useMarkFollowUpDone";
import { InteractionDetailModal } from "./InteractionDetailModal";

// The parent's mutations are passed as `mutate` or `mutateAsync`, which keep
// one identity, so the memoized tab and entries skip the parent's renders.

/**
 * `mutateAsync`, not `mutate`: the undo window can end after the page has
 * closed or while a second delete is out. React Query then drops a `mutate`
 * call's callbacks, but the promise still settles.
 */
export type DeleteInteraction = (args: {
  id: string;
  contactId: string;
}) => Promise<unknown>;

/** The update's `mutateAsync`: the note overlay keeps an edit that failed. */
export type UpdateInteraction = (args: {
  id: string;
  contactId: string;
  data: { title?: string; content?: string | null };
}) => Promise<unknown>;

export type PromoteGhost = (
  id: string,
  opts?: { onSuccess?: () => void },
) => void;

/** The interaction in the detail modal, and the mode the modal opens in. */
export interface OpenedInteraction {
  interaction: Interaction;
  /** True when the kebab's Edit opened it. */
  editing: boolean;
}

interface TimelineProps {
  contactId: string;
  timeline: Interaction[];
  /** The interaction in the detail modal. The tab owns it for `?interaction=`. */
  opened: OpenedInteraction | null;
  onOpenedChange: (next: OpenedInteraction | null) => void;
  deleteInteraction: DeleteInteraction;
  updateInteraction: UpdateInteraction;
  promoteGhost: PromoteGhost;
}

/** Info is not one of the shared tones, so it keeps its own wash. */
const INFO_WASH = "bg-info/10 text-info";

/**
 * The glyph for an interaction type, on its color's wash. The shared tones
 * (`TONE_WASH`) are measured by `tests/unit/frontend/style/themeContrast.test.ts`.
 */
function getInteractionStyle(type: string): { Icon: LucideIcon; tone: string } {
  switch (type) {
    case "call":
      return { Icon: Phone, tone: INFO_WASH };
    case "meeting":
      return { Icon: Handshake, tone: TONE_WASH.success };
    case "email":
      return { Icon: Mail, tone: TONE_WASH.success };
    case "note":
      return { Icon: FileText, tone: "bg-ai/10 text-ai" };
    case "message":
    case "sms":
      return { Icon: MessageSquare, tone: TONE_WASH.success };
    case "linkedin":
      return { Icon: Linkedin, tone: INFO_WASH };
    case "facebook":
      return { Icon: Facebook, tone: INFO_WASH };
    case "import":
      return { Icon: ExternalLink, tone: TONE_WASH.warning };
    default:
      return { Icon: FileText, tone: TONE_WASH.neutral };
  }
}

interface ParsedMention {
  contactId: string;
  name: string;
  isGhost?: boolean;
}

/** Null when the mentions JSON is empty or invalid. */
function parseMentions(raw: string | null | undefined): ParsedMention[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed;
  } catch (err) {
    console.warn("[Timeline] Failed to parse mentions JSON:", err);
    return null;
  }
}

const MONTH = new Intl.DateTimeFormat(undefined, { month: "long" });
const MONTH_YEAR = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
});
const SHORT_MONTH = new Intl.DateTimeFormat(undefined, { month: "short" });

interface DatedEntry {
  item: Interaction;
  /** Null when the date cannot be read. */
  date: Date | null;
}

interface TimelineGroup {
  key: string;
  label: string;
  entries: DatedEntry[];
}

/** Local midnight at the start of the week that holds `now`. */
function startOfWeek(now: Date, weekStartDay: 0 | 1 = 1): Date {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - ((start.getDay() - weekStartDay + 7) % 7));
  return start;
}

/**
 * Sort newest first and split into runs of neighbors with the same heading.
 * A future entry goes under its month, so one month can have a group on
 * each side of "This week". They are not merged: that breaks date order.
 */
function groupEntries(
  items: Interaction[],
  now: Date,
  weekStartDay: 0 | 1 = 1,
): TimelineGroup[] {
  const weekStart = startOfWeek(now, weekStartDay).getTime();
  const nextWeek = new Date(weekStart);
  nextWeek.setDate(nextWeek.getDate() + 7);
  const weekEnd = nextWeek.getTime();

  const time = (entry: DatedEntry) =>
    entry.date ? entry.date.getTime() : Number.NEGATIVE_INFINITY;
  // A guard on the server order: undated entries go last, ties keep order.
  const dated = items
    .map((item) => ({ item, date: parseServerTime(item.date) }))
    .sort((a, b) => time(b) - time(a) || 0);

  const groups: TimelineGroup[] = [];
  for (const entry of dated) {
    const { key, label } = headingFor(entry.date, now, weekStart, weekEnd);
    const last = groups[groups.length - 1];
    if (last?.key === key) last.entries.push(entry);
    else groups.push({ key, label, entries: [entry] });
  }
  return groups;
}

function headingFor(
  date: Date | null,
  now: Date,
  weekStart: number,
  weekEnd: number,
): { key: string; label: string } {
  if (!date) return { key: "undated", label: "No date" };
  const at = date.getTime();
  if (at >= weekStart && at < weekEnd)
    return { key: "week", label: "This week" };
  return {
    key: `${date.getFullYear()}-${date.getMonth()}`,
    label:
      date.getFullYear() === now.getFullYear()
        ? MONTH.format(date)
        : MONTH_YEAR.format(date),
  };
}

/** The title button of an entry, which takes focus after a delete. */
const titleButton = (id: string) =>
  document
    .getElementById(`interaction-${id}`)
    ?.querySelector<HTMLButtonElement>("h3 button") ?? null;

/** Memoized so DOMPurify runs only when the entry's HTML changes. */
const InteractionContent = React.memo(({ html }: { html: string }) => {
  const sanitized = useMemo(
    () => DOMPurify.sanitize(html, TIPTAP_SANITIZE_CONFIG),
    [html],
  );
  return (
    <div
      className="prose prose-sm max-w-none text-on-surface-variant leading-relaxed prose-p:my-1 prose-headings:my-2 prose-headings:text-on-surface prose-strong:text-on-surface line-clamp-3 pointer-events-none"
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
});

/**
 * Hidden with opacity, not `display`, so Tab still reaches it. Always shown
 * on a touch screen, which has no hover.
 */
const KEBAB_TRIGGER =
  "transition pointer-fine:opacity-0 pointer-fine:group-hover/entry:opacity-100 pointer-fine:group-focus-within/entry:opacity-100 pointer-fine:aria-expanded:opacity-100";

const SOURCE_BADGE =
  "inline-flex items-center rounded-md bg-surface-container-high px-2 py-0.5 text-[11px] font-medium text-on-surface-variant";

interface TimelineEntryProps {
  entry: DatedEntry;
  /** For the entrance stagger. */
  index: number;
  /** Slide in: the entry arrived after the timeline had drawn. */
  arrived: boolean;
  onOpen: (item: Interaction, editing: boolean) => void;
  onAskDelete: (item: Interaction) => void;
  promoteGhost: PromoteGhost;
  /** A follow-up marked done in its undo window reads as done here too. */
  pending: ReadonlySet<string>;
}

const TimelineEntry = React.memo(
  ({
    entry,
    index,
    arrived,
    onOpen,
    onAskDelete,
    promoteGhost,
    pending,
  }: TimelineEntryProps) => {
    const navigate = useNavigate();
    // The entrance transform makes each entry a stacking context, so an
    // open menu lifts its entry above the next one.
    const [menuOpen, setMenuOpen] = useState(false);
    const { item, date } = entry;
    const { Icon, tone } = getInteractionStyle(item.type);
    const mentions = useMemo(
      () => parseMentions(item.mentions),
      [item.mentions],
    );

    return (
      <li
        id={`interaction-${item.id}`}
        title={formatDay(item.date)}
        className={cn(
          "group/entry relative flex gap-3 sm:gap-4",
          arrived && "timeline-entry",
          menuOpen && "z-10",
        )}
        style={
          arrived
            ? { animationDelay: `${Math.min(index, 6) * 25}ms` }
            : undefined
        }
      >
        <div className="w-16 shrink-0 pt-4">
          {date && (
            <time
              dateTime={date.toISOString()}
              className="flex flex-col items-center text-center"
            >
              <span className="font-headline text-xl font-bold leading-none tabular-nums text-on-surface">
                {date.getDate()}
              </span>{" "}
              <span className="mt-1 text-xs font-medium text-on-surface-variant">
                {SHORT_MONTH.format(date)}
              </span>
            </time>
          )}
        </div>

        <div className={cn(TIMELINE_CARD, "flex min-w-0 flex-1 gap-3")}>
          <div
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
              tone,
            )}
          >
            <Icon aria-hidden="true" className="h-4 w-4" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1 pt-1 flex flex-wrap items-center gap-2">
                <h3 className="font-bold text-on-surface break-words">
                  <button
                    type="button"
                    className="hit-area text-left hover:underline"
                    onClick={() => onOpen(item, false)}
                  >
                    {item.title}
                  </button>
                </h3>
                {item.source && connectorViaLabel(item.source) && (
                  <span className={SOURCE_BADGE}>
                    {connectorViaLabel(item.source)}
                  </span>
                )}
              </div>
              <ActionMenu
                label={`Actions for ${item.title}`}
                className="-mr-2 -mt-1 shrink-0"
                triggerClassName={KEBAB_TRIGGER}
                iconClassName="h-4 w-4"
                onOpenChange={setMenuOpen}
                items={[
                  {
                    id: "edit",
                    label: "Edit",
                    icon: Pencil,
                    onSelect: () => onOpen(item, true),
                  },
                  {
                    id: "delete",
                    label: "Delete",
                    icon: Trash2,
                    danger: true,
                    onSelect: () => onAskDelete(item),
                  },
                ]}
              />
            </div>

            {item.isViaName && (
              <button
                type="button"
                className="hit-area state-layer mt-1 mb-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-container border border-surface-container-highest/20 transition-colors text-[11px] uppercase tracking-[0.08em] text-on-surface-variant hover:text-on-surface font-bold"
                onClick={() => navigate(`/contact/${item.isViaId}`)}
                title="Navigate to original interaction"
              >
                <ExternalLink
                  aria-hidden="true"
                  className="w-3 h-3 text-primary"
                />{" "}
                via {item.isViaName}
              </button>
            )}

            {item.content ? (
              <div className="mt-1">
                <InteractionContent html={item.content} />
              </div>
            ) : null}

            {mentions && (
              <div className="mt-4 pt-3 flex flex-wrap gap-2 items-center">
                <span className={cn(LABEL, "mr-2 flex items-center gap-1")}>
                  <Sparkles
                    aria-hidden="true"
                    className="w-3 h-3 text-primary opacity-60"
                  />{" "}
                  Mentioned:
                </span>
                {mentions.map((mention, idx) =>
                  mention.isGhost ? (
                    <button
                      type="button"
                      key={idx}
                      onClick={() =>
                        promoteGhost(mention.contactId, {
                          onSuccess: () =>
                            navigate(`/contact/${mention.contactId}`),
                        })
                      }
                      title={`Add ${mention.name} to Network`}
                      className="hit-area state-layer flex items-center gap-2 px-2.5 py-1 rounded-md bg-surface-container-low border border-dashed border-primary transition-colors group/ghost"
                    >
                      <div className="w-5 h-5 rounded-full bg-surface-container-highest flex items-center justify-center text-[11px] font-bold text-on-surface-variant opacity-70 group-hover/ghost:opacity-100 transition-opacity">
                        {mention.name.charAt(0)}
                      </div>
                      <div className="text-xs font-semibold text-on-surface-variant group-hover/ghost:text-on-surface text-left leading-tight pr-1 opacity-80 group-hover/ghost:opacity-100 transition-opacity">
                        {mention.name}
                      </div>
                    </button>
                  ) : (
                    <Link
                      key={idx}
                      to={`/contact/${mention.contactId}`}
                      className="hit-area state-layer flex items-center gap-2 px-2.5 py-1 rounded-md bg-surface-container-low transition-colors"
                    >
                      <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-[11px] font-bold text-on-primary-wash">
                        {mention.name.charAt(0)}
                      </div>
                      <span className="text-xs font-semibold text-on-surface line-clamp-1">
                        {mention.name}
                      </span>
                    </Link>
                  ),
                )}
              </div>
            )}

            {item.fileUrl && (
              <div className="mt-3">
                {item.fileType?.startsWith("image/") ? (
                  <img
                    src={item.fileUrl}
                    alt={item.fileName || "Attachment"}
                    className="max-w-full rounded-xl shadow-sm object-cover max-h-64"
                  />
                ) : (
                  <a
                    href={safeHref(item.fileUrl)}
                    download
                    className="state-layer lift flex items-center gap-3 p-3 rounded-xl bg-surface-container-low w-fit max-w-full overflow-hidden"
                  >
                    <File
                      aria-hidden="true"
                      className="w-8 h-8 text-primary shrink-0 opacity-80"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-on-surface truncate">
                        {item.fileName}
                      </p>
                      <p className="text-xs text-on-surface-variant uppercase tracking-[0.08em] font-bold mt-0.5">
                        {item.fileType?.split("/")[1] || "FILE"}
                      </p>
                    </div>
                  </a>
                )}
              </div>
            )}

            {item.actionItems && item.actionItems.length > 0 && (
              <div className="mt-4 pt-3 flex flex-wrap gap-2 items-center border-t border-surface-container/50">
                <span className={cn(LABEL, "mr-2 flex items-center gap-1")}>
                  Follow-up:
                </span>
                {item.actionItems.map((action) => {
                  const done = !!action.completedAt || pending.has(action.id);
                  return (
                    <div
                      key={action.id}
                      className={cn(
                        "flex items-center gap-1.5 px-2.5 py-1 rounded-md border transition-colors text-xs font-semibold select-none",
                        done
                          ? "bg-surface-container text-on-surface-variant border-surface-container-high line-through opacity-60"
                          : "bg-surface-container-lowest text-on-surface border-surface-container-high",
                      )}
                    >
                      {done && (
                        <CalendarCheck
                          aria-hidden="true"
                          className="w-3 h-3 text-on-surface-variant opacity-60"
                        />
                      )}
                      {action.title}
                    </div>
                  );
                })}
              </div>
            )}

            {item.duration && (
              <p className="text-xs text-on-surface-variant mt-3 font-medium flex items-center gap-1 opacity-70">
                Duration: {item.duration}
              </p>
            )}
          </div>
        </div>
      </li>
    );
  },
);

export const Timeline = ({
  contactId,
  timeline,
  opened,
  onOpenedChange,
  deleteInteraction,
  updateInteraction,
  promoteGhost,
}: TimelineProps) => {
  const hidden = useHiddenPendingIds();
  const markFollowUpDone = useMarkFollowUpDone();
  const headingPrefix = useId();
  const [confirming, setConfirming] = useState<Interaction | null>(null);
  /** The entry whose title takes focus after the next render. */
  const focusAfterDelete = useRef<string | null>(null);
  const { preferences } = usePreferences();
  const weekStartDay = weekStartsOn(preferences.weekStart);
  /**
   * Entries present at first draw do not slide in: the page mounts anew on
   * each visit, and a slide-in each time kept it moving for 400 ms. Later
   * arrivals, such as a note just logged, still slide in.
   */
  const [firstDrawn] = useState(() => new Set(timeline.map((item) => item.id)));

  const groups = useMemo(
    () =>
      groupEntries(
        timeline.filter((item) => !hidden.has(item.id)),
        new Date(),
        weekStartDay,
      ),
    [timeline, hidden, weekStartDay],
  );

  // The kebab that opened the dialog is gone after a delete, so focus goes
  // to a neighbor's title. The dialog's own focus return then finds no
  // target and does nothing.
  useEffect(() => {
    const id = focusAfterDelete.current;
    if (!id) return;
    focusAfterDelete.current = null;
    titleButton(id)?.focus();
  });

  const open = useCallback(
    (interaction: Interaction, editing: boolean) =>
      onOpenedChange({ interaction, editing }),
    [onOpenedChange],
  );

  const askDelete = useCallback((item: Interaction) => setConfirming(item), []);

  const confirmDelete = () => {
    const item = confirming;
    if (!item) return;
    const order = groups.flatMap((group) =>
      group.entries.map((entry) => entry.item.id),
    );
    const at = order.indexOf(item.id);
    focusAfterDelete.current =
      at === -1 ? null : (order[at + 1] ?? order[at - 1] ?? null);
    setConfirming(null);
    if (opened?.interaction.id === item.id) onOpenedChange(null);
    startPendingDelete({
      id: item.id,
      send: () => deleteInteraction({ id: item.id, contactId }),
    });
  };

  let index = 0;

  return (
    <>
      {groups.length > 0 && (
        <div className="flex flex-col gap-8">
          {groups.map((group, groupIndex) => {
            const headingId = `${headingPrefix}-group-${groupIndex}`;
            return (
              <section
                key={`${group.key}-${groupIndex}`}
                aria-labelledby={headingId}
              >
                <h2 id={headingId} className={cn(SECTION_HEADING, "mb-3")}>
                  {group.label}
                </h2>
                <ul className="flex flex-col gap-3">
                  {group.entries.map((entry) => (
                    <TimelineEntry
                      key={entry.item.id}
                      entry={entry}
                      index={index++}
                      arrived={!firstDrawn.has(entry.item.id)}
                      onOpen={open}
                      onAskDelete={askDelete}
                      promoteGhost={promoteGhost}
                      pending={hidden}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <InteractionDetailModal
        isOpen={!!opened}
        onClose={() => onOpenedChange(null)}
        // The latest copy, so a Save or a done follow-up shows after refetch.
        interaction={
          (opened &&
            timeline.find((item) => item.id === opened.interaction.id)) ??
          opened?.interaction ??
          null
        }
        initialEditing={opened?.editing}
        onCompleteActionItem={markFollowUpDone}
        onUpdateInteraction={(id, data) =>
          updateInteraction({ id, contactId, data })
        }
        onDelete={() => opened && setConfirming(opened.interaction)}
      />

      <ConfirmDialog
        isOpen={!!confirming}
        onClose={() => setConfirming(null)}
        onConfirm={confirmDelete}
        title="Delete this interaction?"
        description={
          confirming
            ? `“${confirming.title}” leaves the timeline, and a toast offers Undo for a few seconds.`
            : undefined
        }
        confirmLabel="Delete interaction"
      />
    </>
  );
};
