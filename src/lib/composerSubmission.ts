/**
 * Which part of the editor a save sent, so only that part is cleared. The
 * editor stays editable while a save is out, so the composer marks where the
 * submitted content ends, follows the mark through every edit, and on
 * success removes only the range before it. A failed save clears nothing.
 *
 * The mark is the last cursor position, not the document size: a
 * paragraph's closing token sits after text typed into it, so a mark on the
 * size would take the new text. An insertion at the mark stays after it
 * (the `-1` in the mapping).
 */
import type { Editor } from "@tiptap/core";
import { Selection, type Transaction } from "@tiptap/pm/state";

interface SubmissionMark {
  /** Where the submitted content ends now, after every edit since. */
  end(): number;
  /** Stop following the document. Idempotent. */
  stop(): void;
}

/** Record where the content being submitted ends, and follow it. */
export function markSubmission(editor: Editor): SubmissionMark {
  let end = Selection.atEnd(editor.state.doc).from;
  let active = true;
  const track = ({ transaction }: { transaction: Transaction }) => {
    if (transaction.docChanged) end = transaction.mapping.map(end, -1);
  };
  editor.on("transaction", track);
  return {
    end: () => end,
    stop: () => {
      if (!active) return;
      active = false;
      editor.off("transaction", track);
    },
  };
}

/**
 * Remove the submitted content and keep whatever came after it.
 *
 * Text typed into the same paragraph as the submitted note is left with the
 * paragraph's leading whitespace removed, so " world" typed after "hello"
 * comes back as "world". An edit made inside the submitted text is removed
 * with it: the server already holds that note as it was sent.
 */
export function removeSubmitted(editor: Editor, mark: SubmissionMark): void {
  mark.stop();
  if (editor.isDestroyed) return;
  const end = Math.min(mark.end(), editor.state.doc.content.size);
  editor.commands.command(({ tr }) => {
    if (end > 0) tr.delete(0, end);
    const first = tr.doc.firstChild;
    if (first?.isTextblock && first.firstChild?.isText) {
      const leading = /^\s+/.exec(first.firstChild.text ?? "");
      if (leading) tr.delete(1, 1 + leading[0].length);
    }
    return true;
  });
  if (editor.isEmpty) editor.commands.clearContent(true);
}
