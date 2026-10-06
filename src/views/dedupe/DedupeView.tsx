import { useState } from "react";
import { Segmented } from "../../components/ui/Segmented";
import { DuplicateCheck } from "./components/DuplicateCheck";
import { ManualMerge } from "./components/ManualMerge";

// =============================================================================
// DedupeView — check every contact for duplicates, or merge chosen ones by hand
// =============================================================================

type DedupeTab = "check" | "manual";

/**
 * The Duplicates page's tool, inside the Settings shell. The tabs come
 * first, then the tab's body: the one check, or the manual merge. What a
 * check finds waits in Possible duplicates, the one place a person reviews.
 */
export const DedupeView = () => {
  const [activeTab, setActiveTab] = useState<DedupeTab>("check");

  return (
    // The settings page scrolls, so the tool takes its own height and clips
    // only sideways. A clip on both axes would stop a sticky control inside
    // it, Compare in the manual tab, from sticking.
    <div className="flex flex-col overflow-x-clip">
      <Segmented
        label="Duplicates tool"
        value={activeTab}
        onChange={setActiveTab}
        options={[
          { value: "check", label: "Check" },
          { value: "manual", label: "Manual merge" },
        ]}
        className="w-full sm:w-auto sm:self-start"
      />
      <div className="pt-4">
        {activeTab === "check" ? <DuplicateCheck /> : <ManualMerge />}
      </div>
    </div>
  );
};
