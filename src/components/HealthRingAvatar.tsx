/**
 * HealthRingAvatar — Contact avatar with themed color ring.
 *
 * The ring color is driven by the contact's `themeColor` preference.
 */
import React from 'react';
import { cn } from '../lib/utils';
import { fallbackAvatarUrl } from '../lib/avatar';

interface HealthRingAvatarProps {
  contact: {
    name: string;
    avatarUrl?: string | null;
    themeColor?: string;
  };
  size?: number;
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

export const HealthRingAvatar: React.FC<HealthRingAvatarProps> = ({ contact, size = 48 }) => {
  const strokeWidth = 3.5;
  const radius = (size / 2) - strokeWidth;
  const circumference = 2 * Math.PI * radius;

  const ringColor = contact.themeColor && VIBE_COLORS[contact.themeColor]
    ? VIBE_COLORS[contact.themeColor]
    : VIBE_COLORS.brand;

  return (
    <div
      className="relative shrink-0 flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="absolute inset-0 -rotate-90 pointer-events-none drop-shadow-sm">
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
          src={contact.avatarUrl || fallbackAvatarUrl(contact.name)}
          alt={contact.name}
          className="w-full h-full object-cover shrink-0"
        />
      </div>
    </div>
  );
};

