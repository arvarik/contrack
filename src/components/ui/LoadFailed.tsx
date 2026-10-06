/**
 * LoadFailed — what a place shows when its data did not load.
 *
 * Never an empty state: "No tokens yet" over a failed read tells a person
 * something false about their account. One look and one set of words
 * everywhere: the `EmptyState` with the error tile, "Could not load
 * <what>", a sentence that says nothing was lost, and Try again. Settings
 * said it one way and the pages another ("Tags did not load", "System
 * disconnected"), and the button said Retry or Try again.
 *
 * @module components/ui/LoadFailed
 */
import type { ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { EmptyState } from "./EmptyState";

interface LoadFailedProps {
  /** What did not load, after "Could not load": "your contacts". */
  what: string;
  /** Ask again: the query's `refetch`. Without it there is no button. */
  onRetry?: () => void;
  /** The sentence under the title, when the default does not fit. */
  body?: ReactNode;
  /** 2 on a page, 3 inside a card that has its own h2. */
  level?: 2 | 3;
  className?: string;
}

export const LoadFailed = ({
  what,
  onRetry,
  body = "Nothing has changed. Try again in a moment",
  level,
  className,
}: LoadFailedProps) => (
  <EmptyState
    icon={AlertCircle}
    tone="error"
    title={`Could not load ${what}`}
    body={body}
    action={onRetry && { label: "Try again", onClick: onRetry }}
    level={level}
    className={className}
  />
);
