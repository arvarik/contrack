/**
 * useTrackToggle: track or untrack one contact, with the toast and the Undo.
 *
 * Four controls flip the flag: the Track button in the contact header, the
 * `t` key on the contact page, the palette's action row and the toggle on
 * each row of the Tracked contacts page. They say the same things, so the
 * words live here once.
 *
 *   off to on   "Tracking Ada Lovelace, every 3 months"    Undo untracks
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
          onSuccess: (saved) =>
            toast.success(
              `Tracking ${name}, ${describeCadence(saved.cadenceDays, { sentence: true })}`,
              {
                duration: UNDO_DURATION_MS,
                action: {
                  label: "Undo",
                  onClick: () => mutate({ id, isTracked: false }),
                },
              },
            ),
        },
      );
    },
    [mutate],
  );

  return { toggle, isPending: setTracked.isPending };
}
