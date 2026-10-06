import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import {
  type ButtonHTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  type Ref,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { useCloseRequest } from "../../hooks/useCloseRequest";
import { IconButton } from "./IconButton";
import { cn } from "../../lib/utils";

const SIZE_MAP = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
  xl: "sm:max-w-4xl",
  "2xl": "sm:max-w-5xl",
  full: "sm:max-w-[min(95vw,1280px)]",
};

/** A field a person types in: where focus goes when a dialog opens. */
const FIRST_FIELD = [
  'input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([tabindex="-1"]):not(:disabled)',
  "textarea:not(:disabled)",
  '[contenteditable="true"]',
].join(", ");

/** How many dialogs are open, for `useDialogOpen`. */
let openDialogs = 0;
const dialogListeners = new Set<() => void>();
const subscribeDialogs = (listener: () => void) => {
  dialogListeners.add(listener);
  return () => dialogListeners.delete(listener);
};
const countDialogs = (step: number) => {
  openDialogs += step;
  for (const listener of dialogListeners) listener();
};

/**
 * Whether any `Modal` is open. On a phone the app moves its toasts to the
 * top while one is: a toast at the foot covered a sheet's Save row.
 */
export function useDialogOpen(): boolean {
  return useSyncExternalStore(
    subscribeDialogs,
    () => openDialogs > 0,
    () => false,
  );
}

/**
 * A dialog's X: one look and one name in every dialog. `Modal` draws it in
 * its title bar, and a dialog with a header of its own (`ariaLabel`) puts
 * it at the end of that header.
 */
export const DialogCloseButton = ({
  ref,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  ref?: Ref<HTMLButtonElement>;
}) => (
  <IconButton
    ref={ref}
    aria-label="Close dialog"
    tone="subtle"
    {...props}
    className={cn("-mr-2 shrink-0", props.className)}
  >
    <X aria-hidden="true" className="w-5 h-5" />
  </IconButton>
);

/** A drag down this far, or this fast, closes the sheet. */
const CLOSE_DISTANCE = 96;
const CLOSE_SPEED = 0.6; // px per ms

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  /**
   * The accessible name of a dialog that renders its own header, and with it
   * its own close control.
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
 * A dialog with nested focus, scroll locking and keyboard dismissal. Below
 * `sm` it is a bottom sheet:
 * - it slides up and back down (`.sheet` in index.css)
 * - its grab handle and title bar drag down to close it
 * - Android's Back closes it, not the page under it (`useCloseRequest`)
 * - it stands on the on-screen keyboard (`--keyboard-inset`), so its last
 *   field and buttons stay in view
 */
export function Modal({
  isOpen,
  onClose,
  title: openTitle,
  ariaLabel = "Dialog",
  children: openChildren,
  size = "md",
  returnFocusRef,
}: ModalProps) {
  const previousFocus = useRef<HTMLElement | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; at: number; dy: number } | null>(null);

  useCloseRequest(isOpen, onClose);
  useEffect(() => {
    if (!isOpen) return;
    countDialogs(1);
    return () => countDialogs(-1);
  }, [isOpen]);

  // Where focus was before this opened, read during the render that opens
  // it, not in `onOpenAutoFocus`: a child's `autoFocus` moves focus in the
  // commit, before Radix's effect, and Radix then skips that event.
  const wasOpen = useRef(false);
  if (isOpen && !wasOpen.current) {
    previousFocus.current = document.activeElement as HTMLElement | null;
  }
  wasOpen.current = isOpen;

  // What the open dialog showed, kept through its exit animation, so a
  // caller may clear what the dialog names as it closes.
  const shown = useRef({ title: openTitle, children: openChildren });
  if (isOpen) shown.current = { title: openTitle, children: openChildren };
  const { title, children } = shown.current;

  // The drag follows the finger down only. On release it either closes the
  // sheet from where it is (the closing animation starts at `--sheet-drag`)
  // or springs it back.
  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse" || !content.current) return;
    // From `sm` it is a centered dialog, not a sheet, and does not drag.
    if (window.matchMedia?.("(min-width: 640px)").matches) return;
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
    // Centered from `sm`, it rises by half the keyboard, so a tablet's dialog
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
          // `outline-none`: a ring around the whole panel would say nothing.
          // The height leaves out the status bar's inset.
          className={`sheet fixed ${position} ${SIZE_MAP[size]} glass-panel shadow-2xl z-[201] flex flex-col max-h-[calc(100dvh-max(2rem,env(safe-area-inset-top)+0.5rem)-var(--keyboard-inset,0px)-var(--viewport-offset,0px))] overflow-hidden outline-none modal-fade`}
          onOpenAutoFocus={(event) => {
            // Never the X, which a typed space would press. With a keyboard
            // the first text field takes focus. On a touch screen the dialog
            // does, so the on-screen keyboard does not cover it.
            event.preventDefault();
            const field = window.matchMedia?.("(pointer: fine)").matches
              ? content.current?.querySelector<HTMLElement>(FIRST_FIELD)
              : null;
            (field ?? content.current)?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={(event) => {
            // Only take over when there is somewhere to put focus.
            const target = returnFocusRef?.current ?? previousFocus.current;
            if (!target?.isConnected) return;
            event.preventDefault();
            target.focus({ preventScroll: true });
          }}
        >
          {/* The grab handle. The title bar drags too. A keyboard closes
              with the X or Escape. */}
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
              <Dialog.Close asChild>
                <DialogCloseButton />
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
