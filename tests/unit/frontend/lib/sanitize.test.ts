// @vitest-environment jsdom
// Unit: how a saved note's HTML is shown (`sanitizeNote` in src/lib/sanitize.ts).
// A tag the composer writes but the sanitizer does not allow loses its tag: a
// heading turns into plain text and a rule vanishes. The first test asks the
// real editor what it writes, so a tag that a later release adds shows up
// here. A link preview card needs `div` and `img`, so the display turns a
// saved card into a link first. The last tests save a card with the real
// editor and check what the display keeps.

import { describe, expect, it } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Mention from "@tiptap/extension-mention";
import { LinkPreviewExtension } from "../../../../src/components/LinkPreviewExtension";
import { sanitizeNote } from "../../../../src/lib/sanitize";

const text = (
  value: string,
  marks: { type: string; attrs?: Record<string, unknown> }[] = [],
): JSONContent => ({
  type: "text",
  text: value,
  ...(marks.length > 0 ? { marks } : {}),
});
const paragraph = (value: string): JSONContent => ({
  type: "paragraph",
  content: [text(value)],
});

describe("the note sanitizer", () => {
  it("keeps every tag and mark the composer's editor writes", () => {
    const editor = new Editor({
      extensions: [
        StarterKit,
        Mention.configure({ HTMLAttributes: { class: "mention" } }),
      ],
      content: {
        type: "doc",
        content: [
          ...[1, 2, 3, 4, 5, 6].map((level) => ({
            type: "heading",
            attrs: { level },
            content: [text(`Heading ${level}`)],
          })),
          { type: "horizontalRule" },
          {
            type: "paragraph",
            content: [
              text("bold", [{ type: "bold" }]),
              text(" "),
              text("italic", [{ type: "italic" }]),
              text(" "),
              text("underline", [{ type: "underline" }]),
              text(" "),
              text("strike", [{ type: "strike" }]),
              text(" "),
              text("code", [{ type: "code" }]),
              text(" "),
              text("link", [
                { type: "link", attrs: { href: "https://example.com" } },
              ]),
              { type: "hardBreak" },
              { type: "mention", attrs: { id: "42", label: "Ann" } },
            ],
          },
          { type: "blockquote", content: [paragraph("quote")] },
          {
            type: "bulletList",
            content: [{ type: "listItem", content: [paragraph("one")] }],
          },
          {
            type: "orderedList",
            content: [{ type: "listItem", content: [paragraph("two")] }],
          },
          { type: "codeBlock", content: [text("let x = 1;")] },
        ],
      },
    });
    const html = editor.getHTML();
    editor.destroy();

    expect(sanitizeNote(html)).toBe(html);
  });

  it("still removes scripts, handlers, unsafe links and frames", () => {
    const dirty =
      '<p onclick="steal()">hi<script>steal()</script><img src="x" onerror="steal()"><a href="javascript:steal()">go</a><iframe src="https://example.com"></iframe></p>';

    expect(sanitizeNote(dirty)).toBe("<p>hi<a>go</a></p>");
  });
});

describe("a saved link preview card", () => {
  /** What the real editor saves for a pasted link, between two paragraphs. */
  const saved = (card: Record<string, unknown>) => {
    const editor = new Editor({
      extensions: [StarterKit, LinkPreviewExtension],
      content: {
        type: "doc",
        content: [
          paragraph("before"),
          {
            type: "linkPreview",
            attrs: { image: null, loading: false, error: false, ...card },
          },
          paragraph("after"),
        ],
      },
    });
    const html = editor.getHTML();
    editor.destroy();
    return html;
  };
  const shown = (card: Record<string, unknown>) => {
    const box = document.createElement("div");
    box.innerHTML = sanitizeNote(saved(card));
    return box;
  };
  const post = {
    url: "https://example.com/post",
    title: "A title",
    description: "A description",
  };

  it("shows as a link with the page's title, between the text around it", () => {
    const box = shown(post);

    expect([...box.children].map((el) => el.tagName)).toEqual(["P", "P", "P"]);
    const link = box.querySelector("a")!;
    expect(link.textContent).toBe("A title");
    expect(link.getAttribute("href")).toBe("https://example.com/post");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(box.textContent).toBe("beforeA titleafter");
  });

  it("shows the address when the card has no title", () => {
    const box = shown({ url: post.url, title: null });

    expect(box.querySelector("a")!.textContent).toBe(post.url);
  });

  it("drops a card with no address", () => {
    // The editor cannot save one, but stored HTML can hold one.
    const box = document.createElement("div");
    box.innerHTML = sanitizeNote(
      "<p>before</p><link-preview><a>A title</a></link-preview><p>after</p>",
    );

    expect(box.querySelector("a")).toBeNull();
    expect(box.textContent).toBe("beforeafter");
  });

  it("leaves no card markup behind", () => {
    expect(sanitizeNote(saved(post))).not.toMatch(
      /link-preview|<div|<img|class=/,
    );
  });

  it("does not let a card carry a script link", () => {
    const box = shown({ url: "javascript:steal()", title: "Click me" });

    expect(box.querySelector("a")!.hasAttribute("href")).toBe(false);
  });
});
