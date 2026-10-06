/** The pull-to-refresh spinner: it turns with the pull, then spins while refreshing. */
import { RefreshCw } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface PullIndicatorProps {
  isPulling: boolean;
  isRefreshing: boolean;
  /** 0–1: how far the user has pulled relative to the trigger threshold */
  progress: number;
  /** Raw px pulled — used to set the indicator height */
  pullDistance: number;
}

export const PullIndicator = ({
  isPulling,
  isRefreshing,
  progress,
  pullDistance,
}: PullIndicatorProps) => (
  <AnimatePresence>
    {(isPulling || isRefreshing) && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{ height: isRefreshing ? 48 : pullDistance }}
        className="flex items-center justify-center overflow-hidden transition-[height]"
      >
        <motion.div
          animate={{ rotate: isRefreshing ? 360 : progress * 180 }}
          transition={
            isRefreshing
              ? { duration: 0.8, repeat: Infinity, ease: "linear" }
              : { duration: 0 }
          }
          // A raised circle, visible on the list's near-white pane.
          className="p-2 rounded-full bg-surface-container-highest shadow-md"
        >
          <RefreshCw
            style={{ opacity: 0.7 + progress * 0.3 }}
            className="w-4 h-4 text-primary"
          />
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>
);
