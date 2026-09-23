/**
 * SettingsCallout — what is waiting on a settings page, and the one step to
 * take about it: "12 possible duplicates, Review them", "30 contacts have
 * never been enriched, Select them".
 *
 * A card on the primary wash, above the page's settings. From `sm` the
 * action sits at the right of the sentence. On a phone it drops under it,
 * so the sentence keeps the card's width instead of a narrow column.
 *
 * @module views/settings/SettingsCallout
 */
import React from "react";
import type { LucideIcon } from "lucide-react";
import { CARD, TONE_WASH } from "../../lib/styles";
import { cn } from "../../lib/utils";

export const SettingsCallout = ({
  icon: Icon,
  title,
  body,
  children,
  className,
}: {
  icon: LucideIcon;
  title: React.ReactNode;
  body: React.ReactNode;
  /** The one action: a `.btn-primary btn-sm`. */
  children: React.ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      CARD,
      "p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 bg-primary/10",
      className,
    )}
  >
    <div className="flex items-center gap-3 min-w-0">
      <span className={cn("p-2 rounded-lg shrink-0", TONE_WASH.primary)}>
        <Icon aria-hidden="true" className="w-5 h-5" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-bold text-on-surface text-pretty">{title}</p>
        <p className="text-xs text-on-surface-variant text-pretty">{body}</p>
      </div>
    </div>
    <div className="shrink-0 self-end sm:self-auto">{children}</div>
  </div>
);
