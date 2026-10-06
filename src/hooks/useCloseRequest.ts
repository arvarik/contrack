/**
 * useCloseRequest — close an open sheet or menu on the platform's close
 * request: the Back gesture or button on Android.
 *
 * Without it, Back on a phone left the page behind an open sheet, and a
 * typed note went with it. `CloseWatcher` is the browser's own answer: while
 * one is active, Back closes it instead of leaving the page, and it adds no
 * history entry, so it cannot race the router.
 *
 * It is created only on a touch screen. There the platform's Back is the way
 * out. With a keyboard, Escape already closes every overlay, and a second
 * listener would close it twice. A browser without `CloseWatcher`, such as
 * Safari, keeps today's behavior.
 *
 * @module hooks/useCloseRequest
 */

import { useEffect, useRef, useState } from "react";
import { touchFirst } from "../lib/platform";

interface Watcher {
  onclose: (() => void) | null;
  destroy: () => void;
}

type WatcherConstructor = new () => Watcher;

export function useCloseRequest(open: boolean, onClose: () => void): void {
  const latest = useRef(onClose);
  useEffect(() => {
    latest.current = onClose;
  }, [onClose]);
  // A watcher is spent by its close request. An overlay that refused to
  // close, such as a dialog that is saving, gets a new one, or the next Back
  // would leave the page under it.
  const [spent, setSpent] = useState(0);

  useEffect(() => {
    if (!open) return;
    const Watcher = (globalThis as { CloseWatcher?: WatcherConstructor })
      .CloseWatcher;
    if (!Watcher || !touchFirst()) return;
    let watcher: Watcher;
    try {
      watcher = new Watcher();
    } catch {
      // Too many watchers without a user gesture: the overlay still closes
      // every other way.
      return;
    }
    watcher.onclose = () => {
      latest.current();
      setSpent((count) => count + 1);
    };
    return () => watcher.destroy();
  }, [open, spent]);
}
