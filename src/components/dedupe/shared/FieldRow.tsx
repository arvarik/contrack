import React from 'react';

// =============================================================================
// FieldRow — A single labeled field row with optional diff highlight
// =============================================================================

export interface FieldRowProps {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
  highlighted?: boolean;
}

export const FieldRow = ({ icon, label, children, highlighted }: FieldRowProps) => (
  <div className={`flex items-center gap-2.5 ${highlighted ? 'bg-amber-500/8 rounded-lg px-2.5 py-1.5 -mx-1' : ''}`}>
    <span className="text-on-surface-variant/60 shrink-0">{icon}</span>
    <span className="text-on-surface-variant text-xs font-bold uppercase tracking-wider w-16 shrink-0">{label}</span>
    <span className="text-on-surface">{children}</span>
  </div>
);
