import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { type ReactNode, type RefObject, useRef } from "react";

const SIZE_MAP = {
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
  disableMobileSheet?: boolean;
  /**
   * Where focus goes on close, when it is not wherever it was on open: the
   * control that opened the dialog. Safari does not focus a clicked button,
   * so "wherever it was" can be a field the person never meant to return to.
   */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

/** Responsive dialog with nested focus, scroll locking, and keyboard dismissal. */
export function Modal({
  isOpen,
  onClose,
  title,
  ariaLabel = "Dialog",
  children,
  size = "md",
  disableMobileSheet = false,
  returnFocusRef,
}: ModalProps) {
  const previousFocus = useRef<HTMLElement | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);

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
  const position = disableMobileSheet
    ? "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] rounded-3xl"
    : "inset-x-0 bottom-0 rounded-t-3xl sm:rounded-3xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-[calc(100%-2rem)]";
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
          className={`fixed ${position} ${SIZE_MAP[size]} glass-panel shadow-2xl z-[201] flex flex-col max-h-[calc(100dvh-2rem)] overflow-hidden outline-none modal-fade`}
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
          {title ? (
            <div className="shrink-0 flex justify-between items-center px-5 py-4 sm:p-6 bg-surface-container-low">
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
