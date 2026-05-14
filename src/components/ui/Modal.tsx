/**
 * Modal — Accessible, animated overlay dialog with responsive presentation.
 *
 * Accessibility:
 *  - Saves `document.activeElement` before opening; restores it on close
 *  - Auto-focuses the close button on open (acts as initial focus anchor)
 *  - Traps full Tab/Shift+Tab focus cycling within the dialog
 *  - Respects `prefers-reduced-motion` by falling back to opacity-only transitions
 *
 * Rendering:
 *  - Uses a React portal to escape parent stacking contexts
 *  - Two presentations driven by viewport width:
 *      • Desktop (≥ sm, 640px+): centered card with backdrop blur + scale entrance
 *      • Mobile  (< sm):         bottom sheet that slides up from the bottom edge
 *    The switch happens via Tailwind responsive classes alone — there is no
 *    JS media query, so the choice updates correctly on rotation/resize.
 *
 * Two content modes:
 *  1. **Standard** (`title` provided): renders a header bar with title + close
 *     button; body area scrolls within the dialog.
 *  2. **Headless** (`title` omitted): children fill the entire modal — useful
 *     for modals with custom headers (dashboard drilldowns, detail views).
 *
 * Sizes (desktop only — mobile bottom sheet always uses full width):
 *  sm (max-w-sm), md (max-w-lg, default), lg (max-w-2xl), xl (max-w-4xl),
 *  2xl (max-w-5xl), full (max-w-[min(95vw,1280px)])
 */
import { motion, AnimatePresence } from "motion/react";
import { X } from "lucide-react";
import { ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../../hooks/useFocusTrap";

const SIZE_MAP: Record<string, string> = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
  xl: "sm:max-w-4xl",
  "2xl": "sm:max-w-5xl",
  full: "sm:max-w-[min(95vw,1280px)]",
};

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** When provided, renders a standard header bar. Omit for headless mode. */
  title?: string;
  children: ReactNode;
  /** Controls desktop max-width. Default: `md` (max-w-lg). Mobile is always full width. */
  size?: keyof typeof SIZE_MAP;
  /**
   * Disable the responsive bottom-sheet on mobile. Use this only for very small
   * modals (e.g. confirmations) where a centered dialog still works on phones.
   */
  disableMobileSheet?: boolean;
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = "md",
  disableMobileSheet = false,
}: ModalProps) {
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
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
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

  // Layout classes for the dialog container.
  //
  // Desktop (sm:): centered card, capped width, rounded on all sides, modest
  // top offset (sm:top-1/2 + transform centers it vertically).
  //
  // Mobile (default, < sm): full-width sheet anchored to the bottom edge,
  // rounded only on top. We use `inset-x-0 bottom-0` to pin the sheet, then
  // `sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2`
  // to re-center on desktop. Without `disableMobileSheet`, this is the
  // recommended pattern for every modal that contains substantial content.
  const positionClasses = disableMobileSheet
    ? "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full mx-4"
    : "fixed inset-x-0 bottom-0 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-full";

  const radiusClasses = disableMobileSheet
    ? "rounded-2xl"
    : "rounded-t-2xl sm:rounded-2xl";

  // Mobile sheet slides up; desktop scales in. Both share an opacity fade.
  // Reduced-motion users get an instant opacity-only transition.
  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const enterAnim = reducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : disableMobileSheet
      ? {
          initial: { opacity: 0, scale: 0.95, y: 20 },
          animate: { opacity: 1, scale: 1, y: 0 },
          exit: { opacity: 0, scale: 0.95, y: 20 },
        }
      : {
          // On mobile this reads as "slide up from bottom"; on desktop the
          // y: 20 + scale: 0.95 still produces a tasteful settle-in. The
          // CSS transforms in `positionClasses` keep the dialog centered on
          // desktop regardless of the animation's residual `y`.
          initial: { opacity: 0, y: 60 },
          animate: { opacity: 1, y: 0 },
          exit: { opacity: 0, y: 60 },
        };

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
            {...enterAnim}
            transition={{ type: "spring", bounce: 0, duration: 0.28 }}
            className={`${positionClasses} ${widthClass} glass-panel ${radiusClasses} shadow-2xl z-[201] overflow-hidden`}
            ref={modalContainerRef}
          >
            {/* Drag indicator — visual cue that the sheet is dismissible by
                swipe-down (purely visual; swipe gesture isn't wired up yet). */}
            {!disableMobileSheet && (
              <div className="sm:hidden flex justify-center pt-2 pb-1">
                <div className="w-9 h-1 rounded-full bg-on-surface/15" />
              </div>
            )}

            {/* Standard header — only rendered when `title` is provided */}
            {title ? (
              <>
                <div className="flex justify-between items-center px-5 py-4 sm:p-6 bg-surface-container-low">
                  <h2
                    id={titleId}
                    className="text-lg sm:text-xl font-bold font-headline"
                  >
                    {title}
                  </h2>
                  <button
                    ref={closeButtonRef}
                    onClick={onClose}
                    className="-mr-2 inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-full hover:bg-surface-container-high active:bg-surface-container-highest transition-colors"
                    aria-label="Close dialog"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="p-5 sm:p-6 max-h-[70vh] sm:max-h-[75vh] overflow-y-auto pb-[env(safe-area-inset-bottom)]">
                  {children}
                </div>
              </>
            ) : (
              /* Headless mode — children fill entire modal */
              <>
                <button
                  ref={closeButtonRef}
                  onClick={onClose}
                  className="sr-only"
                  aria-label="Close dialog"
                />
                <div className="max-h-[85vh] overflow-y-auto flex flex-col pb-[env(safe-area-inset-bottom)]">
                  {children}
                </div>
              </>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  return createPortal(content, document.body);
}
