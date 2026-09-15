/**
 * LiveStatus — one polite live region that says what just happened.
 *
 * WCAG 2.2 success criterion 4.1.3 (Status Messages) asks that a change a
 * sighted person notices without looking for it — "Searching…", "12 matches",
 * "Nothing found" — reach a screen reader without moving focus. The
 * technique for results and progress is `role="status"` (ARIA22). Errors
 * take `role="alert"` (ARIA19) and live beside the visible error text, not
 * here: an alert interrupts, and only a failure has earned that.
 *
 * Two rules make a region reliable, and both are enforced here rather than
 * at each call site:
 *
 *   The region is in the DOM before it has anything to say. A region that
 *   appears with text already in it is announced by some screen readers and
 *   skipped by others, so the element is always mounted and only its text
 *   changes.
 *
 *   The first value is not announced. A page that mounts over results it
 *   already had (Back to the search page) would otherwise speak a count the
 *   reader did not ask for. Only a change after mount is spoken, which is
 *   the definition of a status message.
 *
 * `aria-atomic` makes each change read as one sentence rather than as the
 * words that differ from the last one.
 */
import { useEffect, useRef, useState } from "react";

export const LiveStatus = ({
  message,
  label,
}: {
  /** The current status. "" clears the region and says nothing. */
  message: string;
  /**
   * Names the region for assistive technology and for tests, so a page with
   * more than one status region stays unambiguous. Not read on each update.
   */
  label: string;
}) => {
  const [text, setText] = useState("");
  const initial = useRef(message);
  const changed = useRef(false);

  useEffect(() => {
    if (!changed.current) {
      if (message === initial.current) return;
      changed.current = true;
    }
    setText(message);
  }, [message]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={label}
      className="sr-only"
    >
      {text}
    </div>
  );
};
