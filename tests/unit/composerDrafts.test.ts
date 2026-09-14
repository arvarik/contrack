// @vitest-environment jsdom
// =============================================================================
// The draft store and the submission mark, on their own
// =============================================================================
// `frontend.composer.test.tsx` drives the composer as a person would. These
// pin the two pieces underneath it: the storage rules a draft has to obey to
// be safe in a shared browser, and the ProseMirror arithmetic that decides
// what a successful save removes.
// =============================================================================
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  DRAFT_KEY_PREFIX,
  MAX_DRAFT_AGE_MS,
  MAX_DRAFT_BYTES,
  clearDraft,
  draftKey,
  isEmptyDraft,
  readDraft,
  writeDraft,
} from "../../src/lib/composerDrafts";
import {
  markSubmission,
  removeSubmitted,
} from "../../src/lib/composerSubmission";

afterEach(() => localStorage.clear());

const draft = { html: "<p>hello</p>", followUpText: "", type: "note" as const };

describe("draft keys", () => {
  it("name the account and the contact, and never collide across either", () => {
    const key = draftKey("user-a", "contact-1");
    expect(key.startsWith(DRAFT_KEY_PREFIX)).toBe(true);
    expect(key).not.toBe(draftKey("user-b", "contact-1"));
    expect(key).not.toBe(draftKey("user-a", "contact-2"));
  });

  it("fall back to one local account when nobody is signed in", () => {
    expect(draftKey(null, "c")).toBe(draftKey(undefined, "c"));
    expect(draftKey("", "c")).toBe(draftKey(null, "c"));
    expect(draftKey("   ", "c")).toBe(draftKey(null, "c"));
    expect(draftKey("user-a", "c")).not.toBe(draftKey(null, "c"));
  });

  it("encode the ids, so a colon in one cannot read as the other", () => {
    expect(draftKey("a:b", "c")).not.toBe(draftKey("a", "b:c"));
  });
});

describe("reading and writing a draft", () => {
  it("round-trips, under the account that wrote it only", () => {
    const mine = draftKey("user-a", "contact-1");
    expect(writeDraft(mine, draft)).toBe(true);
    expect(readDraft(mine)).toMatchObject(draft);
    expect(readDraft(draftKey("user-b", "contact-1"))).toBeNull();
    expect(readDraft(draftKey("user-a", "contact-2"))).toBeNull();
  });

  it("removes the key rather than writing an empty draft", () => {
    const key = draftKey("user-a", "contact-1");
    writeDraft(key, draft);
    expect(writeDraft(key, { ...draft, html: "<p></p>" })).toBe(true);
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("treats a bare paragraph and whitespace as empty", () => {
    expect(isEmptyDraft({ html: "", followUpText: "" })).toBe(true);
    expect(isEmptyDraft({ html: "<p></p>", followUpText: "  " })).toBe(true);
    expect(isEmptyDraft({ html: "<p></p>", followUpText: "call" })).toBe(false);
    expect(isEmptyDraft({ html: "<p>x</p>", followUpText: "" })).toBe(false);
  });

  it("tolerates a value that is not a draft", () => {
    const key = draftKey("user-a", "contact-1");
    for (const raw of [
      "not json",
      "null",
      "[]",
      '{"html":1}',
      '{"html":"<p>x</p>","followUpText":"","type":"tweet"}',
    ]) {
      localStorage.setItem(key, raw);
      expect(readDraft(key), raw).toBeNull();
      // And it is cleared, so the bad value does not sit there for ever.
      expect(localStorage.getItem(key), raw).toBeNull();
    }
  });

  it("refuses a draft over the size cap and leaves the old one alone", () => {
    const key = draftKey("user-a", "contact-1");
    writeDraft(key, draft);
    const huge = { ...draft, html: `<p>${"x".repeat(MAX_DRAFT_BYTES)}</p>` };
    expect(writeDraft(key, huge)).toBe(false);
    expect(readDraft(key)).toMatchObject(draft);
  });

  it("discards a draft nobody touched for a month", () => {
    const key = draftKey("user-a", "contact-1");
    const written = 1_000_000_000_000;
    writeDraft(key, draft, written);
    expect(readDraft(key, written + MAX_DRAFT_AGE_MS - 1)).toMatchObject(draft);
    expect(readDraft(key, written + MAX_DRAFT_AGE_MS + 1)).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("survives storage that throws", () => {
    const key = draftKey("user-a", "contact-1");
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException("quota", "QuotaExceededError");
    };
    try {
      expect(writeDraft(key, draft)).toBe(false);
      expect(() => clearDraft(key)).not.toThrow();
      expect(readDraft(key)).toBeNull();
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});

describe("the submission mark", () => {
  function editorWith(html: string): Editor {
    return new Editor({ extensions: [StarterKit], content: html });
  }

  it("clears everything when nothing was typed meanwhile", () => {
    const editor = editorWith("<p>hello</p>");
    const mark = markSubmission(editor);
    removeSubmitted(editor, mark);
    expect(editor.isEmpty).toBe(true);
    editor.destroy();
  });

  it("keeps text typed into the same paragraph, without its leading space", () => {
    const editor = editorWith("<p>hello</p>");
    const mark = markSubmission(editor);
    editor.commands.insertContentAt(mark.end(), " world");
    removeSubmitted(editor, mark);
    expect(editor.getHTML()).toBe("<p>world</p>");
    editor.destroy();
  });

  it("keeps a paragraph started after the submitted one", () => {
    const editor = editorWith("<p>hello</p><ul><li><p>item</p></li></ul>");
    const mark = markSubmission(editor);
    editor.commands.insertContentAt(
      editor.state.doc.content.size,
      "<p>next</p>",
    );
    removeSubmitted(editor, mark);
    expect(editor.getHTML()).toBe("<p>next</p>");
    editor.destroy();
  });

  it("keeps text typed after a follow-up-only submission", () => {
    // An empty editor was submitted with a follow-up. Typing that starts
    // during the save is entirely new and all of it stays.
    const editor = editorWith("");
    const mark = markSubmission(editor);
    editor.commands.insertContentAt(mark.end(), "started typing");
    removeSubmitted(editor, mark);
    expect(editor.getHTML()).toBe("<p>started typing</p>");
    editor.destroy();
  });

  it("removes an edit made inside the submitted text along with it", () => {
    // The server holds the note as it was sent. A word inserted into the
    // middle of it afterwards is a change to a note that has already left.
    const editor = editorWith("<p>hello</p>");
    const mark = markSubmission(editor);
    editor.commands.insertContentAt(3, "XX");
    expect(editor.getHTML()).toBe("<p>heXXllo</p>");
    removeSubmitted(editor, mark);
    expect(editor.isEmpty).toBe(true);
    editor.destroy();
  });

  it("stops following the document once told to", () => {
    const editor = editorWith("<p>hello</p>");
    const mark = markSubmission(editor);
    const before = mark.end();
    mark.stop();
    mark.stop();
    editor.commands.insertContentAt(0, "<p>above</p>");
    expect(mark.end()).toBe(before);
    editor.destroy();
  });
});
