import React, { lazy, Suspense } from "react";
import { PageHeader } from "../../../components/layout/PageHeader";
import { PAGE_TOP, PAGE_X } from "../../../lib/styles";
import { NAMES } from "../../../lib/names";
import { cn } from "../../../lib/utils";
import { usePageTitle } from "../../../hooks/usePageTitle";

const SuggestionReviewQueue = lazy(() =>
  import("../../dedupe/components").then((m) => ({
    default: m.SuggestionReviewQueue,
  })),
);

export const DuplicatesPage = () => {
  usePageTitle(NAMES.possibleDuplicates.title);

  return (
    <div className="w-full h-full overflow-y-auto bg-surface nice-scrollbar relative">
      <div
        className={cn(
          "max-w-4xl mx-auto flex flex-col gap-6 sm:gap-8 pb-32",
          PAGE_X,
          PAGE_TOP,
        )}
      >
        <PageHeader
          back={{ to: "/pulse", label: NAMES.pulse.label }}
          title={NAMES.possibleDuplicates.label}
          description="Contacts that may be the same person. Merge or dismiss suggestions."
        />

        <div className="w-full">
          <Suspense fallback={null}>
            <SuggestionReviewQueue />
          </Suspense>
        </div>
      </div>
    </div>
  );
};
