/**
 * Timeline: the interactions of one contact, in one column, newest first.
 *
 * It replaces a zigzag. Cards alternated sides at half the pane width, so at
 * 1440 px a title wrapped to three lines and 40 percent of the pane was gap.
 * Now each entry is one row: a 64 px date column, the type glyph, and a card
 * that takes the rest of the width.
 *
 * Entries sit under group headings. "This week" holds the current week. Every
 * older or later entry goes under its month, with the year added for a year
 * that is not the current one. The heading carries the relative part of the
 * date and the entry's tooltip carries the absolute date.
 *
 * Delete is in a kebab with Edit, and not a red trash on every card. The
 * kebab shows on hover, on focus in the entry, and always on a touch screen.
 * Delete asks first, then hides the entry and offers Undo in a toast. The
 * server delete waits until the undo window ends (see `lib/pendingDeletes`).
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
import {
  CalendarCheck,
  ExternalLink,
  Facebook,
  File,
  FileText,
  Handshake,
  Linkedin,
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
  useHiddenInteractionIds,
} from "../../../lib/pendingDeletes";
import { ActionMenu } from "../../../components/ui/ActionMenu";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { useCompleteActionItem } from "../../../api";
import { InteractionDetailModal } from "./InteractionDetailModal";

// ═══════════════════════════════════════════════════════════════════════════
// Props
// ═══════════════════════════════════════════════════════════════════════════

export interface DeleteInteractionMutation {
  /**
   * The promise form of the delete, and not `mutate`, on purpose. The undo
   * window can end after the contact page has closed, or while a second
   * delete is out. React Query drops the callbacks of a `mutate` call in both
   * cases. The promise settles in both.
   */
  mutateAsync: (args: { id: string; contactId: string }) => Promise<unknown>;
}

export interface UpdateInteractionMutation {
  mutate: (args: {
    id: string;
    contactId: string;
    data: { title?: string; content?: string | null };
  }) => void;
}

export interface PromoteGhostMutation {
  mutate: (id: string, opts?: { onSuccess?: () => void }) => void;
}

/** The interaction in the detail modal, and the mode the modal opens in. */
export interface OpenedInteraction {
  interaction: Interaction;
  /** True when the kebab's Edit opened it. */
  editing: boolean;
}

