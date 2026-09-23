/**
 * Badge — a short status word beside the thing it describes.
 *
 * 2.0 introduced a lot of state that a row has to carry: an account is active
 * or disabled, an invitation is pending or accepted or revoked or expired, a
 * token is live or revoked, an account is an admin or a member. Before this
 * every such pill was written out where it was used, which is how a codebase
 * ends up with four shades of "warning".
 *
 * The tones map onto the semantic colours in `.agent/STYLE.md` and nothing
 * else. `neutral` is deliberately the dullest: most rows are in their
 * ordinary state, and a badge that shouts on every row stops meaning
 * anything.
 */
import { type ReactNode } from "react";
import { cn } from "../../lib/utils";
import { TONE_WASH } from "../../lib/styles";

export type BadgeTone =
  "neutral" | "primary" | "success" | "warning" | "danger";

/** Each tone is the app's tone wash (`TONE_WASH`), so a badge and a chip agree. */
const TONES: Record<BadgeTone, string> = {
  neutral: TONE_WASH.neutral,
  primary: TONE_WASH.primary,
  success: TONE_WASH.success,
  warning: TONE_WASH.warning,
  danger: TONE_WASH.error,
};

export const Badge = ({
  tone = "neutral",
  icon,
  children,
  className,
}: {
  tone?: BadgeTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) => (
  <span
    className={cn(
      "inline-flex items-center gap-1 shrink-0 whitespace-nowrap",
      "rounded-md px-2 py-0.5",
      // The label tracking from lib/styles, so 11 px does not widen every row.
      "text-[11px] font-bold uppercase tracking-[0.08em]",
      TONES[tone],
      className,
    )}
  >
    {icon}
    {children}
  </span>
);
