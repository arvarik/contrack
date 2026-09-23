/**
 * useTrackToggle: track or untrack one contact, with the toast and the Undo.
 *
 * Four controls flip the flag: Stop tracking in the Track button's menu in
 * the contact header, the `t` key on the contact page, the palette's action
 * row and the toggle on each row of the Tracked contacts page. They say the
 * same things, so the words live here once. `trackAt` is the fifth door: a
 * cadence row in the Track button's menu while the contact is untracked,
 * which tracks and sets the cadence in one press.
 *
 *   off to on   "Tracking Ada Lovelace, quarterly"         Undo untracks
 *   on to off   "Stopped tracking Ada Lovelace"            Undo tracks again,
 *                                                          with the cadence
 *                                                          the contact had
 *
 * The cadence in the first toast is the one the server chose, which the
 * answer carries, so the toast waits for the answer. The ring does not: the
 * mutation writes the flag into the caches as the button is pressed.
 *
 * @module hooks/useTrackToggle
 */
import { useCallback } from "react";
import { toast } from "sonner";
import { describeCadence } from "../../shared/cadence";
import { useSetTracked } from "../api/contacts";
import { UNDO_DURATION_MS } from "../lib/undoToast";

/** What the toggle needs to know about the contact it flips. */
export interface TrackableContact {
  id: string;
  name: string;
  isTracked: boolean;
  cadenceDays: number;
}

export function useTrackToggle() {
  const setTracked = useSetTracked();
  const { mutate } = setTracked;

  /** The toast a contact gets when it becomes tracked, with its Undo. */
  const announceTracked = useCallback(
    (id: string, name: string, cadenceDays: number) =>
      toast.success(
        `Tracking ${name}, ${describeCadence(cadenceDays, { sentence: true })}`,
        {
          duration: UNDO_DURATION_MS,
          action: {
            label: "Undo",
            onClick: () => mutate({ id, isTracked: false }),
          },
        },
      ),
    [mutate],
  );

  const toggle = useCallback(
    (contact: TrackableContact) => {
      const { id, name, isTracked, cadenceDays } = contact;
      if (isTracked) {
        mutate(
          { id, isTracked: false },
          {
            onSuccess: () =>
              toast.success(`Stopped tracking ${name}`, {
                duration: UNDO_DURATION_MS,
                action: {
                  label: "Undo",
                  onClick: () => mutate({ id, isTracked: true, cadenceDays }),
                },
              }),
          },
        );
        return;
      }
      mutate(
        { id, isTracked: true },
        {
          onSuccess: (saved) => announceTracked(id, name, saved.cadenceDays),
        },
      );
    },
    [mutate, announceTracked],
  );

  /**
   * Track a contact at a cadence the person picked. The Track button's menu
   * offers this while a contact is untracked, the account's default among
   * the rows: one press, tracked and set.
   */
  const trackAt = useCallback(
    (contact: TrackableContact, cadenceDays: number) => {
      const { id, name } = contact;
      mutate(
        { id, isTracked: true, cadenceDays },
        { onSuccess: (saved) => announceTracked(id, name, saved.cadenceDays) },
      );
    },
    [mutate, announceTracked],
  );

  return { toggle, trackAt, isPending: setTracked.isPending };
}
