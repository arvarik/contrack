/**
 * HealthRingAvatar — Contact avatar with themed color ring.
 *
 * The ring color is driven by the contact's `themeColor` preference.
 */
import React from "react";

import { fallbackAvatarUrl } from "../lib/avatar";
import { vibeTokens } from "../lib/theme";
import { usePreferences } from "../contexts/PreferencesContext";

interface HealthRingAvatarProps {
  contact: {
    name: string;
    avatarUrl?: string | null;
    themeColor?: string;
  };
  size?: number;
}

export const HealthRingAvatar: React.FC<HealthRingAvatarProps> = ({
  contact,
  size = 48,
}) => {
  const { mode } = usePreferences();
  const strokeWidth = 3.5;
  const radius = size / 2 - strokeWidth;
  const circumference = 2 * Math.PI * radius;

  // The ring is the contact's vibe, derived for the palette on screen. It used
  // to be a second, brighter copy of the vibe list — so the ring and the
  // profile page it opens were two different colours for the same contact.
  const ringColor = vibeTokens(contact.themeColor, mode).primary;

  return (
    <div
      className="relative shrink-0 flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        className="absolute inset-0 -rotate-90 pointer-events-none drop-shadow-sm"
      >
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
        style={{
          width: size - strokeWidth * 4,
          height: size - strokeWidth * 4,
        }}
      >
        <img
          src={contact.avatarUrl || fallbackAvatarUrl(contact.name)}
          alt={contact.name}
          className="w-full h-full object-cover shrink-0"
        />
      </div>
    </div>
  );
};
