import React, { useEffect, useState } from 'react';
import { differenceInDays, parseISO } from 'date-fns';

interface HealthRingAvatarProps {
  contact: any;
  size?: number;
}

export const HealthRingAvatar: React.FC<HealthRingAvatarProps> = ({ contact, size = 48 }) => {
  const [offset, setOffset] = useState<number>(0);
  const [initialRender, setInitialRender] = useState(true);

  // Math Setup
  const strokeWidth = 3.5;
  const radius = (size / 2) - strokeWidth;
  const circumference = 2 * Math.PI * radius;

  // Logic calculation
  let ringColor = 'text-emerald-500'; // Default Healthy
  let percentRemaining = 100;

  if (contact.lastContactedAt) {
    const elapsedDays = differenceInDays(new Date(), parseISO(contact.lastContactedAt));
    const cadence = contact.cadenceDays || 90;
    const remainingDays = Math.max(cadence - Math.max(elapsedDays, 0), 0);
    percentRemaining = Math.max((remainingDays / cadence) * 100, 0);

    if (percentRemaining === 0) {
      ringColor = 'text-rose-500'; // Overdue 
    } else if (percentRemaining < 40) {
      ringColor = 'text-amber-500'; // Nearing Due
    }
  }

  // Animation effect
  useEffect(() => {
    // 100% remaining = full circle (offset = 0)
    // 0% remaining = empty circle (offset = circumference)
    const targetOffset = circumference - (percentRemaining / 100) * circumference;
    
    // Slight delay to allow CSS transitions to catch the initial render state
    const timeout = setTimeout(() => {
      setInitialRender(false);
      setOffset(targetOffset);
    }, 50);

    return () => clearTimeout(timeout);
  }, [percentRemaining, circumference]);

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
        {/* Progress Value */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          className={`${ringColor} transition-all duration-1000 ease-[cubic-bezier(0.25,1,0.5,1)]`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={initialRender ? circumference : offset}
        />
      </svg>
      {/* Contained Image wrapper to avoid overlapping with stroke boundaries */}
      <div 
        className="absolute m-auto overflow-hidden rounded-full bg-surface-container-highest flex items-center justify-center shrink-0"
        style={{ width: size - (strokeWidth * 4), height: size - (strokeWidth * 4) }}
      >
        <img
          src={contact.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(contact.name)}`}
          alt={contact.name}
          className="w-full h-full object-cover shrink-0"
        />
      </div>
    </div>
  );
};
