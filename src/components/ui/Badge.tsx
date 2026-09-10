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

export type BadgeTone =
  "neutral" | "primary" | "success" | "warning" | "danger";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-container-high text-on-surface-variant",
  primary: "bg-primary/10 text-primary",
  success: "bg-emerald-500/10 text-success",
  warning: "bg-amber-500/10 text-warning",
  danger: "bg-red-500/10 text-error",
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
      "rounded-full px-2 py-0.5",
      "text-[10px] font-bold uppercase tracking-widest whitespace-nowrap",
      TONES[tone],
      className,
    )}
  >
    {icon}
    {children}
  </span>
);
