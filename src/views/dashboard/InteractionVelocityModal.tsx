import React from "react";
import { ActivitySquare, Phone, Mail, FileText, Calendar, LucideIcon } from "lucide-react";
import { X } from "lucide-react";
import { motion } from "motion/react";
import { DashboardPayload } from "../../api";
import { SECTION_HEADING } from "../../lib/styles";
import { Modal } from "../../components/ui/Modal";

interface InteractionVelocityModalProps {
  isOpen: boolean;
  onClose: () => void;
  breakdown: DashboardPayload["interactionBreakdown30d"];
}

const TYPE_ICONS: Record<string, LucideIcon> = {
  call: Phone,
  meeting: Calendar,
  email: Mail,
  note: FileText,
  default: ActivitySquare,
};

export const InteractionVelocityModal = ({ isOpen, onClose, breakdown }: InteractionVelocityModalProps) => {
  if (!breakdown) return null;

  const maxCount = Math.max(...breakdown.map(d => d.count), 1);
  const totalCount = breakdown.reduce((acc, d) => acc + d.count, 0);

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      {/* Header */}
      <div className="px-6 py-5 bg-surface-container-low flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/10">
            <ActivitySquare className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-on-surface">Interaction Velocity</h2>
            <p className="text-xs text-on-surface-variant font-medium">Last 30 Days</p>
          </div>
        </div>
        <button 
          onClick={onClose}
          className="p-2 rounded-full hover:bg-surface-container transition-colors text-on-surface-variant hover:text-on-surface"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Content */}
      <div className="p-6 sm:p-8">
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-2 mb-2">
            <span className={SECTION_HEADING}>Activity Breakdown</span>
          </div>

          {breakdown.length === 0 ? (
            <div className="text-center py-6 text-on-surface-variant text-sm font-medium">
              No interactions recorded in the last 30 days.
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {breakdown.map((item, index) => {
                const Icon = TYPE_ICONS[item.type.toLowerCase()] || TYPE_ICONS.default;
                const widthPercentage = (item.count / maxCount) * 100;
                
                return (
                  <div key={item.type} className="flex flex-col gap-1 w-full">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <Icon className="w-4 h-4 text-on-surface-variant opacity-70" />
                        <span className="font-bold text-on-surface capitalize">
                          {item.type}
                        </span>
                      </div>
                      <span className="text-on-surface-variant font-medium">
                        {item.count} <span className="opacity-50 text-xs">({Math.round((item.count / totalCount) * 100)}%)</span>
                      </span>
                    </div>
                    
                    <div className="h-2.5 w-full bg-surface-container-high rounded-full overflow-hidden flex mt-1">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${widthPercentage}%` }}
                        transition={{ duration: 0.8, delay: 0.1 + index * 0.05, ease: "easeOut" }}
                        className="h-full bg-primary rounded-full origin-left"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          
          <div className="mt-4 flex justify-between items-center bg-surface-container-low p-4 rounded-xl">
             <span className="font-bold text-on-surface-variant text-sm flex items-center gap-2">
               <ActivitySquare className="w-4 h-4 opacity-50" />
               Total Monthly Touchpoints
             </span>
             <span className="text-xl font-headline font-bold text-primary">{totalCount}</span>
          </div>
        </div>
      </div>
    </Modal>
  );
};
