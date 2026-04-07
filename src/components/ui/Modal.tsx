/**
 * Modal — Accessible, animated overlay dialog.
 *
 * Accessibility:
 *  - Saves `document.activeElement` before opening; restores it on close
 *  - Auto-focuses the close button on open (acts as initial focus anchor)
 *  - Traps Escape to close (does not trap full Tab focus — acceptable for this app)
 *
 * Rendering:
 *  - Uses a React portal to escape parent stacking contexts
 *  - Backdrop blur + scale entrance animation
 */
import { motion, AnimatePresence } from "motion/react";
import { X } from "lucide-react";
import { ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function Modal({ isOpen, onClose, title, children }: ModalProps) {
  // Remember what had focus before the modal opened
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Capture previous focus on open; restore it on close
  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      // Move initial focus to the close button after animation frame
      requestAnimationFrame(() => closeButtonRef.current?.focus());
    } else {
      // Restore focus to the element that triggered the modal
      requestAnimationFrame(() => previousFocusRef.current?.focus());
    }
  }, [isOpen]);

  // Escape key closes
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isOpen && e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const content = (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-on-surface/20 backdrop-blur-sm z-[200]"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg glass-panel rounded-2xl shadow-2xl z-[201] overflow-hidden"
          >
            <div className="flex justify-between items-center p-6 bg-surface-container-low">
              <h2 id="modal-title" className="text-xl font-bold font-headline">{title}</h2>
              <button
                ref={closeButtonRef}
                onClick={onClose}
                className="p-2 hover:bg-surface-container-high rounded-full transition-colors"
                aria-label="Close dialog"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 max-h-[75vh] overflow-y-auto">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  // Render into a portal at document.body to escape stacking context issues
  return createPortal(content, document.body);
}
