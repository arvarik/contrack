/**
 * ConnectionBanner — the app's single, honest answer to "why is nothing here?".
 *
 * Mounted once, at the top of the layout, above every view. It replaces the
 * three contradictory local stories the app used to tell when the server went
 * away, and it is deliberately not a modal: the cached data underneath is
 * still real and still worth reading, so nothing gets blocked.
 *
 * @see hooks/useConnectionStatus
 */
import { AnimatePresence, motion } from "motion/react";
import { CloudOff, Loader2, RefreshCw, WifiOff } from "lucide-react";
import { useConnectionStatus } from "../../hooks/useConnectionStatus";

export const ConnectionBanner = () => {
  const { status, isDown, retry, isRetrying } = useConnectionStatus();

  const offline = status === "offline";
  const Icon = offline ? WifiOff : CloudOff;

  // A bar in the page's flow, above every view: it pushes the page down
  // rather than floating over its title, as it once did.
  return (
    <AnimatePresence initial={false}>
      {isDown && (
        <motion.div
          // `role="status"` rather than "alert": this is important but not an
          // emergency, so it should not interrupt a screen reader mid-sentence.
          role="status"
          aria-live="polite"
          initial={{ height: 0 }}
          animate={{ height: "auto" }}
          exit={{ height: 0 }}
          transition={{ type: "spring", bounce: 0, duration: 0.35 }}
          className="shrink-0 overflow-hidden bg-surface-container-high"
        >
          <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-2">
            <Icon className="w-4 h-4 shrink-0 text-warning" />
            <p className="flex-1 min-w-0 text-sm text-on-surface">
              <span className="font-bold">
                {offline ? "You're offline" : "Can't reach Contrack"}.
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
              {isRetrying ? "Retrying…" : "Retry"}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
