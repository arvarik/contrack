import React from "react";
import { X, PieChart, MapPin, Briefcase } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { DashboardPayload } from "../../api";
import { cn } from "../../lib/utils";
import { SECTION_HEADING } from "../../lib/styles";
import { Modal } from "../../components/ui/Modal";

interface NetworkCompositionModalProps {
  isOpen: boolean;
  onClose: () => void;
  composition: DashboardPayload;
}

/** e.g. { industry: 'Tech', count: 12 } or { location: 'NYC', count: 8 } */
type CompositionEntry = { [key: string]: string | number; count: number };

const CompositionColumn = ({ 
  title, 
  icon: Icon, 
  data 
}: { 
  title: string; 
  icon: LucideIcon; 
  data: CompositionEntry[]; 
}) => {
  if (!data || data.length === 0) return null;

  const maxCount = Math.max(...data.map(d => d.count));
  const totalCount = data.reduce((acc, d) => acc + d.count, 0);

  // Derive label by looking for the string property that isn't count
  const renderItem = (item: CompositionEntry, index: number) => {
    const labelKey = Object.keys(item).find(k => k !== 'count')!;
    const labelResult = item[labelKey];
    const widthPercentage = (item.count / maxCount) * 100;

    return (
      <div key={labelResult} className="flex flex-col gap-1 w-full">
        <div className="flex justify-between items-center text-xs">
          <span className="font-bold text-on-surface truncate pr-2">
            {labelResult}
          </span>
          <span className="text-on-surface-variant font-medium shrink-0">
            {item.count} <span className="opacity-50 text-[10px]">({Math.round((item.count / totalCount) * 100)}%)</span>
          </span>
        </div>
        
        <div className="h-2 w-full bg-surface-container-high rounded-full overflow-hidden flex">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${widthPercentage}%` }}
            transition={{ duration: 0.8, delay: 0.1 + index * 0.05, ease: "easeOut" }}
            className="h-full bg-primary rounded-full origin-left"
          />
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-5 w-full">
      <div className="flex items-center gap-2">
        <Icon className="w-5 h-5 text-primary opacity-80" />
        <span className={SECTION_HEADING}>{title}</span>
      </div>
      <div className="flex flex-col gap-4">
        {data.map((item, index) => renderItem(item, index))}
      </div>
    </div>
  );
};

export const NetworkCompositionModal = ({ isOpen, onClose, composition }: NetworkCompositionModalProps) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl">
      {/* Header */}
      <div className="px-6 py-5 bg-surface-container-low flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/10">
            <PieChart className="w-5 h-5 text-primary" />
          </div>
          <h2 className="text-xl font-bold text-on-surface">Network Composition</h2>
        </div>
        <button 
          onClick={onClose}
          className="p-2 rounded-full hover:bg-surface-container transition-colors text-on-surface-variant hover:text-on-surface"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Scrollable Content */}
      <div className="p-6 sm:p-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10 md:gap-8">
          <CompositionColumn title="Industry" icon={PieChart} data={composition.industryComposition} />
          <CompositionColumn title="Location" icon={MapPin} data={composition.locationComposition} />
          <CompositionColumn title="Role" icon={Briefcase} data={composition.roleComposition} />
        </div>
      </div>
    </Modal>
  );
};
