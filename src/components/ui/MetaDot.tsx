/**
 * MetaDot: the middle dot between two items on one line of facts.
 *
 * "Sydney · 2:45 AM · 13°C" under a contact's name. The dot sits at the
 * height of the letters' middle, not on the line like a period, and it is
 * decoration: a screen reader skips it.
 *
 * The caller puts the dot between items, never first or last, and keeps it
 * with the item after it, so a line that wraps never ends on a dot. Pulse's
 * line of counts draws its own dots, so that a wrapped line there does not
 * start with one either (`Masthead`).
 *
 * @module components/ui/MetaDot
 */

export const MetaDot = () => <span aria-hidden="true">·</span>;
