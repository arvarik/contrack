import React, { useEffect } from "react";
import { Palette } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { VIBES, vibeTokens } from "../../../lib/theme";
import { usePreferences } from "../../../contexts/PreferencesContext";

export const VibePickerPopover = ({
  showVibePicker,
  setShowVibePicker,
  currentVibeId,
  onSelect,
}: {
  showVibePicker: boolean;
  setShowVibePicker: (v: boolean) => void;
  currentVibeId: string;
  onSelect: (id: string) => void;
}) => {
  const ref = React.useRef<HTMLDivElement>(null);
  // The swatch shows what the app will paint, which is not the same colour in
  // both palettes: a vibe is derived, not stored.
  const { mode } = usePreferences();

  useEffect(() => {
    if (!showVibePicker) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setShowVibePicker(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showVibePicker, setShowVibePicker]);

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={() => setShowVibePicker(!showVibePicker)}
        className={`p-2 rounded-xl transition-all ${showVibePicker ? "bg-primary/20 text-primary" : "text-on-surface-variant hover:bg-surface-container hover:text-primary"}`}
        title="Change Theme Vibe"
        aria-label="Change theme color"
        aria-pressed={showVibePicker}
      >
        <Palette className="w-5 h-5" />
      </button>

      <AnimatePresence>
        {showVibePicker && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 10 }}
            className="absolute top-12 left-1/2 -translate-x-1/2 md:left-auto md:right-0 md:translate-x-0 glass-panel rounded-xl shadow-xl p-3 z-50 grid grid-cols-5 gap-2 w-[180px] place-items-center"
            role="radiogroup"
            aria-label="Theme color options"
          >
            {VIBES.map((vibe) => (
              <button
                key={vibe.id}
                onClick={() => onSelect(vibe.id)}
                style={{ backgroundColor: vibeTokens(vibe.id, mode).primary }}
                className={`w-7 h-7 rounded-full transition-transform hover:scale-110 shadow-sm ${currentVibeId === vibe.id ? "ring-2 ring-primary ring-offset-2 ring-offset-surface-container-lowest scale-110" : "hover:ring-2 hover:ring-on-surface-variant hover:ring-offset-2 hover:ring-offset-surface-container-lowest"}`}
                aria-label={`Set theme to ${vibe.label}`}
                role="radio"
                aria-checked={currentVibeId === vibe.id}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
