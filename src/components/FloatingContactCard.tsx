/**
 * FloatingContactCard — a contact's profile over the page that found it.
 *
 * Opened from a search result, so the reader can see who was found without
 * leaving the results. It fills most of the viewport rather than using the
 * shared `Modal`, because a profile is a page's worth of content and the
 * centred card would scroll inside a scrolling page.
 *
 * It is a dialog all the same, and it carries what a dialog owes a keyboard
 * or screen-reader user: the role and name, focus moved into it when it
 * opens, Tab kept inside it while it is open, Escape to close, and focus
 * returned to the result that opened it when it closes. Before this it had
 * Escape and nothing else, so a keyboard user who opened a result was left
 * tabbing through the results underneath an overlay they could not reach.
 */
import React, { useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X } from "lucide-react";
import { ContactProfile } from "../views/contact-detail/components/ContactProfile";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { DURATION, EASE } from "../lib/motion";

interface FloatingContactCardProps {
  contactId: string | null;
  isOpen: boolean;
  onClose: () => void;
  showNetworkButton?: boolean;
}

export const FloatingContactCard: React.FC<FloatingContactCardProps> = ({
  contactId,
  isOpen,
  onClose,
  showNetworkButton = false,
}) => {
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  // Where focus was before this opened, captured during the render that
  // opens it — the same moment the shared Modal reads it, and for the same
  // reason: after the commit, focus may already have moved.
  const previousFocus = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (isOpen && !wasOpen.current) {
    previousFocus.current = document.activeElement as HTMLElement | null;
  }
  wasOpen.current = isOpen;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [isOpen, handleKeyDown]);

  useFocusTrap(panel, isOpen);

  // Focus moves in on open and back out on close. `preventScroll` keeps the
  // results list where it was, so the reader lands on the same row they left.
  useEffect(() => {
    if (isOpen) {
      closeButton.current?.focus({ preventScroll: true });
      return;
    }
    const previous = previousFocus.current;
    if (previous?.isConnected) previous.focus({ preventScroll: true });
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && contactId && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DURATION.fast, ease: EASE }}
            onClick={onClose}
            aria-hidden="true"
            className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm"
          />

          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label="Contact details"
            initial={{ opacity: 0, scale: 0.92, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{
              type: "spring",
              damping: 28,
              stiffness: 380,
              mass: 0.8,
            }}
            className="fixed inset-4 md:inset-8 lg:inset-12 xl:inset-x-[10%] xl:inset-y-8 z-[101] flex flex-col overflow-hidden rounded-3xl bg-surface shadow-2xl ring-1 ring-surface-container-highest/50"
          >
            <button
              ref={closeButton}
              type="button"
              onClick={onClose}
              aria-label="Close contact details"
              className="state-layer absolute top-4 right-4 z-50 inline-flex items-center justify-center min-w-[44px] min-h-[44px] bg-surface-container-low rounded-full text-on-surface-variant hover:text-on-surface transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex-1 min-h-0 overflow-hidden">
              <ContactProfile
                contactId={contactId}
                onClose={onClose}
                showNetworkButton={showNetworkButton}
              />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
