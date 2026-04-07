import React from 'react';
import { cn } from "../../lib/utils";
import { CARD_COMPACT, LABEL_PRIMARY } from "../../lib/styles";
import { LucideIcon } from "lucide-react";
import { motion } from "motion/react";

interface MetricCardProps {
  label: string;
  value: string | number;
  subValue?: string;
  icon: LucideIcon;
  delay?: number;
  highlight?: boolean;
  onClick?: () => void;
}

export const MetricCard = ({ label, value, subValue, icon: Icon, delay = 0, highlight = false, onClick }: MetricCardProps) => {
  const Component = onClick ? motion.button : motion.div;
  
  return (
    <Component
      onClick={onClick}
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: "easeOut" }}
      className={cn(
        CARD_COMPACT, 
        "flex flex-col relative text-left overflow-hidden group transition-all duration-200",
        highlight && "ring-1 ring-primary/20 bg-primary/[0.02]",
        onClick && "cursor-pointer hover:-translate-y-1 hover:shadow-md hover:ring-2 hover:ring-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      )}
    >
      <div className="flex items-start justify-between mb-2">
        <span className={cn(LABEL_PRIMARY, highlight ? "text-primary" : "text-on-surface-variant")}>
          {label}
        </span>
        <div className={cn(
          "p-1.5 rounded-lg transition-colors duration-300",
          highlight ? "bg-primary/10 text-primary" : "bg-surface-container text-on-surface-variant group-hover:bg-surface-container-high"
        )}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div className="mt-auto flex items-baseline gap-2">
        <span className={cn("text-3xl font-headline font-bold", highlight ? "text-primary" : "text-on-surface")}>
          {value}
        </span>
        {subValue && (
          <span className="text-xs font-bold text-on-surface-variant/60">
            {subValue}
          </span>
        )}
      </div>
      
      {highlight && (
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent pointer-events-none" />
      )}
    </Component>
  );
};
