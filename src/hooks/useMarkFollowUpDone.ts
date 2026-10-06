/**
 * useMarkFollowUpDone: marks a follow-up done, with Undo.
 *
 * No route reopens a follow-up, so it reads as done at once and the request
 * goes when the toast's Undo is gone (`startPendingDelete`). The Details
 * card and the note's dialog share it, so the toast and its Undo are the
 * same wherever a follow-up is done.
 *
 * @module hooks/useMarkFollowUpDone
 */
import { useCallback } from "react";
import { useCompleteActionItem } from "../api";
import { startPendingDelete } from "../lib/pendingDeletes";

export function useMarkFollowUpDone(): (id: string) => void {
  const { mutateAsync } = useCompleteActionItem();
  return useCallback(
    (id: string) =>
      startPendingDelete({
        id,
        send: () => mutateAsync(id),
        message: "Follow-up done",
        errorMessage: "Could not mark the follow-up done",
        flushUrl: `/action-items/${encodeURIComponent(id)}/complete`,
        flushMethod: "PATCH",
      }),
    [mutateAsync],
  );
}
