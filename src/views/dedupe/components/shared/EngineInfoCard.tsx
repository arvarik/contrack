import React from "react";

// =============================================================================
// EngineInfoCard — Scan method description
// =============================================================================

export interface EngineInfoCardProps {
  icon: React.ReactNode;
  title: string;
  desc: string;
}

export const EngineInfoCard = ({ icon, title, desc }: EngineInfoCardProps) => (
  <div className="bg-surface-container-lowest rounded-xl p-4 flex items-start gap-3 shadow-sm">
    <div className="shrink-0 mt-0.5">{icon}</div>
    <div>
      <div className="text-sm font-bold text-on-surface">{title}</div>
      <div className="text-xs text-on-surface-variant">{desc}</div>
    </div>
  </div>
);
