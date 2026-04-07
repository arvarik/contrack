/**
 * useUndoableAction — Schedules a destructive action with a timed undo window.
 *
 * Instead of firing immediately, it:
 * 1. Shows a Sonner toast with the action label + "Undo" button
 * 2. Waits `delayMs` (default 4 000ms) before calling the action
 * 3. If the user clicks "Undo", the timeout is cancelled; action never fires
 *
 * Design principles:
 * - The item stays visible during the undo window (no optimistic removal needed)
 * - The returned Promise resolves to `true` if the action executed, `false` if undone
 * - Cleans up on unmount to prevent memory leaks / calling after component death
 *
 * @example
 *   const { scheduleDelete } = useUndoableAction();
 *   await scheduleDelete(() => deleteList.mutateAsync(id), `Deleted "${list.name}"`);
 */
import { useCallback, useRef, useEffect } from 'react';
import { toast } from 'sonner';

export interface UndoableActionOptions {
  /** Toast label, e.g. 'Deleted "SF List"' */
  label: string;
  /** Milliseconds to wait before executing. Default: 4000 */
  delayMs?: number;
}

export const useUndoableAction = () => {
  const mountedRef = useRef(true);
  const pendingTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Cancel all pending actions on unmount
      pendingTimers.current.forEach(clearTimeout);
      pendingTimers.current.clear();
    };
  }, []);

  const schedule = useCallback(
    (action: () => Promise<void>, options: UndoableActionOptions): Promise<boolean> => {
      const { label, delayMs = 4000 } = options;

      return new Promise<boolean>((resolve) => {
        let cancelled = false;

        const timerId = setTimeout(async () => {
          pendingTimers.current.delete(timerId);
          if (cancelled || !mountedRef.current) {
            resolve(false);
            return;
          }
          try {
            await action();
            resolve(true);
          } catch (err) {
            // Surface the error as a toast so the caller doesn't need to handle it
            toast.error(err instanceof Error ? err.message : 'Action failed');
            resolve(false);
          }
        }, delayMs);

        pendingTimers.current.add(timerId);

        toast(label, {
          duration: delayMs,
          action: {
            label: 'Undo',
            onClick: () => {
              cancelled = true;
              clearTimeout(timerId);
              pendingTimers.current.delete(timerId);
              toast.dismiss();
              resolve(false);
            },
          },
        });
      });
    },
    []
  );

  return { schedule };
};
