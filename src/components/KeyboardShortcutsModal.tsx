/**
 * KeyboardShortcutsModal — Global `?` key overlay showing all keyboard shortcuts.
 *
 * Mounted once in App.tsx, which listens for `?` globally (ignoring inputs
 * and textareas). Categorised by context: Navigation, Global, Network,
 * Dedupe Engine.
 *
 * Built on the shared `Modal` primitive. It used to be a hand-rolled overlay:
 * two motion divs, a window keydown for Escape, and nothing else. That gave a
 * keyboard user a panel with no `role="dialog"`, no focus trap, and no way
 * back to where they were when it closed — in the one dialog whose entire
 * purpose is to help keyboard users. The primitive supplies all three.
 */
import React from "react";
import { Modal } from "./ui/Modal";

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
      { keys: ["⌘", "⇧", "H"], description: "Go to Network" },
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

export const KeyboardShortcutsModal = ({ isOpen, onClose }: Props) => (
  <Modal isOpen={isOpen} onClose={onClose} title="Keyboard Shortcuts" size="sm">
    {/*
      A tab stop of its own. The list is longer than a short viewport and
      holds nothing interactive, so without one the scrolling region would
      be reachable by pointer only (WCAG 2.1.1). Focus here, and the arrow
      keys scroll it.
    */}
    <div
      role="region"
      aria-label="Shortcut list"
      tabIndex={0}
      className="space-y-5 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {SHORTCUT_GROUPS.map((group) => (
        <section key={group.context} aria-label={group.context}>
          <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2.5">
            {group.context}
          </p>
          <dl className="space-y-1">
            {group.shortcuts.map((s) => (
              <div
                key={s.description}
                className="flex items-center justify-between gap-3 py-1.5 px-3 rounded-xl hover:bg-surface-container-low transition-colors"
              >
                <dt className="text-sm text-on-surface">{s.description}</dt>
                <dd className="flex items-center gap-1">
                  {s.keys.map((k, i) => (
                    <React.Fragment key={i}>
                      <Kbd>{k}</Kbd>
                      {i < s.keys.length - 1 && (
                        <span
                          className="text-[10px] text-on-surface-variant mx-0.5"
                          aria-hidden="true"
                        >
                          +
                        </span>
                      )}
                    </React.Fragment>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}

      {/* Footer hint */}
      <p className="text-center text-[11px] text-on-surface-variant pt-1">
        Press <Kbd>?</Kbd> anytime to open this
      </p>
    </div>
  </Modal>
);
