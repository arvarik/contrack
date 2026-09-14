/**
 * Which part of the editor a save sent, so only that part is cleared.
 *
 * A save is asynchronous and the editor stays editable while it is out. The
 * composer used to clear everything the moment the request started, which
 * lost the note when the request failed and lost anything typed meanwhile
 * when it succeeded. Now the composer marks where the submitted content ends,
 * follows that mark through every edit made while the request is out, and on
 * success removes exactly the range in front of it.
 *
 * The mark is the last cursor position of the submitted document, not the
 * document size. A paragraph's closing token sits after any text typed into
 * that paragraph, so a mark on the size would move past the new text and the
 * clear would take it. Insertions exactly at the mark stay after it, which is
 * what `-1` asks the mapping for.
 *
 * @module lib/composerSubmission
 */
import type { Editor } from "@tiptap/core";
import { Selection, type Transaction } from "@tiptap/pm/state";

export interface SubmissionMark {
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
