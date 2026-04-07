import React from 'react';
import { cn } from "../../lib/utils";
import { CARD_COMPACT } from "../../lib/styles";

const SkeletonBox = ({ className, children }: { className?: string, children?: React.ReactNode }) => (
  <div className={cn("bg-surface-container/50 animate-pulse rounded-2xl", className)}>
    {children}
  </div>
);

const SkeletonText = ({ className, width = "w-full" }: { className?: string, width?: string }) => (
  <div className={cn("h-4 bg-surface-container-highest/60 animate-pulse rounded-full", width, className)} />
);

export const DashboardSkeleton = () => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start w-full">
      {/* Top KPI Row */}
      <div className="col-span-full grid grid-cols-1 md:grid-cols-3 gap-6">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-surface-container-lowest rounded-2xl border border-surface-container p-5 flex flex-col items-center justify-center h-32 relative overflow-hidden">
            <SkeletonText width="w-20" className="h-8 mb-2" />
            <SkeletonText width="w-32" className="h-3" />
            <SkeletonBox className="absolute bottom-[-10px] right-[-10px] w-20 h-20 opacity-20" />
          </div>
        ))}
      </div>

      {/* AI Insight */}
      <div className="col-span-full">
        <SkeletonBox className="h-[120px] bg-primary/5 border border-primary/20 w-full flex flex-col p-6">
           <SkeletonText width="w-24" className="h-5 bg-primary/20 mb-4" />
           <SkeletonText width="w-3/4" className="mb-2" />
           <SkeletonText width="w-1/2" />
        </SkeletonBox>
      </div>

      {/* Left Column: Action Items */}
      <div className="col-span-full xl:col-span-8 flex flex-col gap-8">
        {[1, 2].map(section => (
          <div key={section} className="flex flex-col gap-3">
             <SkeletonText width="w-24" className="h-4 mb-2" />
             {[1, 2].map(card => (
               <div key={card} className="w-full rounded-xl border border-surface-container bg-surface-container-lowest p-4 flex items-center gap-4 animate-pulse">
                 <div className="w-6 h-6 rounded-full bg-surface-container-highest shrink-0" />
                 <div className="flex flex-col flex-1 gap-2">
                   <SkeletonText width="w-48" />
                   <SkeletonText width="w-32" className="h-3" />
                 </div>
                 <div className="flex gap-2">
                   <SkeletonBox className="w-24 h-8 rounded-lg" />
                   <SkeletonBox className="w-8 h-8 rounded-lg" />
                 </div>
               </div>
             ))}
          </div>
        ))}
      </div>

      {/* Right Column: Network Health */}
      <div className="col-span-full xl:col-span-4 flex flex-col gap-6">
        <SkeletonBox className="h-[400px] w-full" />
        <SkeletonBox className="h-[200px] w-full" />
      </div>
    </div>
  );
};
