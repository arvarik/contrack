// @vitest-environment jsdom
// Unit: the DOMPurify settings for a note's rich text (src/lib/sanitize.ts).
// A note shows through them. A tag the composer writes but they do not allow
// loses its tag: a heading turns into plain text and a rule vanishes. The
// first test asks the real editor what it writes, so a tag that a later
// release adds shows up here. A link preview card is not in this test: it
// needs `div` and `img`.

import { describe, expect, it } from "vitest";
import DOMPurify from "dompurify";
import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Mention from "@tiptap/extension-mention";
import { TIPTAP_SANITIZE_CONFIG } from "../../../../src/lib/sanitize";

const clean = (html: string) =>
  DOMPurify.sanitize(html, TIPTAP_SANITIZE_CONFIG);

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

    expect(clean(html)).toBe(html);
  });

  it("still removes scripts, handlers, unsafe links and frames", () => {
    const dirty =
      '<p onclick="steal()">hi<script>steal()</script><img src="x" onerror="steal()"><a href="javascript:steal()">go</a><iframe src="https://example.com"></iframe></p>';

    expect(clean(dirty)).toBe("<p>hi<a>go</a></p>");
  });
});
