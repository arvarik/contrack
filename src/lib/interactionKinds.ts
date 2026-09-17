/**
 * The four kinds of interaction a person logs by hand, and their names.
 *
 * Its own small module so the quick interaction dialog, which is mounted on
 * every page, can name a saved interaction without importing the composer and
 * the editor that comes with it.
 *
 * @module lib/interactionKinds
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
