/**
 * ShortcutKeys: the keys of one shortcut, as keycaps.
 *
 * The shortcuts dialog and the Keyboard settings page drew the same caps
 * with two copies of the same markup. One component draws them now:
 *
 * 1. Keys with a modifier are one combination, pressed together. Their caps
 *    sit side by side, the way a menu prints ⌘ K.
 * 2. Keys without one are alternatives, and "or" sits between them and is
 *    read out, because "right arrow L" does not say which it is.
 *
 * @module components/ui/ShortcutKeys
 */
import React from "react";
import { isCombination } from "../../lib/shortcuts";

/** One key, as a keycap: 22 px tall, 11 px bold mono, a 1 px edge under it. */
export const Keycap = ({ children }: { children: React.ReactNode }) => (
  <kbd className="inline-flex items-center justify-center min-w-[24px] h-[22px] px-1.5 bg-surface-container-high rounded-md text-[11px] font-mono font-bold text-on-surface shadow-[0_1px_0_0_rgba(0,0,0,0.12)]">
    {children}
  </kbd>
);

export const ShortcutKeys = ({ keys }: { keys: readonly string[] }) => {
  const together = isCombination(keys);
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((key, index) => (
        <React.Fragment key={key}>
          {index > 0 && !together && (
            <span className="text-[11px] text-on-surface-variant mx-0.5">
              or
            </span>
          )}
          <Keycap>{key}</Keycap>
        </React.Fragment>
      ))}
    </span>
  );
};
