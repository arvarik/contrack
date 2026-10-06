/**
 * The app's one answer to "why is nothing here?" when the server is out of
 * reach (`hooks/useConnectionStatus`). Mounted once, above every view. Not a
 * modal: the cached data underneath is still worth reading.
 */
import { AnimatePresence, motion } from "motion/react";
import { CloudOff, Loader2, RefreshCw, WifiOff } from "lucide-react";
import { useConnectionStatus } from "../../hooks/useConnectionStatus";
import { DURATION, EASE } from "../../lib/motion";

export const ConnectionBanner = () => {
  const { status, isDown, retry, isRetrying } = useConnectionStatus();

  const offline = status === "offline";
  const Icon = offline ? WifiOff : CloudOff;

  // In the page's flow: it pushes the page down, not over its title.
  return (
    <AnimatePresence initial={false}>
      {isDown && (
        <motion.div
          // `status`, not `alert`: it should not interrupt a screen reader.
          role="status"
          aria-live="polite"
          initial={{ height: 0 }}
          animate={{ height: "auto" }}
          exit={{ height: 0 }}
          // An arrival: the slow duration on the one curve.
          transition={{ duration: DURATION.slow, ease: EASE }}
          className="shrink-0 overflow-hidden bg-surface-container-high"
        >
          <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-2">
            <Icon className="w-4 h-4 shrink-0 text-warning" />
            <p className="flex-1 min-w-0 text-sm text-on-surface">
              <span className="font-bold">
                {offline ? "You're offline" : "Could not reach Contrack"}.
              </span>{" "}
              <span className="text-on-surface-variant">
                {offline
                  ? "Showing the last data loaded"
                  : "The server may be restarting"}
              </span>
            </p>
            <button
              type="button"
              onClick={retry}
              disabled={isRetrying}
              className="btn-secondary btn-sm shrink-0"
            >
              {isRetrying ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              {isRetrying ? "Trying again…" : "Try again"}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
