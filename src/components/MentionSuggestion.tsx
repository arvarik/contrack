import { ReactRenderer } from "@tiptap/react";
import type {
  SuggestionProps,
  SuggestionKeyDownProps,
} from "@tiptap/suggestion";
import type { MentionNodeAttrs } from "@tiptap/extension-mention";
import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
  type VirtualElement,
} from "@floating-ui/dom";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { ScoreRingAvatar } from "./ScoreRingAvatar";
import { scoreView, scoreWords } from "../../shared/scoreBand";
import type { ContactSlim } from "../api/contacts";
import {
  LABEL,
  MENU_ITEM,
  MENU_ITEM_SELECTED,
  MENU_PANEL,
} from "../lib/styles";
import { cn } from "../lib/utils";

interface MentionListProps {
  items: ContactSlim[];
  command: (attrs: { id: string; label: string }) => void;
}

const MentionList = forwardRef<
  { onKeyDown: (args: { event: KeyboardEvent }) => boolean },
  MentionListProps
>((props, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => setSelectedIndex(0), [props.items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      // No one matches: the keys are the editor's again, so Enter after
      // "@Ada went home" starts a new line.
      if (!props.items.length) return false;
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
        props.command({
          id: props.items[selectedIndex].id,
          label: props.items[selectedIndex].name,
        });
        return true;
      }
      return false;
    },
  }));

  // No one matches: nothing shows. A space can be part of a name, so the
  // query goes on after "@Ada " into the rest of the sentence.
  if (!props.items.length) return null;
  return (
    <div className={cn(MENU_PANEL, "z-50 flex flex-col w-64 min-w-0")}>
      {props.items.map((item: ContactSlim, index: number) => {
        const words = scoreWords(scoreView(item));
        return (
          <button
            className={cn(
              MENU_ITEM,
              index === selectedIndex && MENU_ITEM_SELECTED,
            )}
            key={item.id}
            onClick={() => {
              props.command({ id: item.id, label: item.name });
            }}
          >
            {/* Sized to the row, and hidden: the name beside it already
                  names the button. The tooltip on this wrapper still shows
                  the score to a pointer user. */}
            <div
              className="w-7 h-7 shrink-0"
              title={words ?? undefined}
              aria-hidden="true"
            >
              <ScoreRingAvatar
                contact={item}
                size={28}
                ring="list"
                decorative
              />
            </div>
            <span className="truncate">{item.name}</span>
            {/* The ring is hidden, so the button's name says the score in
                  words after the person's name. A contact nobody tracks has
                  no score, and the button says only the name. */}
            {words && (
              <span className="sr-only">
                , {scoreWords(scoreView(item), { sentence: true })}
              </span>
            )}
            {item.isGhost && (
              <span className={cn(LABEL, "ml-auto")}>Not added</span>
            )}
          </button>
        );
      })}
    </div>
  );
});

/**
 * The people an @ query names: each typed word starts a word of the name,
 * so "@smi" finds Ada Smith and "@ada s" finds her too. It matched only the
 * start of the full name, so a surname found no one. Eight at most.
 */
export function mentionMatches<T extends { name: string }>(
  people: readonly T[],
  query: string,
): T[] {
  const typed = query.toLowerCase().split(/\s+/).filter(Boolean);
  return people
    .filter((person) => {
      const words = person.name.toLowerCase().split(/[\s'-]+/);
      return typed.every((part) => words.some((word) => word.startsWith(part)));
    })
    .slice(0, 8);
}

/**
 * The @mention suggestion for a tiptap editor.
 *
 * `contacts` is read each time somebody types @, not when the editor is
 * created. An editor is created once, and a list captured then stays empty
 * when the names had not loaded yet.
 *
 * The list is placed inside the dialog when the editor is in one. A modal
 * dialog makes everything outside it inert: the rest of the page takes no
 * pointer events and is hidden from assistive tech. A list appended to
 * `document.body` could be seen and not clicked, and a click on it counted as
 * a click outside, which closed the dialog.
 *
 * Floating UI places the list under the caret, above it when there is no
 * room below, and follows the caret while the page scrolls. TipTap's
 * suggestion plugin uses the same library. tippy.js did this before. Its
 * last release was in 2021, and its Popper engine's in 2023.
 */
export const getMentionSuggestion = (contacts: () => ContactSlim[]) => ({
  // A space may be part of the query: "@Ada Lo".
  allowSpaces: true,
  items: ({ query }: { query: string }) => mentionMatches(contacts(), query),

  render: () => {
    let component: ReactRenderer;
    let popup: HTMLElement | null = null;
    let stopUpdates: (() => void) | null = null;
    let caret: (() => DOMRect | null) | null | undefined;
    // One reference for the list's lifetime, reading the latest caret, so
    // autoUpdate keeps following it after each keystroke.
    const reference: VirtualElement = {
      getBoundingClientRect: () => caret?.() ?? new DOMRect(),
    };

    const place = () => {
      const el = popup;
      if (!el) return;
      void computePosition(reference, el, {
        placement: "bottom-start",
        middleware: [offset(10), flip(), shift({ padding: 8 })],
      }).then(({ x, y }) => {
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        // Hidden until placed, so it never shows at the host's corner.
        el.style.visibility = "visible";
      });
    };

    return {
      onStart: (props: SuggestionProps<ContactSlim, MentionNodeAttrs>) => {
        component = new ReactRenderer(MentionList, {
          props,
          editor: props.editor,
        });

        if (!props.clientRect) return;
        caret = props.clientRect;
        reference.contextElement = props.editor.view.dom;

        const host =
          props.editor.view.dom.closest<HTMLElement>('[role="dialog"]') ??
          document.body;
        popup = document.createElement("div");
        Object.assign(popup.style, {
          position: "absolute",
          top: "0",
          left: "0",
          zIndex: "9999",
          visibility: "hidden",
        });
        popup.appendChild(component.element);
        host.appendChild(popup);
        stopUpdates = autoUpdate(reference, popup, place);
      },

      onUpdate(props: SuggestionProps<ContactSlim, MentionNodeAttrs>) {
        component.updateProps(props);

        if (!props.clientRect) return;
        caret = props.clientRect;
        place();
      },

      onKeyDown(props: SuggestionKeyDownProps) {
        if (props.event.key === "Escape") {
          if (popup) popup.style.display = "none";
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
        stopUpdates?.();
        popup?.remove();
        popup = null;
        component.destroy();
      },
    };
  },
});
