/**
 * A settings page's controls, in the shell's header.
 *
 * The shell draws every settings page's header (`PageHeader`), so a page
 * cannot hand its buttons to it as a prop. A page puts them in
 * `SettingsHeaderActions` instead, and they render at the header's right
 * edge through a portal, the place every other page in the app keeps its
 * actions: Accounts' Invite and Create account, Backups' Snapshot now.
 *
 * The page tells the shell it has actions before the browser paints (a
 * layout effect), and the shell draws the slot only then, so a page with no
 * actions has no empty box in its header.
 *
 * @module views/settings/SettingsHeader
 */
import React, { createContext, useContext, useLayoutEffect } from "react";
import { createPortal } from "react-dom";

export interface SettingsHeaderSlot {
  /** The element the actions render into, once the header has drawn it. */
  target: HTMLElement | null;
  /** Says a page has actions. Returns the function that takes it back. */
  claim: () => () => void;
}

export const SettingsHeaderContext = createContext<SettingsHeaderSlot | null>(
  null,
);

/**
 * The page's actions, drawn in the header. Outside the shell (a unit test
 * that renders one page) they render where they stand.
 */
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
