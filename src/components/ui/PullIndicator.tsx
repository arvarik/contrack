/**
 * PullIndicator — Visual feedback component rendered during a pull-to-refresh gesture.
 * Animates the spinner's rotation based on pull progress, and spins continuously
 * while the refresh is in progress.
 */
import React from "react";
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
        className="flex items-center justify-center overflow-hidden transition-[height] duration-200"
      >
        <motion.div
          animate={{ rotate: isRefreshing ? 360 : progress * 180 }}
          transition={
            isRefreshing
              ? { duration: 0.8, repeat: Infinity, ease: "linear" }
              : { duration: 0 }
          }
          className="p-2 rounded-full bg-surface-container-low shadow-sm"
        >
          <RefreshCw
            style={{ opacity: 0.4 + progress * 0.6 }}
            className="w-4 h-4 text-primary"
          />
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>
);
