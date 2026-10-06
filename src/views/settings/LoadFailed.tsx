/**
 * LoadFailed — what a settings card says when its values did not load.
 *
 * Never an empty state: "No tokens yet" over a failed read tells a person
 * something false about their account.
 *
 * @module views/settings/LoadFailed
 */
import { TriangleAlert } from "lucide-react";

export const LoadFailed = ({
  what,
  onRetry,
}: {
  /** What did not load, after "Could not load": "your devices". */
  what: string;
  onRetry: () => void;
}) => (
  <div className="space-y-3">
    <p className="flex items-start gap-2 text-sm text-on-surface text-pretty">
      <TriangleAlert className="w-4 h-4 text-warning shrink-0 mt-0.5" />
      Could not load {what}. Nothing has changed
    </p>
    <button type="button" onClick={onRetry} className="btn-secondary">
      Try again
    </button>
  </div>
);
