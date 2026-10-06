/**
 * Track or untrack one contact, with the toast and the Undo. Four controls
 * flip the flag (the Track button's menu, the `t` key on a contact, the
 * palette's action row and each row of the Tracked contacts page), so the
 * words live here once. `trackAt` tracks at a picked cadence in one press,
 * from a cadence row in the Track button's menu.
 *
 *   off to on   "Tracking Rowan Vale, quarterly"   Undo untracks
 *   on to off   "Stopped tracking Rowan Vale"      Undo tracks again, at the
 *                                                  cadence the contact had
 *
 * The first toast names the cadence the server chose, so it waits for the
 * answer. The ring does not: the mutation writes the flag into the caches
 * at once.
 */
import { useCallback } from "react";
import { toast } from "sonner";
import { describeCadence } from "../../shared/cadence";
import { useSetTracked } from "../api/contacts";
import { withUndo } from "../lib/undoToast";

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
        withUndo(() => mutate({ id, isTracked: false })),
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
              toast.success(
                `Stopped tracking ${name}`,
                withUndo(() => mutate({ id, isTracked: true, cadenceDays })),
              ),
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
