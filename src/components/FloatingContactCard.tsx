/**
 * A contact's profile over the search results that found it. Most of the
 * viewport, not the shared `Modal`: a profile is a page of content.
 *
 * Still a dialog: role and name, focus in on open, Tab kept inside, Escape
 * to close, and focus back to the result on close.
 * - An Escape a menu or a confirmation inside the card used is theirs.
 * - Android's Back closes it (`useCloseRequest`).
 * - One close at each width: the contact's Back bar below `lg`, the round X
 *   from `lg`.
 * - A delete closes the card and leaves the person on the page under it.
 */
import React, { useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X } from "lucide-react";
import { ContactProfile } from "../views/contact-detail/components/ContactProfile";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useCloseRequest } from "../hooks/useCloseRequest";
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
  // Where focus was, read during the render that opens this, as `Modal`
  // does: after the commit, focus may have moved.
  const previousFocus = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (isOpen && !wasOpen.current) {
    previousFocus.current = document.activeElement as HTMLElement | null;
  }
  wasOpen.current = isOpen;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
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
  useCloseRequest(isOpen, onClose);

  // Focus moves onto the card on open and back on close. `preventScroll`
  // keeps the results list where it was.
  useEffect(() => {
    if (isOpen) {
      panel.current?.focus({ preventScroll: true });
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
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.92, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{
              type: "spring",
              damping: 28,
              stiffness: 380,
              mass: 0.8,
            }}
            className="fixed inset-4 md:inset-8 lg:inset-12 xl:inset-x-[10%] xl:inset-y-8 z-[101] flex flex-col overflow-hidden rounded-3xl bg-surface shadow-2xl ring-1 ring-surface-container-highest/50 outline-none"
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Close contact details"
              className="state-layer absolute top-4 right-4 z-50 hidden lg:inline-flex items-center justify-center min-w-[44px] min-h-[44px] bg-surface-container-low rounded-full text-on-surface-variant hover:text-on-surface transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex-1 min-h-0 overflow-hidden">
              <ContactProfile
                contactId={contactId}
                onClose={onClose}
                onDeleted={onClose}
                showNetworkButton={showNetworkButton}
              />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
