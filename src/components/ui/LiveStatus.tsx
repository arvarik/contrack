/**
 * One polite live region (`role="status"`, WCAG 4.1.3) for results and
 * progress: "Searching…", "12 matches". Errors take `role="alert"` beside
 * their visible text instead.
 *
 * The region is always mounted and only its text changes: a region that
 * appears with text is skipped by some screen readers. The first value is not
 * spoken, so Back to a page does not read its old count. `aria-atomic` reads
 * each change as one sentence.
 */
import { useEffect, useRef, useState } from "react";

export const LiveStatus = ({
  message,
  label,
}: {
  /** The current status. "" clears the region and says nothing. */
  message: string;
  /** Names the region, for a page with more than one. Not read on updates. */
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
