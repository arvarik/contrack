import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { type ReactNode, useRef } from "react";

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
  /** Accessible name for dialogs that render their own header. */
  ariaLabel?: string;
  children: ReactNode;
  size?: keyof typeof SIZE_MAP;
  disableMobileSheet?: boolean;
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
}: ModalProps) {
  const previousFocus = useRef<HTMLElement | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const position = disableMobileSheet
    ? "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] rounded-2xl"
    : "inset-x-0 bottom-0 rounded-t-2xl sm:rounded-2xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-[calc(100%-2rem)]";
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
          aria-describedby={undefined}
          className={`fixed ${position} ${SIZE_MAP[size]} glass-panel shadow-2xl z-[201] flex flex-col max-h-[calc(100dvh-2rem)] overflow-hidden modal-fade`}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            previousFocus.current = document.activeElement as HTMLElement;
            closeButton.current?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (previousFocus.current?.isConnected)
              previousFocus.current.focus({ preventScroll: true });
          }}
        >
          {title ? (
            <div className="shrink-0 flex justify-between items-center px-5 py-4 sm:p-6 bg-surface-container-low">
              <Dialog.Title className="text-lg sm:text-xl font-bold font-headline">
                {title}
              </Dialog.Title>
              <Dialog.Close
                ref={closeButton}
                className="-mr-2 inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-full hover:bg-surface-container-high transition-colors"
                aria-label="Close dialog"
              >
                <X className="w-5 h-5" />
              </Dialog.Close>
            </div>
          ) : (
            <>
              <Dialog.Title className="sr-only">{ariaLabel}</Dialog.Title>
              <Dialog.Close
                ref={closeButton}
                aria-label="Close dialog"
                className="sr-only focus:not-sr-only focus:absolute focus:right-3 focus:top-3 focus:z-10 focus:p-3 focus:bg-surface"
              >
                Close
              </Dialog.Close>
            </>
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
