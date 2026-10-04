import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  useRef,
} from "react";
import { useCloseRequest } from "../../hooks/useCloseRequest";

const SIZE_MAP = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
  xl: "sm:max-w-4xl",
  "2xl": "sm:max-w-5xl",
  full: "sm:max-w-[min(95vw,1280px)]",
};

/** A drag down this far, or this fast, closes the sheet. */
const CLOSE_DISTANCE = 96;
const CLOSE_SPEED = 0.6; // px per ms

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  /**
   * Accessible name for dialogs that render their own header. Such a dialog
   * draws its own close control (an X, a Cancel button): the dialog has none
   * to add. A hidden one used to take focus on open and appear as a box over
   * the header's corner.
   */
  ariaLabel?: string;
  children: ReactNode;
  size?: keyof typeof SIZE_MAP;
  /**
   * Where focus goes on close, when it is not wherever it was on open: the
   * control that opened the dialog. Safari does not focus a clicked button,
   * so "wherever it was" can be a field the person never meant to return to.
   */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * Responsive dialog with nested focus, scroll locking, and keyboard dismissal.
 *
 * Below `sm` it is a sheet from the bottom of the screen, as phones draw
 * one:
 * - it slides up and back down (`.sheet` in index.css);
 * - its grab handle, and its title bar, drag down to close it;
 * - Android's Back closes it, rather than leaving the page under it
 *   (`useCloseRequest`);
 * - it stands on top of the on-screen keyboard (`--keyboard-inset`, from
 *   `useSoftKeyboard`), so its last field and its buttons stay in view.
 */
export function Modal({
  isOpen,
  onClose,
  title,
  ariaLabel = "Dialog",
  children,
  size = "md",
  returnFocusRef,
}: ModalProps) {
  const previousFocus = useRef<HTMLElement | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; at: number; dy: number } | null>(null);

  useCloseRequest(isOpen, onClose);

  // Where focus was before this opened, captured during the render that opens
  // it rather than in `onOpenAutoFocus`.
  //
  // Radix only fires that event when nothing inside the dialog already holds
  // focus, and React applies a child's `autoFocus` during commit — before
  // Radix's effect runs. So every dialog with an autofocused field skipped
  // the capture entirely, `previousFocus` stayed null, and closing dropped
  // focus onto <body>: the keyboard user's place in the page was gone.
  // Reading `document.activeElement` here happens before the commit that
  // moves focus, which is the only moment the answer is still correct.
  const wasOpen = useRef(false);
  if (isOpen && !wasOpen.current) {
    previousFocus.current = document.activeElement as HTMLElement | null;
  }
  wasOpen.current = isOpen;

  // The drag follows the finger down only. On release it either closes the
  // sheet from where it is (the closing animation starts at `--sheet-drag`)
  // or springs it back.
  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse" || !content.current) return;
    if ((event.target as HTMLElement).closest("button, a, input")) return;
    drag.current = { y: event.clientY, at: event.timeStamp, dy: 0 };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that ended already: the drag follows the element anyway.
    }
    content.current.style.transition = "none";
  };
  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current || !content.current) return;
    drag.current.dy = Math.max(0, event.clientY - drag.current.y);
    content.current.style.transform = `translateY(${drag.current.dy}px)`;
  };
  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const sheet = content.current;
    const state = drag.current;
    drag.current = null;
    if (!state || !sheet) return;
    const speed = state.dy / Math.max(1, event.timeStamp - state.at);
    sheet.style.transition = "";
    if (state.dy > CLOSE_DISTANCE || speed > CLOSE_SPEED) {
      sheet.style.setProperty("--sheet-drag", `${state.dy}px`);
      onClose();
      // A dialog that refused to close, such as one with unsaved work,
      // springs back rather than staying where the finger left it.
      requestAnimationFrame(() => {
        if (sheet.isConnected && sheet.dataset.state === "open") {
          sheet.style.transform = "";
          sheet.style.removeProperty("--sheet-drag");
        }
      });
    } else {
      sheet.style.transform = "";
    }
  };
  const dragHandlers = {
    onPointerDown: startDrag,
    onPointerMove: moveDrag,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  };

  const position =
    // Centred from `sm`, it rises by half the keyboard, so a tablet's dialog
    // keeps its buttons above the keyboard too.
    "inset-x-0 bottom-[var(--keyboard-inset,0px)] rounded-t-3xl sm:rounded-3xl sm:inset-auto sm:left-1/2 sm:top-[calc(50%-var(--keyboard-inset,0px)/2)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-[calc(100%-2rem)]";
  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-on-surface/20 backdrop-blur-sm z-[200] modal-fade" />
        <Dialog.Content
          ref={content}
          // A dialog without a title takes focus on itself, so a screen
          // reader hears its name and the first Tab reaches its first control.
          tabIndex={-1}
          aria-describedby={undefined}
          // `outline-none`: the dialog itself takes focus when it has no
          // title, and a ring around the whole panel would say nothing.
          className={`sheet fixed ${position} ${SIZE_MAP[size]} glass-panel shadow-2xl z-[201] flex flex-col max-h-[calc(100dvh-2rem-var(--keyboard-inset,0px)-var(--viewport-offset,0px))] overflow-hidden outline-none modal-fade`}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (closeButton.current ?? content.current)?.focus({
              preventScroll: true,
            });
          }}
          onCloseAutoFocus={(event) => {
            // Only take over when there is somewhere to put focus. Preventing
            // the default and then restoring nothing leaves it on <body>,
            // which is worse than whatever Radix would have done.
            const target = returnFocusRef?.current ?? previousFocus.current;
            if (!target?.isConnected) return;
            event.preventDefault();
            target.focus({ preventScroll: true });
          }}
        >
          {/* The grab handle: a phone's sign that the sheet drags. The
              title bar drags too. The X and Escape stay the ways a keyboard
              or a screen reader closes it. */}
          <div
            aria-hidden="true"
            className={`sm:hidden shrink-0 flex justify-center pt-2 pb-1 touch-none ${title ? "bg-surface-container-low" : ""}`}
            {...dragHandlers}
          >
            <span className="h-1 w-9 rounded-full bg-on-surface-variant/30" />
          </div>
          {title ? (
            <div
              className="shrink-0 flex justify-between items-center px-5 pb-4 pt-2 sm:p-6 bg-surface-container-low touch-none sm:touch-auto"
              {...dragHandlers}
            >
              <Dialog.Title className="text-lg sm:text-xl font-bold font-headline">
                {title}
              </Dialog.Title>
              <Dialog.Close
                ref={closeButton}
                className="state-layer -mr-2 inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg transition-colors"
                aria-label="Close dialog"
              >
                <X className="w-5 h-5" />
              </Dialog.Close>
            </div>
          ) : (
            <Dialog.Title className="sr-only">{ariaLabel}</Dialog.Title>
          )}
          <div
            className={`min-h-0 overflow-y-auto overscroll-contain pb-[max(1.25rem,env(safe-area-inset-bottom))] ${title ? "p-5 sm:p-6" : "flex flex-col"}`}
          >
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
