import React, { useEffect, useState } from 'react';

interface HealthRingAvatarProps {
  contact: any;
  size?: number;
}

const VIBE_COLORS: Record<string, string> = {
  brand: '#009EDB',
  emerald: '#10B981',
  amber: '#F59E0B',
  rose: '#F43F5E',
  indigo: '#6366F1',
  pink: '#EC4899',
  violet: '#8B5CF6',
  teal: '#14B8A6'
};

export const HealthRingAvatar: React.FC<HealthRingAvatarProps> = ({ contact, size = 48 }) => {
  const [initialRender, setInitialRender] = useState(true);

  // Math Setup
  const strokeWidth = 3.5;
  const radius = (size / 2) - strokeWidth;
  const circumference = 2 * Math.PI * radius;

  const hexColor = VIBE_COLORS[contact.themeColor] || VIBE_COLORS['brand'];

  // Animation effect
  useEffect(() => {
    // Slight delay to allow CSS transitions to catch the initial render state
    const timeout = setTimeout(() => {
      setInitialRender(false);
    }, 50);

    return () => clearTimeout(timeout);
  }, []);

  return (
    <div className="relative shrink-0 flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90 pointer-events-none drop-shadow-sm">
        {/* Track Line */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          className="text-surface-container-high transition-colors"
          strokeWidth={strokeWidth}
        />
        {/* Progress Value (Always 100% full, but colored by theme) */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={hexColor}
          className="transition-all duration-1000 ease-[cubic-bezier(0.25,1,0.5,1)]"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={initialRender ? circumference : 0}
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
          className="w-full h-full object-cover shrink-0"
        />
      </div>
    </div>
  );
};

