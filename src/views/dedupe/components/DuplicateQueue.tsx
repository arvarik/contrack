/**
 * DuplicateQueue: the possible duplicates waiting for a person, the one
 * place a person decides about the pairs Contrack is not sure of.
 *
 * ```
 * VERY LIKELY (2)                [Merge all 2]  ┌ Ada Quill and A. Quill ──────────────┐
 * ┃ Ada Quill · Northwind                      │ ✉ Same email address ada@…           │
 * ┃ A. Quill                                    │ CONTACT TO KEEP  (●) Ada  ( ) A.     │
 * ┃ ✉ Same email address                        │ Name •   Ada Quill   A̶.̶ ̶Q̶u̶i̶l̶l̶          │
 *   Tobias Wren · Contoso                      │ Same: email, company  [Show all]     │
 * CHECK CAREFULLY (1)                          │ AFTER THE MERGE …                    │
 *   Ada Twin · Ben Twin                        │          [Keep separate H] [Merge L] │
 *   ☏ Same phone number                        └──────────────────────────────────────┘
 *   ⚠ First names differ: Ada and Ben
 * ```
 *
 * From `lg` the list and the open group sit side by side, the way mail and
 * the Network page do: the keys move through the list and the comparison
 * follows. Below `lg` the list is the page, each row carries its two
 * buttons, and the comparison opens in a sheet.
 *
 * The list is in three parts, the easy decisions first: Very likely, Likely
 * and Check carefully. The level is said once, in the part's heading, and
 * never as a percentage. Only Very likely offers Merge all, because a pair
 * with a caveat must never merge with a batch.
 *
 * Every decision says what it did, with Undo, and Z undoes the last one.
 * The Undo after a person's own merge puts the pair back in the list,
 * because it takes back a slip. Focus then goes to the group that took the
 * decided one's place, so the keys go on from there.
 *
 * Keys, with the single-key switch for the letters: J and K, or the down
 * and up arrows, move between groups, L or → merges the group into the
 * contact chosen in its comparison, H or ← keeps it separate, and Z undoes.
 * A key another control used first, an arrow in the radio group of the
 * contact to keep, is that control's.
 *
 * @module views/dedupe/components/DuplicateQueue
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  CheckCircle2,
  GitMerge,
  Loader2,
  ScanSearch,
  X,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  undoMerges,
  useDismissSuggestion,
  useMergeCluster,
  useMergeClusters,
  usePendingSuggestions,
  useRestoreSuggestion,
} from "../../../api";
import { cn } from "../../../lib/utils";
import { CARD, LABEL, SELECTED_ROW } from "../../../lib/styles";
import { fallbackAvatarUrl } from "../../../lib/avatar";
import { isTypingTarget } from "../../../lib/keyboard";
import { UNDO_DURATION_MS } from "../../../lib/undoToast";
import { useSingleKeyShortcuts } from "../../../hooks/useSingleKeyShortcuts";
import { useMediaQuery, WIDE_QUERY } from "../../../hooks/useMediaQuery";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Modal } from "../../../components/ui/Modal";
import type { PersistedDedupeSuggestion } from "../../../types";
import { buildGroups, pairsOf, type DuplicateGroup } from "../utils/groups";
import { LEVEL_LABEL, type MatchLevel } from "../utils/level";
import { isAiReason, plainReason, reasonIcon } from "../utils/reason";
import { suggestKeeper, type ReviewContact } from "../utils/mergeOutcome";
import { DuplicateDetail, groupName } from "./DuplicateDetail";
import { DuplicateCheck, useDuplicateCheck } from "./DuplicateCheck";

/** A merge request names at most this many contacts besides the one kept. */
const MERGE_LIMIT = 10;

/** The one Undo message: a new decision's replaces the last one's. */
const UNDO_TOAST = "duplicates-undo";

const LEVELS: MatchLevel[] = ["very-likely", "likely", "check"];

const errorText = (err: unknown) =>
  err instanceof Error ? err.message.replace(/\.$/, "") : String(err);

/** What tells one contact from another of the same name. */
function hint(contact: ReviewContact): string | null {
  return (
    [contact.company, contact.location?.split(",")[0]]
      .filter(Boolean)
      .join(" · ") ||
    contact.emails?.[0]?.email ||
    contact.phones?.[0]?.phone ||
    null
  );
}

/** An action Z or the message's Undo can take back. */
interface LastAction {
  run: () => Promise<void>;
}

