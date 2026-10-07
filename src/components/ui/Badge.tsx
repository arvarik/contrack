/**
 * A short status word beside what it describes: active or disabled,
 * pending or revoked, admin or member. The tones are the semantic colors in
 * `.agent/STYLE.md`. `neutral` is the dullest, for the ordinary state most
 * rows are in.
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
