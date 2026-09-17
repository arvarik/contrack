/**
 * VibePickerPopover: the contact colour picker.
 *
 * The colour is decoration, so it has no button of its own in the header.
 * The contact actions menu opens it with "Change colour", and it sits under
 * that menu's button.
 *
 * It behaves like the other radiogroups in the app (`Segmented`,
 * `AccentPicker`):
 *
 * 1. Only the checked swatch is a Tab stop. When the panel opens, focus goes
 *    to it.
 * 2. The arrow keys move to the next or previous swatch and choose it, so the
 *    page repaints in that colour as focus moves.
 * 3. Escape closes the panel and returns focus to the menu button. A click
 *    outside the panel closes it, and so does Tab out of it.
 *
 * Choosing a colour keeps the panel open, so a person can try a few colours
 * against the page before they settle on one.
 */
import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { Check } from "lucide-react";
import { motion } from "motion/react";
import { VIBES, vibeTokens } from "../../../lib/theme";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { useClickOutside } from "../../../hooks/useClickOutside";
import { cn } from "../../../lib/utils";
import { FIELD_LABEL } from "../../../lib/styles";

export interface VibePickerPopoverProps {
  open: boolean;
  onClose: () => void;
  /** The contact's stored colour id. An unknown id shows as the first vibe. */
  currentVibeId: string | null | undefined;
  onSelect: (id: string) => void;
  /** The control that opened the panel. Escape returns focus to it. */
  returnFocusTo?: React.RefObject<HTMLElement | null>;
}

export const VibePickerPopover = (props: VibePickerPopoverProps) =>
  // The panel mounts on open, so it starts from the stored colour each time.
  props.open ? <VibePickerPanel {...props} /> : null;

const VibePickerPanel = ({
  onClose,
  currentVibeId,
  onSelect,
  returnFocusTo,
}: VibePickerPopoverProps) => {
  const panel = useRef<HTMLDivElement>(null);
  const labelId = useId();
  // The swatch shows what the app will paint, which is not the same colour in
  // both palettes: a vibe is derived, not stored.
  const { mode } = usePreferences();

  // `vibeTokens` paints an unknown id as the first vibe, so the picker checks
  // that one too.
  const stored = VIBES.some((vibe) => vibe.id === currentVibeId)
    ? (currentVibeId as string)
    : VIBES[0].id;
  /**
   * The checked swatch, held here and not read from the contact.
   *
   * The save is not optimistic, so the contact keeps its old colour until
   * the server answers. Two quick arrow presses would both start from the
   * old colour and land on the same swatch.
   */
  const [selected, setSelected] = useState(stored);

  const close = useCallback(() => onClose(), [onClose]);
  useClickOutside(panel, close, true);

  // Opening puts focus on the checked swatch, which is the group's Tab stop.
  useEffect(() => {
    panel.current
      ?.querySelector<HTMLButtonElement>('[role="radio"][aria-checked="true"]')
      ?.focus({ preventScroll: true });
  }, []);

  const choose = (id: string) => {
    if (id === selected) return;
    setSelected(id);
    onSelect(id);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      // Handled: a page-level Escape (the contact over the map closes on
      // Escape) must not also run for this press.
      event.preventDefault();
      event.stopPropagation();
      onClose();
      returnFocusTo?.current?.focus();
      return;
    }
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = VIBES.findIndex((vibe) => vibe.id === selected);
    const nextIndex = (index + step + VIBES.length) % VIBES.length;
    choose(VIBES[nextIndex].id);
    // Focus follows the selection, so the next arrow continues from here.
    const swatches =
      panel.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    swatches?.[nextIndex]?.focus();
  };

  return (
    <motion.div
      ref={panel}
      // Scale only. The label is text, and text faded in from nothing is
      // below its contrast for as long as the fade lasts.
      initial={{ opacity: 1, scale: 0.95, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      role="radiogroup"
      aria-labelledby={labelId}
      onBlur={(event) => {
        // Tab out of the panel closes it. A click elsewhere has no related
        // target, and the click-outside handler closes the panel for that.
        const next = event.relatedTarget as Node | null;
        if (next && !panel.current?.contains(next)) onClose();
      }}
      // `w-max`: the wrapper it hangs from is only as wide as the menu
      // button, and without it the label wrapped and the swatches overlapped.
      className="absolute right-0 top-full mt-2 z-50 w-max glass-panel rounded-xl shadow-xl p-3 origin-top-right"
    >
      <p id={labelId} className={cn(FIELD_LABEL, "mb-2")}>
        Contact colour
      </p>
      {/* 36 px swatches with a 44 px tap box. The 8 px gap keeps the boxes
          from overlapping more than a few pixels. */}
      <div className="grid grid-cols-4 gap-2">
        {VIBES.map((vibe) => {
          const checked = vibe.id === selected;
          const tokens = vibeTokens(vibe.id, mode);
          return (
            <button
              key={vibe.id}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={vibe.label}
              tabIndex={checked ? 0 : -1}
              onKeyDown={onKeyDown}
              onClick={() => choose(vibe.id)}
              style={{ backgroundColor: tokens.primary }}
              className={cn(
                "hit-area w-9 h-9 rounded-full flex items-center justify-center shadow-sm transition-transform",
                "hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2",
                checked &&
                  "ring-2 ring-offset-2 ring-on-surface ring-offset-surface-container-lowest",
              )}
            >
              {/* The check says which one is chosen without relying on the
                  ring colour alone. */}
              {checked && (
                <Check
                  aria-hidden="true"
                  className="w-3.5 h-3.5"
                  style={{ color: tokens["on-primary"] }}
                />
              )}
            </button>
          );
        })}
      </div>
    </motion.div>
  );
};
