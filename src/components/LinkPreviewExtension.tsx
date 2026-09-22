import { Node, mergeAttributes } from "@tiptap/core";
import {
  ReactNodeViewRenderer,
  NodeViewWrapper,
  type NodeViewProps,
} from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import React, { useEffect } from "react";
import { ExternalLink, Image as ImageIcon, Loader2 } from "lucide-react";
import { cn, safeHref } from "../lib/utils";
import { CARD_INTERACTIVE, LABEL, LABEL_PRIMARY } from "../lib/styles";
import { apiJson } from "../api/client";

const LinkPreviewComponent = ({ node, updateAttributes }: NodeViewProps) => {
  const { url, title, description, image, loading } = node.attrs;

  useEffect(() => {
    if (loading && url) {
      // `apiJson` throws for every non-2xx, so the rate-limited and refused
      // cases land in the same `catch` as a dead server. A preview that does
      // not arrive shows its error state; there is nothing else to say about
      // one link inside a note.
      apiJson<{
        title?: string;
        description?: string;
        image?: string;
      }>(`/link-preview/unfurl?url=${encodeURIComponent(url)}`)
        .then((data) => {
          updateAttributes({
            loading: false,
            title: data.title,
            description: data.description,
            image: data.image,
          });
        })
        .catch(() => {
          updateAttributes({ loading: false, error: true });
        });
    }
  }, [loading, url, updateAttributes]);

  return (
    <NodeViewWrapper
      className="mention-nodeview inline-block w-full max-w-xl my-4 select-none"
      contentEditable={false}
    >
      <a
        href={safeHref(url)}
        target="_blank"
        rel="noopener noreferrer"
        // A card that is a link: the card rises on hover, and nothing inside
        // it moves on its own.
        className={cn(
          CARD_INTERACTIVE,
          "p-0 overflow-hidden flex flex-col sm:flex-row",
        )}
      >
        {image ? (
          <div className="sm:w-48 h-32 sm:h-auto shrink-0 overflow-hidden relative">
            <img
              src={image}
              alt={title || "Link preview"}
              className="w-full h-full object-cover"
            />
          </div>
        ) : (
          <div className="sm:w-48 h-24 sm:h-auto shrink-0 bg-surface-container flex items-center justify-center">
            {loading ? (
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            ) : (
              <ImageIcon className="w-6 h-6 text-on-surface-variant opacity-50" />
            )}
          </div>
        )}

        <div className="p-4 flex-1 min-w-0 flex flex-col justify-center">
          <div className="font-bold text-sm text-on-surface truncate mb-1">
            {title || url}
          </div>
          {description && (
            <div className="text-xs text-on-surface-variant line-clamp-2 leading-relaxed mb-2">
              {description}
            </div>
          )}
          <div className="flex items-center gap-1 mt-auto">
            <ExternalLink className="w-3 h-3 text-primary" />
            <span className={cn(LABEL_PRIMARY, "truncate")}>
              {new URL(url).hostname}
            </span>
          </div>
        </div>
      </a>
    </NodeViewWrapper>
  );
};

export const LinkPreviewExtension = Node.create({
  name: "linkPreview",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      url: { default: null },
      title: { default: null },
      description: { default: null },
      image: { default: null },
      loading: { default: true },
      error: { default: false },
    };
  },

  parseHTML() {
    return [{ tag: "link-preview" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "link-preview",
      mergeAttributes(HTMLAttributes),
      [
        "a",
        {
          href: HTMLAttributes.url,
          target: "_blank",
          rel: "noopener noreferrer",
          class: cn(
            CARD_INTERACTIVE,
            "not-prose p-0 overflow-hidden flex flex-col sm:flex-row my-4",
          ),
        },
        [
          "div",
          {
            class:
              "sm:w-48 h-32 sm:h-auto shrink-0 overflow-hidden relative bg-surface-container flex items-center justify-center",
          },
          HTMLAttributes.image
            ? [
                "img",
                {
                  src: HTMLAttributes.image,
                  class: "w-full h-full object-cover",
                },
              ]
            : ["span", { class: LABEL }, "LINK"],
        ],
        [
          "div",
          { class: "p-4 flex-1 min-w-0 flex flex-col justify-center" },
          [
            "div",
            { class: "font-bold text-sm text-on-surface truncate mb-1" },
            HTMLAttributes.title || HTMLAttributes.url || "",
          ],
          [
            "div",
            {
              class:
                "text-xs text-on-surface-variant line-clamp-2 leading-relaxed mb-2",
            },
            HTMLAttributes.description || "",
          ],
          [
            "div",
            { class: cn(LABEL_PRIMARY, "truncate mt-auto") },
            (HTMLAttributes.url || "").split("/")[2] || HTMLAttributes.url,
          ],
        ],
      ],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(LinkPreviewComponent);
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("linkPreviewPaste"),
        props: {
          handlePaste: (view, event) => {
            const clipboardData = event.clipboardData;
            if (!clipboardData) return false;

            const text = clipboardData.getData("text/plain");
            // Basic URL regex
            const urlRegex = /^https?:\/\/[^\s]+$/i;

            if (urlRegex.test(text.trim())) {
              const url = text.trim();
              const { tr } = view.state;

              // Insert custom node immediately
              const node = this.type.create({ url, loading: true });
              tr.replaceSelectionWith(node);

              // Move cursor natively after the node safely closing context
              tr.insertText(" ");
              view.dispatch(tr);

              // Prevent standard paste text logic natively avoiding duplicates
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});