export interface TimelineProps {
  contactId: string;
  timeline: Interaction[];
  /** The interaction in the detail modal. The tab owns it for `?interaction=`. */
  opened: OpenedInteraction | null;
  onOpenedChange: (next: OpenedInteraction | null) => void;
  deleteInteraction: DeleteInteractionMutation;
  updateInteraction: UpdateInteractionMutation;
  promoteGhost: PromoteGhostMutation;
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The info colour on its own 10 percent wash: a call or a social message.
 * Info is not one of the shared tones, so it keeps this pair.
 */
const INFO_WASH = "bg-info/10 text-info";

/**
 * The glyph for an interaction type, on its colour's wash. Every other type
 * reads from the shared tones (`TONE_WASH`), which
 * `tests/unit/theme.contrast.test.ts` measures.
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
      // The AI colour, as a glyph on its own 10 percent wash.
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

/** Safely parse the JSON mentions string. Returns null if empty/invalid. */
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
 * Sort the entries newest first and split them into headed groups.
 *
 * A group is a run of neighbours with the same heading. An entry in a future
 * week goes under its month, so a later September entry can stand above
 * "This week" with an earlier September group below it. The two groups are
 * not merged, because that would break the date order.
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
  // The server sends newest first already. The sort is a guard: an entry
  // with no readable date goes last, and equal dates keep the server order.
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

// ═══════════════════════════════════════════════════════════════════════════
// InteractionContent: memoized, sanitized rich-text preview for one entry
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Memoized so DOMPurify.sanitize doesn't re-run for every timeline entry on
 * each parent render. It only runs when the entry's HTML actually changes.
 */
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

// ═══════════════════════════════════════════════════════════════════════════
// TimelineEntry: one row
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The kebab is hidden with opacity, not `display`, so Tab still reaches it.
 * It shows on hover of the entry, on focus anywhere in the entry, while its
 * menu is open, and always on a touch screen, which has no hover.
 */
const KEBAB_TRIGGER =
  "opacity-0 transition group-hover/entry:opacity-100 group-focus-within/entry:opacity-100 aria-expanded:opacity-100 pointer-coarse:opacity-100";

const SOURCE_BADGE =
  "inline-flex items-center rounded-md bg-surface-container-high px-2 py-0.5 text-[11px] font-medium text-on-surface-variant";

interface TimelineEntryProps {
  entry: DatedEntry;
  /** The position on the whole timeline, for the entrance stagger. */
  index: number;
  onOpen: (item: Interaction, editing: boolean) => void;
  onAskDelete: (item: Interaction) => void;
  promoteGhost: PromoteGhostMutation;
}

const TimelineEntry = React.memo(
  ({ entry, index, onOpen, onAskDelete, promoteGhost }: TimelineEntryProps) => {
    const navigate = useNavigate();
    // Each entry animates in with a transform, which makes it a stacking
    // context. An open menu lifts its entry above the next one.
    const [menuOpen, setMenuOpen] = useState(false);
    const { item, date } = entry;
    const { Icon, tone } = getInteractionStyle(item.type);
    const mentions = parseMentions(item.mentions);

    return (
      <li
        id={`interaction-${item.id}`}
        title={formatDay(item.date)}
        className={cn(
          "group/entry relative flex gap-3 sm:gap-4 timeline-entry",
          menuOpen && "z-10",
        )}
        style={{ animationDelay: `${Math.min(index, 6) * 25}ms` }}
      >
        {/* Date column */}
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
          {/* Type glyph */}
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

            {/* Via mention badge */}
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

            {/* Ghost Mentions */}
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
                        promoteGhost.mutate(mention.contactId, {
                          onSuccess: () =>
                            navigate(`/contact/${mention.contactId}`),
                        })
                      }
                      title={`Promote ${mention.name} to contact`}
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

            {/* File Attachment */}
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
                    className="state-layer flex items-center gap-3 p-3 rounded-xl bg-surface-container-low transition-colors w-fit max-w-full overflow-hidden"
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

            {/* Follow-up */}
            {item.actionItems && item.actionItems.length > 0 && (
              <div className="mt-4 pt-3 flex flex-wrap gap-2 items-center border-t border-surface-container/50">
                <span className={cn(LABEL, "mr-2 flex items-center gap-1")}>
                  Follow-up:
                </span>
                {item.actionItems.map((action) => (
                  <div
                    key={action.id}
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1 rounded-md border transition-colors text-xs font-semibold select-none",
                      action.completedAt
                        ? "bg-surface-container text-on-surface-variant border-surface-container-high line-through opacity-60"
                        : "bg-surface-container-lowest text-on-surface border-surface-container-high",
                    )}
                  >
                    {action.completedAt && (
                      <CalendarCheck
                        aria-hidden="true"
                        className="w-3 h-3 text-on-surface-variant opacity-60"
                      />
                    )}
                    {action.title}
                  </div>
                ))}
              </div>
            )}

            {/* Duration */}
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

// ═══════════════════════════════════════════════════════════════════════════
// Timeline
// ═══════════════════════════════════════════════════════════════════════════

export const Timeline = ({
  contactId,
  timeline,
  opened,
  onOpenedChange,
  deleteInteraction,
  updateInteraction,
  promoteGhost,
}: TimelineProps) => {
  const hidden = useHiddenInteractionIds();
  const completeActionItem = useCompleteActionItem();
  const headingPrefix = useId();
  const [confirming, setConfirming] = useState<Interaction | null>(null);
  /** The entry whose title takes focus after the next render. */
  const focusAfterDelete = useRef<string | null>(null);
  const { preferences } = usePreferences();
  const weekStartDay = weekStartsOn(preferences.weekStart);

  const groups = useMemo(
    () =>
      groupEntries(
        timeline.filter((item) => !hidden.has(item.id)),
        new Date(),
        weekStartDay,
      ),
    [timeline, hidden, weekStartDay],
  );

  // After a delete, the kebab that opened the dialog is gone. Focus goes to
  // a neighbour's title in the render that hides the entry. The dialog's
  // own return runs later, finds its target gone, and changes nothing.
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
    startPendingDelete({
      id: item.id,
      send: () => deleteInteraction.mutateAsync({ id: item.id, contactId }),
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
                      onOpen={open}
                      onAskDelete={askDelete}
                      promoteGhost={promoteGhost}
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
        interaction={opened?.interaction ?? null}
        initialEditing={opened?.editing}
        onCompleteActionItem={(id) => completeActionItem.mutate(id)}
        onUpdateInteraction={(id, data) =>
          updateInteraction.mutate({ id, contactId, data })
        }
        onDelete={() => {
          if (!opened) return;
          // The modal has no focus return of its own. The entry's title is
          // where the dialog gives focus back on Cancel.
          titleButton(opened.interaction.id)?.focus();
          setConfirming(opened.interaction);
        }}
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
