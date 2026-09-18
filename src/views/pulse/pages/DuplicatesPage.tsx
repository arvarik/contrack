import React, { lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Inbox } from "lucide-react";
import { PAGE_TITLE } from "../../../lib/styles";
import { NAMES } from "../../../lib/names";
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
      <div className="max-w-4xl mx-auto p-4 sm:p-6 md:p-10 flex flex-col gap-6 sm:gap-8 pb-32">
        {/* Header with back link to Pulse */}
        <div className="flex flex-col gap-2">
          <Link
            to="/pulse"
            className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-primary hover:underline group w-fit cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
            <span>Pulse</span>
          </Link>

          <div className="flex items-center gap-3 mt-1">
            <div className="p-2.5 bg-primary/10 rounded-xl text-primary shrink-0">
              <Inbox className="w-6 h-6" />
            </div>
            <div>
              <h1 className={PAGE_TITLE}>{NAMES.possibleDuplicates.label}</h1>
              <p className="text-xs sm:text-sm text-on-surface-variant">
                Contacts that may be the same person. Merge or dismiss
                suggestions.
              </p>
            </div>
          </div>
        </div>

        {/* Suggestion Review Queue */}
        <div className="w-full">
          <Suspense fallback={null}>
            <SuggestionReviewQueue />
          </Suspense>
        </div>
      </div>
    </div>
  );
};
