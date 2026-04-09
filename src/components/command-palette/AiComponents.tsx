import React from 'react';
import { Command } from 'cmdk';
import { motion } from 'motion/react';
import { Briefcase, Building, Sparkles } from 'lucide-react';
import type { SemanticMatch } from '../../types';
import { fallbackAvatarUrl } from '../../lib/avatar';

export const AIShimmerRow = ({ delay = 0 }: { delay?: number }) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    transition={{ delay, duration: 0.2 }}
    className="flex items-center gap-3 px-3 py-3 rounded-xl"
  >
    <div className="w-8 h-8 rounded-full bg-primary/10 animate-pulse shrink-0" />
    <div className="flex-1 space-y-2">
      <div className="h-3 bg-primary/10 rounded-full animate-pulse w-2/5" />
      <div className="h-2.5 bg-surface-container-high rounded-full animate-pulse w-3/5" />
      <div className="h-2 bg-surface-container rounded-full animate-pulse w-4/5" />
    </div>
  </motion.div>
);

interface AIResultCardProps {
  match: SemanticMatch;
  index: number;
  onSelect: () => void;
  isFallback: boolean;
}

export const AIResultCard = ({ match, index, onSelect, isFallback }: AIResultCardProps) => (
  <Command.Item
    key={match.id}
    value={`ai_${match.id}_${match.name}`}
    onSelect={onSelect}
    className="flex items-start gap-3 px-3 py-3 rounded-xl cursor-default select-none aria-selected:bg-primary/8 aria-selected:ring-1 aria-selected:ring-primary/20 transition-all text-on-surface group"
  >
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.06, duration: 0.2 }}
      className="contents"
    >
      <img
        src={match.avatarUrl || fallbackAvatarUrl(match.name)}
        alt=""
        className="w-8 h-8 rounded-full bg-surface-container-highest object-cover shrink-0 mt-0.5"
      />
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm truncate">{match.name}</span>
          {isFallback && (
            <span className="text-[9px] font-bold uppercase tracking-widest bg-amber-500/10 text-amber-600 px-1.5 py-0.5 rounded shrink-0">
              Fallback
            </span>
          )}
        </div>
        {(match.role || match.company) && (
          <span className="text-xs text-on-surface-variant flex items-center gap-2 truncate">
            {match.role && <span className="flex items-center gap-1"><Briefcase className="w-3 h-3" />{match.role}</span>}
            {match.company && <span className="flex items-center gap-1"><Building className="w-3 h-3" />{match.company}</span>}
          </span>
        )}
        {match.aiReason && (
          <motion.span
            initial={{ opacity: 0, y: 2 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.06 + 0.1 }}
            className="text-xs text-primary/70 italic flex items-center gap-1 mt-0.5"
          >
            <Sparkles className="w-3 h-3 text-primary/50 shrink-0" />
            {match.aiReason}
          </motion.span>
        )}
      </div>
    </motion.div>
  </Command.Item>
);
