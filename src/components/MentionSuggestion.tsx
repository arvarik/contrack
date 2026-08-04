import { ReactRenderer } from "@tiptap/react";
import type {
  SuggestionProps,
  SuggestionKeyDownProps,
} from "@tiptap/suggestion";
import type { MentionNodeAttrs } from "@tiptap/extension-mention";
import tippy, { Instance as TippyInstance } from "tippy.js";
import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import { HealthRingAvatar } from "./HealthRingAvatar";
import type { ContactSlim } from "../api/contacts";

interface MentionListProps {
  items: ContactSlim[];
  command: (attrs: { id: string; label: string }) => void;
}

export const MentionList = forwardRef<
  { onKeyDown: (args: { event: KeyboardEvent }) => boolean },
  MentionListProps
>((props, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => setSelectedIndex(0), [props.items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (event.key === "ArrowUp") {
        setSelectedIndex(
          (selectedIndex + props.items.length - 1) % props.items.length,
        );
        return true;
      }
      if (event.key === "ArrowDown") {
        setSelectedIndex((selectedIndex + 1) % props.items.length);
        return true;
      }
      if (event.key === "Enter") {
        if (props.items.length) {
          props.command({
            id: props.items[selectedIndex].id,
            label: props.items[selectedIndex].name,
          });
        }
        return true;
      }
      return false;
    },
  }));

  return (
    <div className="bg-surface-container-lowest border border-surface-container-highest shadow-xl rounded-xl z-50 overflow-hidden flex flex-col py-1 w-64 animate-in fade-in zoom-in-95 duration-200">
      {props.items.length ? (
        props.items.map((item: ContactSlim, index: number) => (
          <button
            className={`flex items-center gap-3 px-3 py-2 text-sm transition-colors text-left w-full
            ${index === selectedIndex ? "bg-surface-container-low text-primary" : "bg-transparent text-on-surface hover:bg-surface-container"}`}
            key={item.id}
            onClick={() => {
              props.command({ id: item.id, label: item.name });
            }}
          >
            <div className="w-6 h-6">
              <HealthRingAvatar contact={item} />
            </div>
            <span className="font-semibold truncate">{item.name}</span>
            {item.isGhost && (
              <span className="ml-auto text-[10px] uppercase font-bold text-on-surface-variant/50">
                Ghost
              </span>
            )}
          </button>
        ))
      ) : (
        <div className="px-3 py-2 text-sm text-on-surface-variant">
          No results...
        </div>
      )}
    </div>
  );
});

export const getMentionSuggestion = (contacts: ContactSlim[]) => ({
  items: ({ query }: { query: string }) => {
    return contacts
      .filter((item) => item.name.toLowerCase().startsWith(query.toLowerCase()))
      .slice(0, 5);
  },

  render: () => {
    let component: ReactRenderer;
    let popup: TippyInstance[];

    return {
      onStart: (props: SuggestionProps<ContactSlim, MentionNodeAttrs>) => {
        component = new ReactRenderer(MentionList, {
          props,
          editor: props.editor,
        });

        if (!props.clientRect) return;

        popup = tippy("body", {
          getReferenceClientRect: props.clientRect as () => DOMRect,
          appendTo: () => document.body,
          content: component.element,
          showOnCreate: true,
          interactive: true,
          trigger: "manual",
          placement: "bottom-start",
        });
      },

      onUpdate(props: SuggestionProps<ContactSlim, MentionNodeAttrs>) {
        component.updateProps(props);

        if (!props.clientRect) return;

        popup[0].setProps({
          getReferenceClientRect: props.clientRect as () => DOMRect,
        });
      },

      onKeyDown(props: SuggestionKeyDownProps) {
        if (props.event.key === "Escape") {
          popup[0].hide();
          return true;
        }

        // `?? false` matches the old behavior: an undefined return (null ref)
        // was already treated as falsy by TipTap.
        return (
          (
            component.ref as {
              onKeyDown: (args: { event: KeyboardEvent }) => boolean;
            } | null
          )?.onKeyDown(props) ?? false
        );
      },

      onExit() {
        popup[0].destroy();
        component.destroy();
      },
    };
  },
});
