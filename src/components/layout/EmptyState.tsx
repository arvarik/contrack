/**
 * The desktop pane when no contact is open. The corvid perches in its
 * header, faded, above the one line that says what the pane is waiting for.
 */
import { CorvidMark } from "../brand/CorvidMark";

export const EmptyState = () => (
  <div className="flex-1 flex flex-col items-center justify-center h-full text-on-surface-variant bg-surface relative z-10">
    <CorvidMark size={96} className="mb-4 text-primary/60" />
    <h2 className="text-xl font-headline font-semibold text-on-surface">
      No Contact Selected
    </h2>
  </div>
);
