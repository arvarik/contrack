/**
 * One possible duplicate, opened: why the contacts look like one person, the
 * comparison, and the two decisions. The buttons are sticky, so a long group
 * never pushes them out of reach.
 */
import {
  AlertTriangle,
  ChevronDown,
  GitMerge,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import { Keycap } from "../../../components/ui/ShortcutKeys";
import { cn } from "../../../lib/utils";
import type { DuplicateGroup } from "../utils/groups";
import { isAiReason, plainReason, reasonIcon } from "../utils/reason";
import type { ReviewContact } from "../utils/mergeOutcome";
import { breakable, DuplicateComparison } from "./DuplicateComparison";

/** More than this many in one group, and the group asks for a careful look. */
const LARGE_GROUP = 5;

/**
 * "Ada Quill and Ben Quill", "Ada Quill and 5 others", or, when every name
 * is the same, "2 contacts named Ada Quill".
 */
export function groupName(contacts: ReviewContact[]): string {
  const [first] = contacts;
  if (contacts.every((c) => c.name === first.name)) {
    return `${contacts.length} contacts named ${first.name}`;
  }
  if (contacts.length === 2) {
    return `${first.name} and ${contacts[1].name}`;
  }
  return `${first.name} and ${contacts.length - 1} others`;
}

interface DuplicateDetailProps {
  group: DuplicateGroup;
  keeperId: string;
  onKeeperChange: (id: string) => void;
  onMerge: () => void;
  onKeepSeparate: () => void;
  onRemove: (contact: ReviewContact) => void;
  isBusy: boolean;
  /** False in a sheet, whose title names the group. */
  heading?: boolean;
  /** The buttons name their single-key shortcuts. */
  showKeys?: boolean;
  /** Top in the wide pane, by the name. Bottom in a sheet, by the thumb. */
  actionsAt?: "top" | "bottom";
  /** The first L opened this Check carefully group: say what the next does. */
  confirming?: boolean;
}

export const DuplicateDetail = ({
  group,
  keeperId,
  onKeeperChange,
  onMerge,
  onKeepSeparate,
  onRemove,
  isBusy,
  heading = true,
  showKeys = false,
  actionsAt = "bottom",
  confirming = false,
}: DuplicateDetailProps) => {
  const { lead, contacts, caveats } = group;
  const isPair = contacts.length === 2;
  const Icon = reasonIcon(lead.matchType);
  const ai = isAiReason(lead.matchType);
  const reason = plainReason(lead.matchType, lead.reasoning);
  const showValue =
    isPair && (lead.matchType === "email" || lead.matchType === "phone")
      ? lead.matchedField
      : null;
  const caveatPrefix = `caveat-${group.key.replace(/[^a-z0-9]/gi, "").slice(0, 16)}`;
  const caveatIds = caveats.map((_, i) => `${caveatPrefix}-${i}`).join(" ");
  // A careful group's Merge is not the primary button, and takes two key
  // presses (`DuplicateQueue`).
  const careful = group.level === "check";

  const actions = (
    <>
      <button
        type="button"
        onClick={onKeepSeparate}
        disabled={isBusy}
        className="btn-secondary max-sm:flex-1"
      >
        <X className="w-4 h-4" aria-hidden="true" />
        Keep separate
        {showKeys && (
          <span aria-hidden="true" className="max-sm:hidden">
            <Keycap>H</Keycap>
          </span>
        )}
      </button>
      {confirming && (
        <p className="basis-full text-sm text-on-surface">
          Check the differences, then press{" "}
          {showKeys ? "L again or Enter" : "Merge"}
        </p>
      )}
      <button
        type="button"
        onClick={onMerge}
        disabled={isBusy}
        aria-describedby={caveatIds || undefined}
        data-merge=""
        className={cn(
          careful ? "btn-secondary" : "btn-primary",
          "max-sm:flex-1",
        )}
      >
        {isBusy ? (
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
        ) : (
          <GitMerge className="w-4 h-4" aria-hidden="true" />
        )}
        {isPair ? "Merge" : `Merge ${contacts.length}`}
        {showKeys && (
          <span aria-hidden="true" className="max-sm:hidden">
            <Keycap>L</Keycap>
          </span>
        )}
      </button>
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      {heading && (
        <div
          className={cn(
            "flex flex-wrap items-start gap-3",
            actionsAt === "top" &&
              "sticky top-0 z-10 -mx-4 sm:-mx-5 -mt-4 sm:-mt-5 px-4 sm:px-5 pt-4 sm:pt-5 pb-3 bg-surface-container-lowest",
          )}
        >
          <div className="flex-1 min-w-[12rem] space-y-1">
            <h2 className="text-lg font-headline font-bold text-on-surface break-words">
              {groupName(contacts)}
            </h2>
            {!ai && (
              <p className="flex flex-wrap items-center gap-x-2 text-sm text-on-surface-variant">
                <Icon aria-hidden="true" className="w-4 h-4 shrink-0" />
                {reason}
                {showValue && (
                  <span className="break-words min-w-0 text-on-surface">
                    {breakable(showValue)}
                  </span>
                )}
              </p>
            )}
          </div>
          {actionsAt === "top" && (
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          )}
        </div>
      )}

      {ai && (
        <div className="flex items-start gap-2.5 rounded-xl bg-ai/5 p-3">
          <Sparkles
            aria-hidden="true"
            className="w-4 h-4 mt-0.5 shrink-0 text-ai"
          />
          <p className="text-sm text-on-surface text-pretty">
            <span className="font-semibold">AI: </span>
            {reason}
          </p>
        </div>
      )}

      {contacts.length > LARGE_GROUP && (
        <div className="flex items-start gap-2.5 rounded-xl bg-warning/10 p-3">
          <AlertTriangle
            aria-hidden="true"
            className="w-4 h-4 mt-0.5 shrink-0 text-warning"
          />
          <p className="text-sm text-on-surface text-pretty">
            A group of {contacts.length} is often more than one person. Check
            each one, and take out anyone who is someone else
          </p>
        </div>
      )}

      {!isPair && (
        <details className="group/links rounded-xl bg-surface-container-low">
          <summary className="state-layer cursor-pointer list-none rounded-xl px-3 py-2.5 min-h-11 flex items-center gap-2 text-sm font-semibold text-on-surface-variant">
            <ChevronDown
              aria-hidden="true"
              className="w-4 h-4 transition-transform duration-(--dur-fast) group-open/links:rotate-180"
            />
            How they connect ({group.suggestions.length})
          </summary>
          <ul className="px-3 pb-3 space-y-1.5 text-sm">
            {group.suggestions.map((s) => {
              const a = contacts.find((c) => c.id === s.contactIdA);
              const b = contacts.find((c) => c.id === s.contactIdB);
              return (
                <li key={s.id} className="flex flex-wrap gap-x-2">
                  <span className="font-semibold text-on-surface">
                    {a?.name} and {b?.name}
                  </span>
                  <span className="text-on-surface-variant">
                    {plainReason(s.matchType, s.reasoning)}
                  </span>
                </li>
              );
            })}
          </ul>
        </details>
      )}

      <DuplicateComparison
        contacts={contacts}
        keeperId={keeperId}
        onKeeperChange={onKeeperChange}
        onRemove={isPair ? undefined : onRemove}
        caveats={caveats}
        caveatIdPrefix={caveatPrefix}
      />

      {actionsAt === "bottom" && (
        <div className="sticky bottom-0 z-10 -mx-1 px-1 py-3 bg-surface-container-lowest flex flex-wrap justify-end gap-2">
          {actions}
        </div>
      )}
    </div>
  );
};
