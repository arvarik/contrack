/**
 * The four kinds of interaction a person logs by hand, and their names. Its
 * own module, so the quick interaction dialog on every page does not import
 * the composer and its editor.
 */
import type { DraftKind } from "./composerDrafts";

/** Note, call, meeting or email. */
export type InteractionKind = DraftKind;

/** The visible name of each kind, in the order the type control shows them. */
export const INTERACTION_LABELS: Readonly<Record<InteractionKind, string>> = {
  note: "Note",
  call: "Call",
  meeting: "Meeting",
  email: "Email",
};
