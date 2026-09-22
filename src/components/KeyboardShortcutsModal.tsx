/**
 * KeyboardShortcutsModal — Global `?` key overlay showing all keyboard shortcuts.
 *
 * Mounted once in App.tsx, which listens for `?` globally (ignoring inputs
 * and textareas). The shortcuts come from `lib/shortcuts`, the one table
 * every plan registers its keys in, grouped as Navigation, Global, Network
 * and Duplicates.
 *
 * Built on the shared `Modal` primitive. It used to be a hand-rolled overlay:
 * two motion divs, a window keydown for Escape, and nothing else. That gave a
 * keyboard user a panel with no `role="dialog"`, no focus trap, and no way
 * back to where they were when it closed — in the one dialog whose entire
 * purpose is to help keyboard users. The primitive supplies all three.
 */
import React from "react";
import { groupedShortcuts, isCombination } from "../lib/shortcuts";
import { LABEL } from "../lib/styles";
import { cn } from "../lib/utils";
import { Modal } from "./ui/Modal";

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
  <Modal isOpen={isOpen} onClose={onClose} title="Keyboard shortcuts" size="sm">
    {/*
      A tab stop of its own. The list is longer than a short viewport and
      holds nothing interactive, so without one the scrolling region would
      be reachable by pointer only (WCAG 2.1.1). Focus here, and the arrow
      keys scroll it. The base layer draws its focus ring.
    */}
    <div
      role="region"
      aria-label="Shortcut list"
      tabIndex={0}
      className="space-y-5 rounded-xl"
    >
      {groupedShortcuts().map((group) => (
        <section key={group.group} aria-label={group.group}>
          <p className={cn(LABEL, "mb-2.5")}>{group.group}</p>
          <dl className="space-y-1">
            {/* A row is a fact, not a control, so it has no hover. */}
            {group.shortcuts.map((s) => (
              <div
                key={s.keys.join("+")}
                className="flex items-center justify-between gap-3 py-1.5 px-3 rounded-xl"
              >
                <dt className="text-sm text-on-surface">{s.description}</dt>
                <dd className="flex items-center gap-1">
                  {s.keys.map((k, i) => (
                    <React.Fragment key={i}>
                      <Kbd>{k}</Kbd>
                      {/*
                        Keys with a modifier are pressed together. Keys
                        without one are alternatives, and "or" is read out,
                        because "right arrow L" does not say which it is.
                      */}
                      {i < s.keys.length - 1 &&
                        (isCombination(s.keys) ? (
                          <span
                            className="text-[11px] text-on-surface-variant mx-0.5"
                            aria-hidden="true"
                          >
                            +
                          </span>
                        ) : (
                          <span className="text-[11px] text-on-surface-variant mx-0.5">
                            or
                          </span>
                        ))}
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
