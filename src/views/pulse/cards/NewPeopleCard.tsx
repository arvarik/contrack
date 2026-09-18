import React, { useState, Suspense } from "react";
import { UserPlus, ArrowRight } from "lucide-react";
import { CardFrame } from "../components/CardFrame";
import { fallbackAvatarUrl } from "../../../lib/avatar";
import type { DashboardPayload } from "../../../api";

const NetworkGrowthModal = React.lazy(() =>
  import("../NetworkGrowthModal").then((m) => ({
    default: m.NetworkGrowthModal,
  })),
);

export interface NewPeopleCardProps {
  newContacts30d?: number;
  recentlyAdded?: DashboardPayload["recentlyAdded"];
  timeline?: DashboardPayload["networkGrowthTimeline30d"];
}

export const NewPeopleCard = ({
  newContacts30d = 0,
  recentlyAdded = [],
  timeline = [],
}: NewPeopleCardProps) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <CardFrame
        cardId="new-people"
        title="New people"
        icon={UserPlus}
        count={newContacts30d}
        headerAction={
          <button
            onClick={() => setIsOpen(true)}
            className="hit-area text-xs font-semibold text-primary hover:underline flex items-center gap-1 cursor-pointer"
          >
            <span>Details</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        }
      >
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="w-full flex items-center justify-between p-2 rounded-xl bg-surface-container-lowest hover:bg-surface-container border border-outline/10 transition-colors cursor-pointer group text-left"
        >
          {/* Avatar stack */}
          <div className="flex items-center -space-x-2 overflow-hidden py-1">
            {recentlyAdded.slice(0, 5).map((contact) => (
              <img
                key={contact.id}
                src={contact.avatarUrl || fallbackAvatarUrl(contact.name)}
                alt={contact.name}
                title={contact.name}
                className="w-8 h-8 rounded-full object-cover ring-2 ring-surface shrink-0"
              />
            ))}
            {newContacts30d > 5 && (
              <div className="w-8 h-8 rounded-full bg-surface-container-highest flex items-center justify-center text-[11px] font-bold text-on-surface ring-2 ring-surface shrink-0">
                +{newContacts30d - 5}
              </div>
            )}
          </div>

          <div className="text-right">
            <span className="text-xs font-bold text-on-surface group-hover:text-primary transition-colors block">
              {newContacts30d} added
            </span>
            <span className="text-[11px] text-on-surface-variant block">
              this month
            </span>
          </div>
        </button>
      </CardFrame>

      {isOpen && (
        <Suspense fallback={null}>
          <NetworkGrowthModal
            isOpen={isOpen}
            onClose={() => setIsOpen(false)}
            timeline={timeline}
            totalCount={newContacts30d}
          />
        </Suspense>
      )}
    </>
  );
};
