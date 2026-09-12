import React from "react";
import { AtSign, Mail, Phone, Sparkles, UserPlus, Zap } from "lucide-react";

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
      color: "text-success bg-emerald-500/10",
    },
    phone: {
      icon: <Phone className="w-3.5 h-3.5" />,
      label: "Phone Match",
      color: "text-info bg-blue-500/10",
    },
    ai: {
      icon: <Sparkles className="w-3.5 h-3.5" />,
      label: "AI Match",
      color: "text-primary bg-primary/10",
    },
    // One name is the other with middle names added: "Anton Kovacs" and
    // "Anton Peter Kovacs". Named rather than left to the generic badge
    // because what a reviewer has to decide here is specific: a middle name
    // added is usually one person and sometimes a son.
    middle_name: {
      icon: <UserPlus className="w-3.5 h-3.5" />,
      label: "Middle Name Added",
      color: "text-info bg-blue-500/10",
    },
    // Not found by a scan. A note named somebody, the name was close to this
    // contact but not close enough to attach without asking, so the pair is
    // here instead of a link nobody would have seen being made.
    mention: {
      icon: <AtSign className="w-3.5 h-3.5" />,
      label: "Mentioned In A Note",
      color: "text-warning bg-amber-500/10",
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
