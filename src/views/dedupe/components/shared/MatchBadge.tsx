import React from "react";
import { AtSign, Mail, Phone, Sparkles, UserPlus, Zap } from "lucide-react";
import { TONE_WASH } from "../../../../lib/styles";

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
      label: "Email match",
      color: TONE_WASH.success,
    },
    phone: {
      icon: <Phone className="w-3.5 h-3.5" />,
      label: "Phone match",
      color: "bg-info/10 text-info",
    },
    // A model found this pair, so the badge wears the AI colour.
    ai: {
      icon: <Sparkles className="w-3.5 h-3.5" />,
      label: "AI match",
      color: "bg-ai/10 text-on-ai-wash",
    },
    // One name is the other with middle names added: "Anton Kovacs" and
    // "Anton Peter Kovacs". Named rather than left to the generic badge
    // because what a reviewer has to decide here is specific: a middle name
    // added is usually one person and sometimes a son.
    middle_name: {
      icon: <UserPlus className="w-3.5 h-3.5" />,
      label: "Middle name added",
      color: "bg-info/10 text-info",
    },
    // Not found by a scan. A note named somebody, the name was close to this
    // contact but not close enough to attach without asking, so the pair is
    // here instead of a link nobody would have seen being made.
    mention: {
      icon: <AtSign className="w-3.5 h-3.5" />,
      label: "Mentioned in a note",
      color: TONE_WASH.warning,
    },
  }[type] || {
    icon: <Zap className="w-3.5 h-3.5" />,
    label: "Match",
    color: TONE_WASH.neutral,
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold ${config.color}`}
    >
      {config.icon}
      {config.label} · {pct}%
    </span>
  );
};
