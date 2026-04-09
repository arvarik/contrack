/**
 * Modal — Accessible, animated overlay dialog.
 *
 * Accessibility:
 *  - Saves `document.activeElement` before opening; restores it on close
 *  - Auto-focuses the close button on open (acts as initial focus anchor)
 *  - Traps full Tab/Shift+Tab focus cycling within the dialog
 *
 * Rendering:
 *  - Uses a React portal to escape parent stacking contexts
 *  - Backdrop blur + scale entrance animation
 *
 * Two rendering modes:
 *  1. **Standard** (`title` provided): Renders a header bar with title + close button, body scrolls.
 *  2. **Headless** (`title` omitted): Children fill the entire modal — useful for modals
 *     with custom headers (dashboard drilldowns, detail views, etc.).
 *
 * Sizes:
 *  - `sm` (max-w-sm), `md` (max-w-lg, default), `lg` (max-w-2xl), `xl` (max-w-4xl),
 *    `2xl` (max-w-5xl), `full` (max-w-[min(95vw,1280px)])
 */
import { motion, AnimatePresence } from "motion/react";
import { X } from "lucide-react";
import { ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../../hooks/useFocusTrap";

const SIZE_MAP: Record<string, string> = {
  sm:   "max-w-sm",
  md:   "max-w-lg",
  lg:   "max-w-2xl",
  xl:   "max-w-4xl",
  "2xl": "max-w-5xl",
  full: "max-w-[min(95vw,1280px)]",
};

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** When provided, renders a standard header bar. Omit for headless mode. */
  title?: string;
  children: ReactNode;
  /** Controls max-width. Default: `md` (max-w-lg). */
  size?: keyof typeof SIZE_MAP;
}

export function Modal({ isOpen, onClose, title, children, size = "md" }: ModalProps) {
  // Remember what had focus before the modal opened
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const modalContainerRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Trap Tab/Shift+Tab within the modal
  useFocusTrap(modalContainerRef, isOpen);

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

  // Lock body scroll while modal is open
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isOpen]);

  // Escape key closes
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isOpen && e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const widthClass = SIZE_MAP[size] || SIZE_MAP.md;

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
            aria-labelledby={title ? titleId : undefined}
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className={`fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full ${widthClass} glass-panel rounded-2xl shadow-2xl z-[201] overflow-hidden`}
            ref={modalContainerRef}
          >
            {/* Standard header — only rendered when `title` is provided */}
            {title ? (
              <>
                <div className="flex justify-between items-center p-6 bg-surface-container-low">
                  <h2 id={titleId} className="text-xl font-bold font-headline">{title}</h2>
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
              </>
            ) : (
              /* Headless mode — children fill entire modal */
              <>
                {/* Invisible close button stays focusable for a11y but is visually hidden
                    — the consumer is expected to render their own visible close button. */}
                <button
                  ref={closeButtonRef}
                  onClick={onClose}
                  className="sr-only"
                  aria-label="Close dialog"
                />
                <div className="max-h-[85vh] overflow-y-auto flex flex-col">
                  {children}
                </div>
              </>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  // Render into a portal at document.body to escape stacking context issues
  return createPortal(content, document.body);
}
