/**
 * ConnectionBanner — the app's single, honest answer to "why is nothing here?".
 *
 * Mounted once, at the top of the viewport, above every view. It replaces the
 * three contradictory local stories the app used to tell when the server went
 * away, and it is deliberately not a modal: the cached data underneath is
 * still real and still worth reading, so nothing gets blocked.
 *
 * @see hooks/useConnectionStatus
 */
import React from "react";
import { AnimatePresence, motion } from "motion/react";
import { CloudOff, Loader2, RefreshCw, WifiOff } from "lucide-react";
import { useConnectionStatus } from "../../hooks/useConnectionStatus";

export const ConnectionBanner = () => {
  const { status, isDown, retry, isRetrying } = useConnectionStatus();

  const offline = status === "offline";
  const Icon = offline ? WifiOff : CloudOff;

  return (
    <AnimatePresence>
      {isDown && (
        <motion.div
          // `role="status"` rather than "alert": this is important but not an
          // emergency, so it should not interrupt a screen reader mid-sentence.
          role="status"
          aria-live="polite"
          initial={{ y: "-100%" }}
          animate={{ y: 0 }}
          exit={{ y: "-100%" }}
          transition={{ type: "spring", bounce: 0, duration: 0.35 }}
          className="fixed top-0 inset-x-0 z-[200] flex justify-center px-3 pt-3 pointer-events-none"
          style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
        >
          <div className="pointer-events-auto flex w-full max-w-xl items-center gap-3 rounded-2xl glass-panel px-4 py-2.5 shadow-lg ring-1 ring-black/5">
            <Icon className="w-4 h-4 shrink-0 text-warning" />
            <p className="flex-1 min-w-0 text-sm text-on-surface">
              <span className="font-bold">
                {offline ? "You're offline." : "Can't reach Contrack."}
              </span>{" "}
              <span className="text-on-surface-variant">
                {offline
                  ? "Showing the last data loaded."
                  : "The server may be restarting."}
              </span>
            </p>
            <button
              type="button"
              onClick={retry}
              disabled={isRetrying}
              className="shrink-0 flex items-center gap-1.5 rounded-xl bg-surface-container-high px-3 py-1.5 text-xs font-bold text-on-surface transition-colors hover:bg-surface-container-highest disabled:text-on-surface-variant disabled:cursor-not-allowed"
            >
              {isRetrying ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              {isRetrying ? "Retrying…" : "Retry"}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
