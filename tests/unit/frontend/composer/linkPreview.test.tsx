// @vitest-environment jsdom
// Link preview cards draw only the server's own copy of an image. The server
// stores each preview image under /uploads/, but an older note can still carry
// the linked site's image URL, which would load a third-party image each time
// the note opens. So the card draws an <img> only for a same-origin /uploads/
// path, in the editor's React node view and in the HTML the editor saves.

import { afterEach, describe, expect, it } from "vitest";
import React from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorContent, useEditor } from "@tiptap/react";
import { LinkPreviewExtension } from "../../../../src/components/LinkPreviewExtension";
import { isLocalUploadUrl } from "../../../../src/lib/localImage";

const REMOTE = "https://cdn.tracker.example/og.png";
const LOCAL =
  "/uploads/u/33333333-3333-4333-8333-333333333333/previews/abc.jpg";

/** A document holding one finished preview card. */
function doc(image: string | null) {
  return {
    type: "doc",
    content: [
      {
        type: "linkPreview",
        attrs: {
          url: "https://news.example.com/story",
          title: "A story",
          description: "What happened",
          image,
          loading: false,
          error: false,
        },
      },
    ],
  };
}

function Card({ image }: { image: string | null }) {
  const editor = useEditor({
    extensions: [StarterKit, LinkPreviewExtension],
    content: doc(image),
    immediatelyRender: true,
  });
  return <EditorContent editor={editor} />;
}

afterEach(cleanup);

describe("isLocalUploadUrl", () => {
  it("accepts only a same-origin /uploads/ path", () => {
    expect(isLocalUploadUrl(LOCAL)).toBe(true);
    expect(isLocalUploadUrl(REMOTE)).toBe(false);
    expect(isLocalUploadUrl("//cdn.tracker.example/uploads/x.png")).toBe(false);
    expect(isLocalUploadUrl("uploads/x.png")).toBe(false);
    expect(isLocalUploadUrl("")).toBe(false);
    expect(isLocalUploadUrl(null)).toBe(false);
  });
});

describe("LinkPreviewExtension node view", () => {
  it("draws the local copy", async () => {
    const { container } = render(<Card image={LOCAL} />);
    const img = await waitFor(() => {
      const found = container.querySelector("img");
      if (!found) throw new Error("card not drawn yet");
      return found;
    });
    expect(img.getAttribute("src")).toBe(LOCAL);
  });

  it("draws the placeholder, and no <img>, for a remote image URL", async () => {
    const { container } = render(<Card image={REMOTE} />);
    await waitFor(() => {
      if (!container.textContent?.includes("A story")) {
        throw new Error("card not drawn yet");
      }
    });
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).not.toContain("<img");
  });
});

describe("LinkPreviewExtension saved HTML", () => {
  function savedHtml(image: string | null): string {
    const editor = new Editor({
      extensions: [StarterKit, LinkPreviewExtension],
      content: doc(image),
    });
    const html = editor.getHTML();
    editor.destroy();
    return html;
  }

  it("keeps the <img> for a local copy", () => {
    expect(savedHtml(LOCAL)).toContain(`<img src="${LOCAL}"`);
  });

  it("emits no <img> for a remote image URL", () => {
    const html = savedHtml(REMOTE);
    expect(html).not.toContain("<img");
    expect(html).toContain("LINK");
  });
});
