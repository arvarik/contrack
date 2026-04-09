import React, { useState } from 'react';
import { cn } from "../../lib/utils";
import { CARD_COMPACT, SECTION_HEADING, TAG_PILL } from "../../lib/styles";
import { DashboardPayload } from "../../api";
import { Link } from "react-router-dom";
import { Ghost, HeartPulse, Sparkles, Clock } from "lucide-react";
import { motion } from "motion/react";
import { FloatingContactCard } from "../../components/FloatingContactCard";
import { fallbackAvatarUrl } from '../../lib/avatar';

interface NetworkHealthProps {
  payload: DashboardPayload;
  delay?: number;
}

const Avatar = ({ url, name, color, size = "w-10 h-10" }: { url?: string | null, name: string, color: string, size?: string }) => {
  const src = url || fallbackAvatarUrl(name);
  return <img src={src} alt={name} className={cn("rounded-full object-cover shadow-sm bg-surface-container-highest", size)} />;
};

export const NetworkHealthPanel = ({ payload, delay = 0 }: NetworkHealthProps) => {
  const [floatingContactId, setFloatingContactId] = useState<string | null>(null);

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: "easeOut" }}
      className="flex flex-col gap-6"
    >
      {/* GHOSTS */}
      {payload.ghosts.length > 0 && (
        <div className={cn(CARD_COMPACT, "bg-surface-container border-dashed border-2 border-surface-container-high")}>
          <div className="flex items-center gap-2 mb-4">
            <Ghost className="w-4 h-4 text-on-surface-variant" />
            <span className={SECTION_HEADING}>Unlock Your Network</span>
            <span className={cn(TAG_PILL, "ml-auto bg-surface-container-high text-on-surface-variant")}>
              {payload.ghosts.length} detected
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
             {payload.ghosts.slice(0, 5).map(g => (
               <Link 
                 key={g.id} 
                 to={`/contact/${g.id}`}
                 className="flex items-center gap-2 bg-surface-container-lowest pr-4 pl-1.5 py-1.5 rounded-full hover:bg-surface hover:ring-1 hover:ring-primary/20 transition-all group shadow-sm"
               >
                 <Avatar url={g.avatarUrl} name={g.name} color={g.themeColor} size="w-6 h-6 text-[10px]" />
                 <span className="text-xs font-bold text-on-surface group-hover:text-primary transition-colors">{g.name}</span>
                 {g.mentionCount > 1 && (
                   <span className="text-[9px] font-mono font-bold text-on-surface-variant opacity-60">
                     {g.mentionCount} mentions
                   </span>
                 )}
               </Link>
             ))}
          </div>
        </div>
      )}

      {/* AT RISK */}
      {payload.atRisk.length > 0 && (
        <div className={CARD_COMPACT}>
          <div className="flex items-center gap-2 mb-4">
            <HeartPulse className="w-4 h-4 text-error" />
            <span className={SECTION_HEADING}>Relationships to Rescue</span>
          </div>
          <div className="flex flex-col gap-2">
            {payload.atRisk.map(c => (
              <Link 
                key={c.id} 
                to={`/contact/${c.id}`}
                className="flex items-center gap-3 p-2 rounded-xl hover:bg-surface-container-low transition-colors group"
              >
                <div className="relative">
                  <Avatar url={c.avatarUrl} name={c.name} color={c.themeColor} size="w-9 h-9" />
                  <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-error rounded-full border-2 border-surface flex items-center justify-center">
                    <span className="text-[7px] font-bold text-white leading-none">{Math.round(c.relationshipScore)}</span>
                  </div>
                </div>
                <div className="flex flex-col flex-1 min-w-0">
                  <span className="text-sm font-bold text-on-surface truncate group-hover:text-primary transition-colors">{c.name}</span>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-error opacity-80">
                    {c.daysSinceContact} days silent
                  </span>
                </div>
                <div className="shrink-0 p-2 bg-surface-container text-on-surface-variant rounded-lg group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                  <Sparkles className="w-4 h-4" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* RECENTLY ADDED */}
      {payload.recentlyAdded.length > 0 && (
        <div className={CARD_COMPACT}>
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-on-surface-variant" />
            <span className={SECTION_HEADING}>Recently Added</span>
          </div>
          <div className="flex -space-x-3 overflow-hidden ml-1 py-1">
             {payload.recentlyAdded.map((c, i) => (
                <button 
                  key={c.id} 
                  onClick={() => setFloatingContactId(c.id)}
                  className="relative z-10 hover:z-20 transform hover:scale-110 transition-transform focus:outline-none"
                >
                    <img
                      src={c.avatarUrl || fallbackAvatarUrl(c.name)}
                      alt={c.name}
                      className="w-10 h-10 rounded-full border-2 border-surface-container-lowest object-cover shadow-sm bg-surface-container-highest"
                    />
                </button>
             ))}
          </div>
        </div>
      )}

      <FloatingContactCard
        contactId={floatingContactId}
        isOpen={!!floatingContactId}
        onClose={() => setFloatingContactId(null)}
        showNetworkButton
      />
    </motion.div>
  );
};
