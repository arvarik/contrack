/**
 * HealthRingAvatar — Contact avatar with themed color ring and relationship score tooltip.
 *
 * The ring color is driven by the contact's `themeColor` preference.
 * On hover, a tooltip shows the numeric relationship health score (0–100)
 * and a brief hint about what the score represents, so users understand
 * the visual signal without needing a legend elsewhere in the UI.
 */
import React from 'react';
import { cn } from '../lib/utils';

interface HealthRingAvatarProps {
  contact: any;
  size?: number;
  /** When true, suppress the tooltip (e.g. inside the detail header where score is already shown) */
  noTooltip?: boolean;
}

const VIBE_COLORS: Record<string, string> = {
  brand:  '#009EDB',
  emerald:'#10B981',
  amber:  '#F59E0B',
  rose:   '#F43F5E',
  indigo: '#6366F1',
  pink:   '#EC4899',
  violet: '#8B5CF6',
  teal:   '#14B8A6'
};

/** Return a human-readable health label for a numeric score */
const getHealthLabel = (score: number | null | undefined): string => {
  if (score == null) return 'Not yet scored';
  if (score >= 70) return 'Healthy relationship';
  if (score >= 40) return 'Needs attention';
  return 'At risk — reach out soon';
};

export const HealthRingAvatar: React.FC<HealthRingAvatarProps> = ({ contact, size = 48, noTooltip = false }) => {
  // Math Setup
  const strokeWidth = 3.5;
  const radius = (size / 2) - strokeWidth;
  const circumference = 2 * Math.PI * radius;

  // Use contact theme color or default brand color
  const ringColor = contact.themeColor && VIBE_COLORS[contact.themeColor]
    ? VIBE_COLORS[contact.themeColor]
    : VIBE_COLORS.brand;

  const score: number | null = contact.relationshipScore ?? null;
  const healthLabel = getHealthLabel(score);
  const hasScore = score != null;

  return (
    <div
      className={cn(
        "relative shrink-0 flex items-center justify-center group/ring",
        !noTooltip && "cursor-default"
      )}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="absolute inset-0 -rotate-90 pointer-events-none drop-shadow-sm">
        {/* Full solid ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={ringColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={0}
        />
      </svg>

      {/* Avatar image */}
      <div
        className="absolute m-auto overflow-hidden rounded-full bg-surface-container-highest flex items-center justify-center shrink-0"
        style={{ width: size - (strokeWidth * 4), height: size - (strokeWidth * 4) }}
      >
        <img
          src={contact.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(contact.name)}&mouth=default,smile,serious`}
          alt={contact.name}
          loading="lazy"
          className="w-full h-full object-cover shrink-0"
        />
      </div>

      {/* Relationship health tooltip — appears on ring hover */}
      {!noTooltip && (
        <div
          className={cn(
            "pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50",
            "opacity-0 group-hover/ring:opacity-100 transition-opacity duration-150",
            "w-max max-w-[160px]"
          )}
          role="tooltip"
        >
          <div className="bg-surface-container-highest text-on-surface text-[10px] font-semibold px-2.5 py-1.5 rounded-lg shadow-lg border border-surface-container text-center leading-snug">
            {hasScore ? (
              <>
                <span className="block font-extrabold text-xs" style={{ color: ringColor }}>
                  {score}/100
                </span>
                <span className="block text-on-surface-variant">{healthLabel}</span>
              </>
            ) : (
              <span className="text-on-surface-variant">{healthLabel}</span>
            )}
          </div>
          {/* Tooltip arrow */}
          <div className="mx-auto w-2 h-1.5 overflow-hidden -mt-px flex justify-center">
            <div className="w-2 h-2 bg-surface-container-highest border-r border-b border-surface-container rotate-45 -translate-y-1" />
          </div>
        </div>
      )}
    </div>
  );
};
