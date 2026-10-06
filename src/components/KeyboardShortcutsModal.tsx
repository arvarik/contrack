/**
 * The shortcuts for the page it opens on, from `lib/shortcuts`. App.tsx opens
 * it on `?` (outside a field) and from the sidebar's keyboard button.
 *
 * ```
 * ┌ Keyboard shortcuts ─────────────────────────────────────── ✕ ┐
 * │ Press ? to open this anywhere               All shortcuts →   │
 * │                                                               │
 * │ NAVIGATION                     │ MAP                          │
 * │ Go to Network        ⌘ ⇧ H     │ Focus search              /  │
 * │ …                              │ Fit all in view           F  │
 * │ GLOBAL                         │ …                            │
 * │ Open command palette   ⌘ K     │                              │
 * └───────────────────────────────────────────────────────────────┘
 * ```
 *
 * 1. The left column is the shortcuts that work everywhere
 *    (`COMMON_GROUPS`), the same on every page.
 * 2. The right column is the page's own (`pageShortcutGroups`): Pulse's
 *    queue keys on Pulse, the contact's and the list's on a contact. A page
 *    with none says so in one line.
 * 3. With single-key shortcuts off, those letters are dimmed, and the footer
 *    says how to turn them back on.
 * 4. The line above the columns links to Settings → Keyboard, which lists
 *    every shortcut. Below `sm` the columns stack.
 * 5. The keys are the platform's: ⌘ ⇧ H on a Mac, Ctrl Alt H elsewhere.
 */
import { Link, useLocation } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import {
  COMMON_GROUPS,
  SHORTCUTS,
  groupedShortcuts,
  pageShortcutGroups,
  type Shortcut,
  type ShortcutGroup,
} from "../lib/shortcuts";
import { useSingleKeyShortcuts } from "../hooks/useSingleKeyShortcuts";
import { BTN_QUIET, LABEL } from "../lib/styles";
import { cn } from "../lib/utils";
import { Modal } from "./ui/Modal";
import { Keycap, ShortcutKeys } from "./ui/ShortcutKeys";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

/** The shortcuts on every page, under their headings. */
const COMMON = groupedShortcuts(
  SHORTCUTS.filter((entry) => COMMON_GROUPS.includes(entry.group)),
);

/** Whether the single-key switch turns this shortcut off. */
const isSwitchable = (entry: Shortcut) => entry.bareLetter && !entry.alwaysOn;

/** One group: its heading and a row per shortcut, the words then the keys. */
const Group = ({
  group,
  singleKeys,
}: {
  group: ShortcutGroup;
  singleKeys: boolean;
}) => (
  <section aria-label={group.group}>
    <p className={cn(LABEL, "mb-2")}>{group.group}</p>
    <dl className="space-y-0.5">
      {/* A row is a fact, not a control, so it has no hover. */}
      {group.shortcuts.map((entry) => {
        const off = !singleKeys && isSwitchable(entry);
        return (
          <div
            key={entry.keys.join("+")}
            className={cn(
              "flex items-center justify-between gap-3 py-1.5",
              off && "opacity-50",
            )}
          >
            <dt className="text-sm text-on-surface text-pretty">
              {entry.description}
              {off && <span className="sr-only">, off</span>}
            </dt>
            <dd className="shrink-0">
              <ShortcutKeys keys={entry.keys} />
            </dd>
          </div>
        );
      })}
    </dl>
  </section>
);

export const KeyboardShortcutsModal = ({ isOpen, onClose }: Props) => {
  const { pathname } = useLocation();
  const singleKeys = useSingleKeyShortcuts();
  const page = pageShortcutGroups(pathname);
  const someOff =
    !singleKeys &&
    [...COMMON, ...page].some((group) => group.shortcuts.some(isSwitchable));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Keyboard shortcuts"
      size="xl"
    >
      <div className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-on-surface-variant">
        {someOff ? (
          <p>Single-key shortcuts are off, so the dimmed keys do nothing</p>
        ) : (
          <p className="flex items-center gap-1.5">
            Press <Keycap>?</Keycap> to open this anywhere
          </p>
        )}
        <Link
          to={
            someOff
              ? "/settings/keyboard#single-key-shortcuts"
              : "/settings/keyboard"
          }
          onClick={onClose}
          className={BTN_QUIET}
        >
          {someOff ? "Turn them on" : "All shortcuts"}
          <ArrowRight aria-hidden="true" className="w-3.5 h-3.5" />
        </Link>
      </div>
      {/*
        A Tab stop, so the keyboard can scroll a list that holds nothing
        interactive (WCAG 2.1.1).
      */}
      <div
        role="region"
        aria-label="Shortcut list"
        // A scrolling region the keyboard must reach (WCAG 2.1.1), not a
        // control: it takes focus so the arrow keys scroll it.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        className="grid gap-x-10 gap-y-6 sm:grid-cols-2 rounded-xl"
      >
        <div className="space-y-6">
          {COMMON.map((group) => (
            <Group key={group.group} group={group} singleKeys={singleKeys} />
          ))}
        </div>
        <div className="space-y-6">
          {page.length > 0 ? (
            page.map((group) => (
              <Group key={group.group} group={group} singleKeys={singleKeys} />
            ))
          ) : (
            <section aria-label="This page">
              <p className={cn(LABEL, "mb-2")}>This page</p>
              <p className="py-1.5 text-sm text-on-surface-variant">
                No shortcuts of its own
              </p>
            </section>
          )}
        </div>
      </div>
    </Modal>
  );
};
