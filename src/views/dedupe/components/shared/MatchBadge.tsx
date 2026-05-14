import React from "react";
import { Mail, Phone, Sparkles, Zap } from "lucide-react";

// =============================================================================
// MatchBadge — Match type indicator (email/phone/AI/manual)
// =============================================================================

export interface MatchBadgeProps {
  type: string;
  confidence: number;
}

export const MatchBadge = ({ type, confidence }: MatchBadgeProps) => {
  const pct = Math.round(confidence * 100);
  const config = {
    email: {
      icon: <Mail className="w-3.5 h-3.5" />,
      label: "Email Match",
      color: "text-emerald-600 bg-emerald-500/10",
    },
    phone: {
      icon: <Phone className="w-3.5 h-3.5" />,
      label: "Phone Match",
      color: "text-blue-600 bg-blue-500/10",
    },
    ai: {
      icon: <Sparkles className="w-3.5 h-3.5" />,
      label: "AI Match",
      color: "text-primary bg-primary/10",
    },
  }[type] || {
    icon: <Zap className="w-3.5 h-3.5" />,
    label: "Match",
    color: "text-on-surface-variant bg-surface-container",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${config.color}`}
    >
      {config.icon}
      {config.label} · {pct}%
    </span>
  );
};
