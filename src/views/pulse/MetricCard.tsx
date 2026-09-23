import { cn } from "../../lib/utils";
import { CARD_COMPACT, LABEL_PRIMARY, TONE_WASH } from "../../lib/styles";
import { LucideIcon } from "lucide-react";

interface MetricCardProps {
  label: string;
  value: string | number;
  subValue?: string;
  icon: LucideIcon;
  /** CSS entrance delay from `tileDelay(index)`. */
  delay?: string;
  highlight?: boolean;
}

export const MetricCard = ({
  label,
  value,
  subValue,
  icon: Icon,
  delay,
  highlight = false,
}: MetricCardProps) => {
  return (
    // The entrance runs on a wrapper. `tile-enter` holds its last `transform`
    // after it ends. The tile is static, so it has no hover.
    <div className="tile-enter" style={{ animationDelay: delay }}>
      <div
        className={cn(
          CARD_COMPACT,
          "w-full h-full flex flex-col relative text-left overflow-hidden",
          // Reserve the tile's height up front so the row does not resize when
          // the numbers land. Matches the skeleton's 8rem on desktop; tighter on
          // phones, where the three tiles stack and the extra air just costs
          // scrolling.
          "min-h-[6rem] sm:min-h-[8rem]",
        )}
      >
        <div className="flex items-start justify-between mb-2 gap-2">
          <span
            className={cn(
              LABEL_PRIMARY,
              highlight ? "text-primary" : "text-on-surface-variant",
            )}
          >
            {label}
          </span>
          <div
            className={cn(
              "p-1.5 rounded-lg shrink-0",
              TONE_WASH[highlight ? "primary" : "neutral"],
            )}
          >
            <Icon className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-auto flex flex-wrap items-baseline gap-x-2">
          <span
            className={cn(
              "text-3xl font-headline font-bold tabular-nums",
              highlight ? "text-primary" : "text-on-surface",
            )}
          >
            {value}
          </span>
          {subValue && (
            <span className="text-xs font-bold text-on-surface-variant">
              {subValue}
            </span>
          )}
        </div>

        {/* A highlighted tile says so in its ink and this faint wash. No
            ring and no fill on the card: a ring utility replaces the card's
            shadow, and a `bg-*` utility replaces its white face. */}
        {highlight && (
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent pointer-events-none" />
        )}
      </div>
    </div>
  );
};
