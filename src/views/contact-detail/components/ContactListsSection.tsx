import { ListPlus, X } from "lucide-react";
import { showUndoToast } from "./Field";
import { useLists, useAddToList, useRemoveFromList } from "../../../api";
import { ListIcon, listIcon } from "../../contact-list/CreateListModal";
import {
  ActionMenu,
  type ActionMenuItem,
} from "../../../components/ui/ActionMenu";

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

  // `ActionMenu` returns focus to its button before the mutation runs.
  const addItems: ActionMenuItem[] = availableLists.map((list) => ({
    id: list.id,
    label: list.name,
    icon: listIcon(list.icon),
    onSelect: () => addToList.mutate({ listId: list.id, contactId }),
  }));

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {contactLists.map((list) => (
        <span
          key={list.id}
          className="state-layer flex items-center gap-1.5 text-xs font-bold bg-primary/10 text-on-primary-wash px-2.5 py-1 rounded-md group/listpill transition-colors"
        >
          <ListIcon icon={list.icon} className="w-3 h-3" />
          {list.name}
          <button
            onClick={() =>
              removeFromList.mutate(
                { listId: list.id, contactId },
                {
                  onSuccess: () =>
                    showUndoToast(`Removed from ${list.name}`, () =>
                      addToList.mutate({ listId: list.id, contactId }),
                    ),
                },
              )
            }
            // Touch has no hover, so the X shows at rest with a 44 px tap box
            // and no overflow clip, which would cut the box. With a fine
            // pointer from `sm`, it slides in on hover or focus.
            className="hit-area w-3 ml-0.5 opacity-100 sm:pointer-fine:w-0 sm:pointer-fine:ml-0 sm:pointer-fine:overflow-hidden sm:pointer-fine:opacity-0 sm:pointer-fine:group-hover/listpill:w-3 sm:pointer-fine:group-hover/listpill:ml-0.5 sm:pointer-fine:group-hover/listpill:opacity-100 sm:pointer-fine:focus-visible:w-3 sm:pointer-fine:focus-visible:opacity-100 hover:text-error transition-all duration-(--dur-slow) flex items-center"
            title="Remove from list"
            aria-label={`Remove from ${list.name}`}
          >
            <X className="w-3 h-3 shrink-0" />
          </button>
        </span>
      ))}

      {availableLists.length > 0 && (
        <ActionMenu
          label="Add to a list"
          title="Add to a list"
          icon={ListPlus}
          iconClassName="w-3.5 h-3.5"
          align="start"
          items={addItems}
          triggerClassName="gap-1 text-xs font-bold px-2 py-1 rounded-md"
        />
      )}
    </div>
  );
};
