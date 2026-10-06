import { useState } from "react";
import { Segmented } from "../../components/ui/Segmented";
import { DuplicateCheck } from "./components/DuplicateCheck";
import { ManualMerge } from "./components/ManualMerge";

type DedupeTab = "check" | "manual";

/**
 * The Duplicates tool in Settings: run a check, or merge chosen contacts by
 * hand. What a check finds waits in Possible duplicates.
 */
export const DedupeView = () => {
  const [activeTab, setActiveTab] = useState<DedupeTab>("check");

  return (
    // Clips only sideways: a clip on both axes stops Compare from sticking.
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