export const DuplicateQueue = () => {
  const qc = useQueryClient();
  const {
    data: suggestions = [],
    isLoading,
    isError,
    refetch,
  } = usePendingSuggestions();
  const mergeCluster = useMergeCluster();
  const mergeClusters = useMergeClusters();
  const dismiss = useDismissSuggestion();
  const restore = useRestoreSuggestion();
  const check = useDuplicateCheck();
  const singleKeys = useSingleKeyShortcuts();
  const isWide = useMediaQuery(WIDE_QUERY);

  const groups = useMemo(() => buildGroups(suggestions), [suggestions]);

  /** The contact each group keeps, where a person chose one. */
  const [keepers, setKeepers] = useState<Record<string, string>>({});
  const keeperOf = useCallback(
    (group: DuplicateGroup) => {
      const chosen = keepers[group.key];
      return group.contacts.some((c) => c.id === chosen)
        ? chosen
        : suggestKeeper(group.contacts).id;
    },
    [keepers],
  );

  const [busy, setBusy] = useState<Set<string>>(new Set());
  /** The group the keys and the open pane act on. */
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  /** Below `lg`, the comparison opens in a sheet. */
  const [sheetOpen, setSheetOpen] = useState(false);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const rootRef = useRef<HTMLDivElement>(null);
  /** After a group leaves, the one at this place in the list takes over. */
  const nextAt = useRef<number | null>(null);
  const lastAction = useRef<LastAction | null>(null);

  const index = groups.findIndex((g) => g.key === currentKey);
  // From `lg` a group is always open: the first, until a person picks.
  const current =
    index >= 0 ? groups[index] : isWide ? (groups[0] ?? null) : null;
  const currentIndex = current ? groups.indexOf(current) : -1;

  const select = useCallback(
    (at: number, focus: boolean) => {
      const group = groups[at];
      if (!group) return;
      setCurrentKey(group.key);
      if (focus) rowRefs.current.get(group.key)?.focus();
    },
    [groups],
  );

  // A decided group leaves the list when the list reads the server again.
  // The group now at its place takes over, and focus with it, so the keys
  // go on from there. With none left, focus goes to the empty state.
  useLayoutEffect(() => {
    if (nextAt.current === null) return;
    const at = Math.min(nextAt.current, groups.length - 1);
    nextAt.current = null;
    if (at >= 0) select(at, true);
    else
      rootRef.current
        ?.querySelector<HTMLElement>("[data-queue-empty]")
        ?.focus();
  }, [groups, select]);

  const setBusyFor = (keys: string[], on: boolean) =>
    setBusy((prev) => {
      const next = new Set(prev);
      for (const key of keys) {
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });

  /** Say what happened, with the one Undo, and let Z take it back too. */
  const announce = useCallback(
    (
      kind: "success" | "warning" | "message",
      message: string,
      undo: () => Promise<void>,
      description?: string,
    ) => {
      const action: LastAction = {
        run: async () => {
          if (lastAction.current === action) lastAction.current = null;
          toast.dismiss(UNDO_TOAST);
          try {
            await undo();
          } catch (err) {
            toast.error(`Could not undo: ${errorText(err)}`);
          }
        },
      };
      lastAction.current = action;
      const options = {
        id: UNDO_TOAST,
        description,
        duration: UNDO_DURATION_MS,
        action: { label: "Undo", onClick: () => void action.run() },
      };
      if (kind === "success") toast.success(message, options);
      else if (kind === "warning") toast.warning(message, options);
      else toast(message, options);
    },
    [],
  );

  /** Merge one group's others into its keeper, in batches the server takes. */
  const mergeOne = useCallback(
    async (group: DuplicateGroup) => {
      const keeperId = keeperOf(group);
      const otherIds = group.contacts
        .map((c) => c.id)
        .filter((id) => id !== keeperId);
      let merged = 0;
      let failed = 0;
      const mergeLogIds: string[] = [];
      for (let i = 0; i < otherIds.length; i += MERGE_LIMIT) {
        const result = await mergeCluster.mutateAsync({
          primaryId: keeperId,
          duplicateIds: otherIds.slice(i, i + MERGE_LIMIT),
        });
        merged += result.merged;
        failed += result.failed;
        mergeLogIds.push(...result.mergeLogIds);
      }
      return { keeperId, otherIds, merged, failed, mergeLogIds };
    },
    [keeperOf, mergeCluster],
  );

  const handleMerge = useCallback(
    async (group: DuplicateGroup) => {
      if (busy.has(group.key)) return;
      const at = groups.indexOf(group);
      setBusyFor([group.key], true);
      try {
        const result = await mergeOne(group);
        nextAt.current = at;
        setSheetOpen(false);
        const keeper = group.contacts.find((c) => c.id === result.keeperId)!;
        const undo = () =>
          undoMerges(qc, result.mergeLogIds, false).then(() => {});
        if (result.merged === 0) {
          toast.error("Nothing was merged. The list is up to date now");
        } else if (result.failed > 0) {
          announce(
            "warning",
            `Merged ${result.merged} of ${result.otherIds.length} into ${keeper.name}`,
            undo,
            `${result.failed} could not be merged`,
          );
        } else {
          const others = group.contacts.filter((c) => c.id !== keeper.id);
          announce(
            "success",
            others.length === 1
              ? `Merged ${others[0].name} into ${keeper.name}`
              : `Merged ${others.length} contacts into ${keeper.name}`,
            undo,
          );
        }
      } catch (err) {
        toast.error(`Could not merge: ${errorText(err)}`);
      } finally {
        setBusyFor([group.key], false);
      }
    },
    [busy, groups, mergeOne, qc, announce],
  );

  /** Dismiss pairs, with an Undo that brings each one back. */
  const keepApart = useCallback(
    async (
      pairs: PersistedDedupeSuggestion[],
      message: string,
      keys: string[],
    ) => {
      setBusyFor(keys, true);
      const done: string[] = [];
      try {
        for (const s of pairs) {
          await dismiss.mutateAsync(s.id);
          done.push(s.id);
        }
        announce(
          "message",
          message,
          async () => {
            for (const id of done) await restore.mutateAsync(id);
          },
          "Contrack will not suggest them again",
        );
      } catch (err) {
        toast.error(`Could not keep them separate: ${errorText(err)}`);
      } finally {
        setBusyFor(keys, false);
      }
    },
    [dismiss, restore, announce],
  );

  const handleKeepSeparate = useCallback(
    (group: DuplicateGroup) => {
      if (busy.has(group.key)) return;
      nextAt.current = groups.indexOf(group);
      setSheetOpen(false);
      void keepApart(
        group.suggestions,
        `Kept ${groupName(group.contacts)} separate`,
        [group.key],
      );
    },
    [busy, groups, keepApart],
  );

  const handleRemove = useCallback(
    (group: DuplicateGroup, contact: ReviewContact) => {
      void keepApart(
        pairsOf(group, contact.id),
        `Took ${contact.name} out of the group`,
        [group.key],
      );
    },
    [keepApart],
  );

  /** Merge every group of one part, each into the contact it keeps. */
  const handleMergeAll = async (part: DuplicateGroup[]) => {
    const keys = part.map((g) => g.key);
    setBusyFor(keys, true);
    try {
      const batches = part.map((g) => {
        const keeperId = keeperOf(g);
        return {
          primaryId: keeperId,
          duplicateIds: g.contacts
            .map((c) => c.id)
            .filter((id) => id !== keeperId),
        };
      });
      const mergeLogIds: string[] = [];
      let merged = 0;
      let failed = 0;
      // The server takes up to 250 merges a request, and a group up to 10.
      for (let i = 0; i < batches.length; i += 25) {
        const answer = await mergeClusters.mutateAsync(
          batches.slice(i, i + 25),
        );
        for (const r of answer.results) {
          if (r.merged > 0) merged++;
          failed += r.failed;
          mergeLogIds.push(...r.mergeLogIds);
        }
      }
      nextAt.current = 0;
      announce(
        failed > 0 ? "warning" : "success",
        `Merged ${merged} ${merged === 1 ? "group" : "groups"}`,
        () => undoMerges(qc, mergeLogIds, false).then(() => {}),
        failed > 0
          ? `${failed} ${failed === 1 ? "contact" : "contacts"} could not be merged`
          : undefined,
      );
    } catch (err) {
      toast.error(`Could not merge: ${errorText(err)}`);
    } finally {
      setBusyFor(keys, false);
    }
  };

  // ─── Keys ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // A key another control used first is its own: an arrow that moved
      // the radio of the contact to keep must not also merge the group.
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e)) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('[role="dialog"], [role="menu"], [role="listbox"]')) {
        return;
      }
      // The arrows move the contact to keep. The letters still decide, so a
      // person who just chose the contact presses L from where they are.
      if (target?.closest('[role="radiogroup"]') && e.key.startsWith("Arrow")) {
        return;
      }
      if (!singleKeys && /^[hjklz]$/.test(e.key)) return;

      if (e.key === "z") {
        if (!lastAction.current) return;
        e.preventDefault();
        void lastAction.current.run();
        return;
      }
      if (groups.length === 0) return;
      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          select(
            currentIndex < 0
              ? 0
              : Math.min(currentIndex + 1, groups.length - 1),
            true,
          );
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          select(Math.max(currentIndex - 1, 0), true);
          break;
        case "l":
        case "ArrowRight":
          if (!current) return;
          e.preventDefault();
          void handleMerge(current);
          break;
        case "h":
        case "ArrowLeft":
          if (!current) return;
          e.preventDefault();
          handleKeepSeparate(current);
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    groups,
    current,
    currentIndex,
    singleKeys,
    select,
    handleMerge,
    handleKeepSeparate,
  ]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16" role="status">
        <Loader2
          aria-hidden="true"
          className="w-5 h-5 animate-spin text-on-surface-variant"
        />
        <span className="sr-only">Loading possible duplicates</span>
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        tone="error"
        icon={AlertTriangle}
        title="Possible duplicates did not load"
        action={{ label: "Try again", onClick: () => void refetch() }}
      />
    );
  }

  const detail = (group: DuplicateGroup, heading: boolean) => (
    <DuplicateDetail
      group={group}
      keeperId={keeperOf(group)}
      onKeeperChange={(id) =>
        setKeepers((prev) => ({ ...prev, [group.key]: id }))
      }
      onMerge={() => void handleMerge(group)}
      onKeepSeparate={() => handleKeepSeparate(group)}
      onRemove={(contact) => handleRemove(group, contact)}
      isBusy={busy.has(group.key)}
      heading={heading}
      showKeys={singleKeys && isWide}
    />
  );

  const list = LEVELS.map((level) => {
    const part = groups.filter((g) => g.level === level);
    if (part.length === 0) return null;
    const headingId = `duplicates-${level}`;
    return (
      <section key={level} aria-labelledby={headingId} className="space-y-2">
        <div className="flex items-center justify-between gap-3 px-1 min-h-9">
          <h2 id={headingId} className={LABEL}>
            {LEVEL_LABEL[level]}{" "}
            <span className="tabular-nums">({part.length})</span>
          </h2>
          {level === "very-likely" && part.length > 1 && (
            <button
              type="button"
              onClick={() => void handleMergeAll(part)}
              disabled={part.some((g) => busy.has(g.key))}
              className="btn-secondary btn-sm"
            >
              <GitMerge className="w-3.5 h-3.5" aria-hidden="true" />
              Merge all {part.length}
            </button>
          )}
        </div>
        <ul className="space-y-2">
          {part.map((group) => (
            <DuplicateRow
              key={group.key}
              group={group}
              buttonRef={(el) => {
                if (el) rowRefs.current.set(group.key, el);
                else rowRefs.current.delete(group.key);
              }}
              isCurrent={isWide && current?.key === group.key}
              isWide={isWide}
              isBusy={busy.has(group.key)}
              onOpen={() => {
                setCurrentKey(group.key);
                if (!isWide) setSheetOpen(true);
              }}
              onMerge={() => void handleMerge(group)}
              onKeepSeparate={() => handleKeepSeparate(group)}
            />
          ))}
        </ul>
      </section>
    );
  });

  return (
    <div ref={rootRef} className="space-y-4">
      <DuplicateCheck variant="inline" />

      {groups.length === 0 ? (
        // Focus comes here when the last group leaves the list.
        <div tabIndex={-1} data-queue-empty="" className="rounded-2xl">
          <EmptyState
            icon={CheckCircle2}
            title="No possible duplicates"
            body="Contrack checks new contacts and imports by itself"
            action={
              check.isScanning || check.isStarting || check.isQueued
                ? undefined
                : { label: "Check now", icon: ScanSearch, onClick: check.start }
            }
          />
        </div>
      ) : isWide ? (
        <div className="grid grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)] gap-6 items-start">
          <div className="space-y-6">{list}</div>
          {current && (
            <div
              id="duplicate-detail"
              aria-label="The group you are looking at"
              role="region"
              className={cn(
                CARD,
                "p-4 sm:p-5 pb-0 sm:pb-0 sticky top-4 max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain",
              )}
            >
              {detail(current, true)}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6">{list}</div>
      )}

      {!isWide && current && (
        <Modal
          isOpen={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title={groupName(current.contacts)}
          size="lg"
          returnFocusRef={{ current: rowRefs.current.get(current.key) ?? null }}
        >
          {detail(current, false)}
        </Modal>
      )}
    </div>
  );
};

// =============================================================================
// DuplicateRow — one pair or group in the list
// =============================================================================

interface DuplicateRowProps {
  group: DuplicateGroup;
  buttonRef: (el: HTMLButtonElement | null) => void;
  isCurrent: boolean;
  isWide: boolean;
  isBusy: boolean;
  onOpen: () => void;
  onMerge: () => void;
  onKeepSeparate: () => void;
}

/** The faces of a group, a few at most, overlapping. */
function Faces({ contacts }: { contacts: ReviewContact[] }) {
  return (
    <span className="flex -space-x-2 shrink-0" aria-hidden="true">
      {contacts.slice(0, 3).map((c) => (
        <img
          key={c.id}
          src={c.avatarUrl || fallbackAvatarUrl(c.name)}
          alt=""
          className="w-8 h-8 rounded-full object-cover bg-surface-container-high ring-2 ring-surface-container-lowest"
        />
      ))}
    </span>
  );
}

/** One contact of a pair: the face, the name, what tells it apart. */
function PairSide({ contact }: { contact: ReviewContact }) {
  const where = hint(contact);
  return (
    <span className="flex items-center gap-2 min-w-0">
      <img
        src={contact.avatarUrl || fallbackAvatarUrl(contact.name)}
        alt=""
        className="w-7 h-7 rounded-full object-cover bg-surface-container-high shrink-0"
      />
      <span className="min-w-0">
        <span className="block text-sm font-bold text-on-surface break-words">
          {contact.name}
        </span>
        {where && (
          <span className="block text-xs text-on-surface-variant break-words">
            {where}
          </span>
        )}
      </span>
    </span>
  );
}

function DuplicateRow({
  group,
  buttonRef,
  isCurrent,
  isWide,
  isBusy,
  onOpen,
  onMerge,
  onKeepSeparate,
}: DuplicateRowProps) {
  const { lead, contacts, caveats } = group;
  const Icon = reasonIcon(lead.matchType);
  const ai = isAiReason(lead.matchType);
  const isPair = contacts.length === 2;

  return (
    <li className={cn(CARD, "p-0", isCurrent && SELECTED_ROW)}>
      <button
        ref={buttonRef}
        type="button"
        onClick={onOpen}
        aria-current={isCurrent || undefined}
        aria-haspopup={isWide ? undefined : "dialog"}
        className="state-layer w-full text-left rounded-2xl p-3 sm:p-4 flex flex-col gap-2"
      >
        {isPair ? (
          <span className="flex flex-col gap-1.5">
            <PairSide contact={contacts[0]} />
            <PairSide contact={contacts[1]} />
          </span>
        ) : (
          <span className="flex items-center gap-3 min-w-0">
            <Faces contacts={contacts} />
            <span className="min-w-0">
              <span className="block text-sm font-bold text-on-surface break-words">
                {groupName(contacts)}
              </span>
              <span className="block text-xs text-on-surface-variant">
                {contacts.length} contacts
              </span>
            </span>
          </span>
        )}
        <span
          className={cn(
            "flex items-start gap-1.5 text-sm",
            ai ? "text-on-surface" : "text-on-surface-variant",
          )}
        >
          <Icon
            aria-hidden="true"
            className={cn("w-3.5 h-3.5 mt-0.5 shrink-0", ai && "text-ai")}
          />
          <span className="line-clamp-2">
            {plainReason(lead.matchType, lead.reasoning)}
          </span>
        </span>
        {caveats.map((caveat) => (
          <span
            key={caveat}
            className="flex items-start gap-1.5 text-sm font-semibold text-warning"
          >
            <AlertTriangle
              aria-hidden="true"
              className="w-3.5 h-3.5 mt-0.5 shrink-0"
            />
            {caveat}
          </span>
        ))}
      </button>
      {/* Below `lg` each row decides on its own. From `lg` the open group's
          pane holds the buttons. */}
      {!isWide && (
        <div className="flex gap-2 px-3 pb-3 sm:px-4 sm:pb-4">
          <button
            type="button"
            onClick={onKeepSeparate}
            disabled={isBusy}
            className="btn-secondary btn-sm flex-1"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
            Keep separate
          </button>
          <button
            type="button"
            onClick={onMerge}
            disabled={isBusy}
            className="btn-primary btn-sm flex-1"
          >
            {isBusy ? (
              <Loader2
                className="w-3.5 h-3.5 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <GitMerge className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            {isPair ? "Merge" : `Merge ${contacts.length}`}
          </button>
        </div>
      )}
    </li>
  );
}
