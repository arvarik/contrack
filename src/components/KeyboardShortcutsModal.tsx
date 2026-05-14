/**
 * KeyboardShortcutsModal — Global `?` key overlay showing all keyboard shortcuts.
 *
 * Mounted once in App.tsx. Listens for `?` globally (ignoring inputs/textareas).
 * Categorised by context: Network, Contact Detail, Dedupe Engine, Global.
 */
import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { X, Keyboard } from "lucide-react";

interface Shortcut {
  keys: string[];
  description: string;
}

interface ShortcutGroup {
  context: string;
  shortcuts: Shortcut[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    context: "Navigation",
    shortcuts: [
      { keys: ["⌘", "⇧", "N"], description: "Go to Network" },
      { keys: ["⌘", "⇧", "P"], description: "Go to Pulse" },
      { keys: ["⌘", "⇧", "M"], description: "Go to Map" },
      { keys: ["⌘", "⇧", "S"], description: "Go to AI Search" },
      { keys: ["⌘", "⇧", ","], description: "Go to Settings" },
      { keys: ["⌘", "["], description: "Back" },
      { keys: ["⌘", "]"], description: "Forward" },
    ],
  },
  {
    context: "Global",
    shortcuts: [
      { keys: ["?"], description: "Show keyboard shortcuts" },
      { keys: ["⌘", "K"], description: "Open command palette" },
      { keys: ["⌘", "⇧", "I"], description: "Quick interaction" },
    ],
  },
  {
    context: "Network — Contact List",
    shortcuts: [
      { keys: ["/"], description: "Focus search" },
      { keys: ["N"], description: "New contact" },
      { keys: ["V"], description: "Smart paste (AI parse)" },
      { keys: ["Esc"], description: "Exit selection mode" },
    ],
  },
  {
    context: "Dedupe Engine",
    shortcuts: [
      { keys: ["→", "L"], description: "Merge into primary" },
      { keys: ["←", "H"], description: "Keep separate (skip)" },
      { keys: ["↓", "J"], description: "Next suggestion" },
      { keys: ["↑", "K"], description: "Previous suggestion" },
      { keys: ["⌘", "Z"], description: "Undo last dismiss" },
    ],
  },
];

const Kbd = ({ children }: { children: React.ReactNode }) => (
  <kbd className="inline-flex items-center justify-center min-w-[26px] h-[22px] px-1.5 bg-surface-container-high rounded-md text-[11px] font-mono font-bold text-on-surface shadow-[0_1px_0_0_rgba(0,0,0,0.12)] border border-black/8">
    {children}
  </kbd>
);

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const KeyboardShortcutsModal = ({ isOpen, onClose }: Props) => {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
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
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md glass-panel rounded-2xl shadow-2xl z-[201] overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 bg-surface-container-low">
              <div className="flex items-center gap-2.5">
                <Keyboard className="w-4 h-4 text-primary" />
                <h2 className="font-headline font-bold text-base">
                  Keyboard Shortcuts
                </h2>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 hover:bg-surface-container-high rounded-lg transition-colors text-on-surface-variant hover:text-on-surface"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Groups */}
            <div className="p-5 space-y-5 max-h-[65vh] overflow-y-auto nice-scrollbar">
              {SHORTCUT_GROUPS.map((group) => (
                <div key={group.context}>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2.5">
                    {group.context}
                  </p>
                  <div className="space-y-1">
                    {group.shortcuts.map((s) => (
                      <div
                        key={s.description}
                        className="flex items-center justify-between py-1.5 px-3 rounded-xl hover:bg-surface-container-low transition-colors"
                      >
                        <span className="text-sm text-on-surface">
                          {s.description}
                        </span>
                        <div className="flex items-center gap-1">
                          {s.keys.map((k, i) => (
                            <React.Fragment key={i}>
                              <Kbd>{k}</Kbd>
                              {i < s.keys.length - 1 && (
                                <span className="text-[10px] text-on-surface-variant/50 mx-0.5">
                                  +
                                </span>
                              )}
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* Footer hint */}
              <p className="text-center text-[11px] text-on-surface-variant/50 pt-1">
                Press <Kbd>?</Kbd> anytime to open this
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  return createPortal(content, document.body);
};
