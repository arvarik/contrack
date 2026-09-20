import React from "react";
import { ListPlus, X, type LucideIcon } from "lucide-react";
import {
  Star,
  Heart,
  Crown,
  Flame,
  Rocket,
  Target,
  Gem,
  Award,
  Briefcase,
  Users,
  Globe,
  Zap,
  Shield,
  Coffee,
  Music,
  Camera,
  BookOpen,
  TrendingUp,
  Anchor,
  Flag,
  Sparkles,
  Sun,
} from "lucide-react";
import { useLists, useAddToList, useRemoveFromList } from "../../../api";
import {
  ActionMenu,
  type ActionMenuItem,
} from "../../../components/ui/ActionMenu";

const LIST_ICON_MAP: Record<string, LucideIcon> = {
  star: Star,
  heart: Heart,
  crown: Crown,
  flame: Flame,
  rocket: Rocket,
  target: Target,
  gem: Gem,
  award: Award,
  briefcase: Briefcase,
  users: Users,
  globe: Globe,
  zap: Zap,
  shield: Shield,
  coffee: Coffee,
  music: Music,
  camera: Camera,
  "book-open": BookOpen,
  "trending-up": TrendingUp,
  anchor: Anchor,
  flag: Flag,
  sparkles: Sparkles,
  sun: Sun,
};

export const DetailListIcon = ({
  icon,
  className,
}: {
  icon: string;
  className?: string;
}) => {
  const Icon = LIST_ICON_MAP[icon] || Star;
  return <Icon className={className} />;
};

export const ContactListsSection = ({
  contactId,
  contactLists,
}: {
  contactId: string;
  contactLists: { id: string; name: string; icon: string }[];
}) => {
  const { data: allLists = [] } = useLists();
  const addToList = useAddToList();
  const removeFromList = useRemoveFromList();

  const memberOfIds = new Set(contactLists.map((l) => l.id));
  const availableLists = allLists.filter((l) => !memberOfIds.has(l.id));

  // One row per list the contact is not on yet. `ActionMenu` draws the
  // panel, closes it, and returns focus to the button before the mutation.
  const addItems: ActionMenuItem[] = availableLists.map((list) => ({
    id: list.id,
    label: list.name,
    icon: LIST_ICON_MAP[list.icon] || Star,
    onSelect: () => addToList.mutate({ listId: list.id, contactId }),
  }));

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {contactLists.map((list) => (
        <span
          key={list.id}
          className="flex items-center gap-1.5 text-xs font-bold bg-primary/10 text-on-primary-wash px-2.5 py-1 rounded-md group/listpill transition-colors hover:bg-primary/20"
        >
          <DetailListIcon icon={list.icon} className="w-3 h-3" />
          {list.name}
          <button
            onClick={() =>
              removeFromList.mutate({ listId: list.id, contactId })
            }
            // A phone has no hover, so below `sm` the X shows at rest with a
            // 44 px tap box. From `sm` it slides in on hover or focus, and
            // its overflow clip (which would clip the tap box) comes back.
            className="hit-area w-3 ml-0.5 opacity-100 sm:w-0 sm:ml-0 sm:overflow-hidden sm:opacity-0 sm:group-hover/listpill:w-3 sm:group-hover/listpill:ml-0.5 sm:group-hover/listpill:opacity-100 sm:focus-visible:w-3 sm:focus-visible:opacity-100 hover:text-error transition-all duration-300 flex items-center"
            title="Remove from list"
            aria-label={`Remove from ${list.name}`}
          >
            <X className="w-3 h-3 shrink-0" />
          </button>
        </span>
      ))}

      {/* Add to list menu */}
      {availableLists.length > 0 && (
        <ActionMenu
          label="Add to a list"
          title="Add to a list"
          icon={ListPlus}
          iconClassName="w-3.5 h-3.5"
          align="start"
          items={addItems}
          triggerClassName="hit-area flex items-center gap-1 text-xs font-bold text-on-surface-variant hover:text-primary px-2 py-1 rounded-md hover:bg-primary/10 transition-colors"
        />
      )}
    </div>
  );
};
