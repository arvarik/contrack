/**
 * Possible duplicates: To review is the queue of pairs, and Merge history
 * lists every recent merge, by a person or by Contrack, each with Undo.
 * `?view=merged` opens Merge history, from Settings and from the check's
 * "2 merged automatically".
 */
import { lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../../../components/layout/PageHeader";
import { Segmented } from "../../../components/ui/Segmented";
import { PAGE_TOP, PAGE_X } from "../../../lib/styles";
import { NAMES } from "../../../lib/names";
import { cn } from "../../../lib/utils";
import { usePageTitle } from "../../../hooks/usePageTitle";

const DuplicateQueue = lazy(() =>
  import("../../dedupe/components/DuplicateQueue").then((m) => ({
    default: m.DuplicateQueue,
  })),
);
const MergeHistory = lazy(() =>
  import("../../dedupe/components/MergeHistory").then((m) => ({
    default: m.MergeHistory,
  })),
);

type View = "review" | "merged";

export const DuplicatesPage = () => {
  usePageTitle(NAMES.possibleDuplicates.title);
  const [params, setParams] = useSearchParams();
  const view: View = params.get("view") === "merged" ? "merged" : "review";

  return (
    <div className="w-full h-full overflow-y-auto bg-surface relative">
      <div
        className={cn(
          "max-w-6xl mx-auto flex flex-col gap-6 pb-32",
          PAGE_X,
          PAGE_TOP,
        )}
      >
        <PageHeader
          back={{ to: "/pulse", label: NAMES.pulse.label }}
          title={NAMES.possibleDuplicates.label}
          description="Contacts that may be the same person. Merge them, or keep them separate"
        >
          <Segmented
            label="Show"
            value={view}
            onChange={(next) =>
              setParams(
                (prev) => {
                  const nextParams = new URLSearchParams(prev);
                  if (next === "merged") nextParams.set("view", "merged");
                  else nextParams.delete("view");
                  return nextParams;
                },
                { replace: true },
              )
            }
            options={[
              { value: "review", label: "To review" },
              { value: "merged", label: NAMES.mergeHistory.label },
            ]}
            className="w-full sm:w-auto sm:self-start"
          />
        </PageHeader>

        <Suspense fallback={null}>
          {view === "merged" ? (
            <div className="max-w-2xl w-full">
              <MergeHistory />
            </div>
          ) : (
            <DuplicateQueue />
          )}
        </Suspense>
      </div>
    </div>
  );
};
