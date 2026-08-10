/**
 * InfoTip — a small "what is this?" affordance that works with a finger.
 *
 * Deliberately not a hover tooltip. Hover does not exist on a phone, and the
 * native `title` attribute is unreachable there too, so anything explained
 * that way is explained only to people on a desktop. This is a button: it
 * opens on click or tap, on Enter or Space, and shows on hover as a bonus for
 * pointer users who expect that.
 *
 * @module components/ui/InfoTip
 */
import React, { useEffect, useId, useRef, useState } from "react";
import { HelpCircle } from "lucide-react";
import { cn } from "../../lib/utils";

export const InfoTip = ({
  label,
  children,
  className,
}: {
  /** Accessible name for the trigger, e.g. "About the Briefing cache". */
  label: string;
  /** The explanation. Keep it to a sentence or two. */
  children: React.ReactNode;
  className?: string;
}) => {
  const [open, setOpen] = useState(false);
  /** Above or below, chosen from the space actually available. */
  const [above, setAbove] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const reveal = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setAbove(window.innerHeight - rect.bottom < 140);
    setOpen(true);
  };

  return (
    <span
      ref={wrapperRef}
      className={cn("relative inline-flex align-middle", className)}
      onMouseEnter={reveal}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? setOpen(false) : reveal())}
        onFocus={reveal}
        onBlur={() => setOpen(false)}
        className={cn(
          "inline-flex items-center justify-center rounded-full",
          "text-on-surface-variant hover:text-on-surface transition-colors",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        )}
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>

      {open && (
        <span
          id={panelId}
          role="tooltip"
          className={cn(
            "absolute z-50 left-0 w-56 max-w-[calc(100vw-2rem)]",
            above ? "bottom-full mb-2" : "top-full mt-2",
            "bg-surface-container-highest text-on-surface",
            "rounded-xl shadow-xl ring-1 ring-black/5 px-3 py-2",
            "text-[11px] leading-relaxed font-medium normal-case tracking-normal text-left text-pretty",
          )}
        >
          {children}
        </span>
      )}
    </span>
  );
};
