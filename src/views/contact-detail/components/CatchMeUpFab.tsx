import React, { useState, useEffect } from "react";
import { Sparkles, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { formatDistanceToNow } from "date-fns";
import { parseBriefingPoints } from "../../../lib/safeParse";
import { SkeletonText } from "../../../components/ui/AnimatedSkeleton";
import { cn } from "../../../lib/utils";
import { Contact } from "../../../types";

interface CatchMeUpFabProps {
  contact: Contact;
  generateBriefing: { mutate: (id: string) => void; isPending: boolean };
}

export const CatchMeUpFab: React.FC<CatchMeUpFabProps> = ({
  contact,
  generateBriefing,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const isBriefingValid = React.useMemo(() => {
    if (!contact.aiBriefing || !contact.aiBriefingAt) return false;
    const diff = Date.now() - new Date(contact.aiBriefingAt).getTime();
    return diff < 3 * 24 * 60 * 60 * 1000; // 3 days
  }, [contact.aiBriefing, contact.aiBriefingAt]);

  useEffect(() => {
    if (generateBriefing.isPending) {
      setIsOpen(true);
    }
  }, [generateBriefing.isPending]);

  return (
    <>
      <button
        onClick={() => {
          if (!isBriefingValid && !generateBriefing.isPending) {
            generateBriefing.mutate(contact.id);
          } else {
            setIsOpen(true);
          }
        }}
        disabled={generateBriefing.isPending}
        className="p-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 active:scale-95 transition-all flex items-center justify-center shrink-0"
        title="Catch Me Up"
        aria-label="Generate AI briefing"
      >
        <Sparkles className="w-4 h-4" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-xl bg-surface-container-lowest shadow-2xl rounded-[2rem] p-6 md:p-8 overflow-hidden"
            >
              <button
                onClick={() => setIsOpen(false)}
                className="absolute top-5 right-5 p-2 rounded-full hover:bg-surface-container-highest transition-colors text-on-surface-variant hover:text-on-surface"
                aria-label="Close briefing"
              >
                <X className="w-5 h-5" />
              </button>

              <h3 className="text-xl md:text-2xl font-black font-headline mb-6 flex items-center gap-2.5 text-on-surface">
                <span className="bg-primary/10 p-2 rounded-xl text-primary">
                  <Sparkles className="w-5 h-5" />
                </span>
                Executive Briefing
              </h3>

              {generateBriefing.isPending && (
                <div className="space-y-4 pt-2">
                  <p className="text-sm font-bold text-primary animate-pulse">
                    Synthesizing Context...
                  </p>
                  <SkeletonText lines={4} className="h-4" />
                </div>
              )}

              {isBriefingValid && !generateBriefing.isPending && (
                <div>
                  <ul className="space-y-3.5 pr-2">
                    {parseBriefingPoints(contact.aiBriefing!).map(
                      (point: string, idx: number) => (
                        <li key={idx} className="flex gap-3">
                          <span className="text-primary font-bold max-w-fit flex-shrink-0 mt-0.5">
                            •
                          </span>
                          <span className="leading-relaxed text-sm text-on-surface-variant">
                            {point}
                          </span>
                        </li>
                      ),
                    )}
                  </ul>
                  <div className="flex items-center justify-between mt-8 pt-4 bg-surface-container-low -mx-6 md:-mx-8 px-6 md:px-8 -mb-6 md:-mb-8 pb-6 md:pb-8 rounded-b-[2rem]">
                    <p className="text-[10px] uppercase tracking-widest text-on-surface-variant/50 font-bold">
                      {contact.aiBriefingAt &&
                        `Generated ${formatDistanceToNow(new Date(contact.aiBriefingAt), { addSuffix: true })}`}
                    </p>
                    <button
                      onClick={() => generateBriefing.mutate(contact.id)}
                      className="text-xs font-bold text-primary bg-primary/10 hover:bg-primary/20 px-3 py-1.5 rounded-lg transition-colors shadow-sm"
                      aria-label="Regenerate briefing"
                    >
                      Regenerate
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};
