/**
 * A settings page's buttons, portaled to the right edge of the shell's
 * header, because the shell (not the page) draws the header. A page claims
 * the slot in a layout effect, before paint, and the shell draws the slot
 * only then, so a page with no actions has no empty box.
 */
import React, { createContext, useContext, useLayoutEffect } from "react";
import { createPortal } from "react-dom";

interface SettingsHeaderSlot {
  /** The element the actions render into, once the header has drawn it. */
  target: HTMLElement | null;
  /** Says a page has actions. Returns the function that takes it back. */
  claim: () => () => void;
}

export const SettingsHeaderContext = createContext<SettingsHeaderSlot | null>(
  null,
);

/** Outside the shell (a unit test of one page) the actions render in place. */
export const SettingsHeaderActions = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const slot = useContext(SettingsHeaderContext);
  const claim = slot?.claim;
  useLayoutEffect(() => claim?.(), [claim]);
  if (!slot) return <>{children}</>;
  return slot.target ? createPortal(children, slot.target) : null;
};
