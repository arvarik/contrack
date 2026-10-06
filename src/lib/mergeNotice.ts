/**
 * The message a person gets when Contrack merged a contact by itself.
 *
 * A contact added by hand is checked a few seconds later, and when it is
 * the same person as one that existed, it can merge into that one with
 * nobody asked. Imports and checks say what they merged. This did not: the
 * new contact's page stayed on screen, every edit on it failed, and nothing
 * said why. Now the person hears it once, with Undo, wherever they are.
 *
 * An Undo here means the two are different people, so nothing merges them
 * again.
 *
 * @module lib/mergeNotice
 */
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  fetchMergedInto,
  refreshDuplicates,
  undoMerges,
  type MergedInto,
} from "../api/suggestions";
import { withUndo } from "./undoToast";
import { errorText } from "./errorText";

/**
 * When to ask whether a new contact merged: after the check that runs five
 * seconds after a contact is added (`DEDUPE_CHECK_DELAY_MS` on the server),
 * and once more for an account large enough to make the check slow.
 */
const ASK_AFTER_MS = [8_000, 20_000];

/** The message's id, so the two places that notice one merge show one. */
const noticeId = (merge: MergedInto) =>
  `merged-${merge.mergeLogId ?? merge.primaryId}`;

/** The Undo of a merge Contrack made: the two stay different people. */
function undoOptions(
  qc: QueryClient,
  merge: MergedInto,
  afterUndo?: () => void,
) {
  const id = merge.mergeLogId;
  if (!id) return {};
  return withUndo(() => {
    void undoMerges(qc, [id], true)
      .then(() => afterUndo?.())
      .catch((err: unknown) =>
        toast.error(`Could not undo: ${errorText(err)}`),
      );
  });
}

/**
 * Tell a person that a merged contact's page is now the kept contact's,
 * with Undo that brings the contact back and opens it.
 */
export function announceMergedPage(
  qc: QueryClient,
  name: string,
  merge: MergedInto,
  afterUndo: () => void,
): void {
  toast(`${name} was merged into ${merge.primaryName}`, {
    id: noticeId(merge),
    description:
      merge.mergedBy === "auto"
        ? "Contrack found they are one person"
        : "Merged by you",
    ...undoOptions(qc, merge, afterUndo),
  });
}

/**
 * Watch a contact a person just added. If the check merges it into one
 * that existed, say so, with Undo, and refresh what shows contacts.
 */
export function watchNewContact(
  qc: QueryClient,
  contact: { id: string; name: string },
): void {
  const ask = async (attempt: number) => {
    let merge: MergedInto | null;
    try {
      merge = await fetchMergedInto(contact.id);
    } catch {
      return; // Signed out, or offline: nothing to tell.
    }
    if (merge) {
      refreshDuplicates(qc, { contacts: true });
      toast(`${contact.name} was already in your contacts`, {
        id: noticeId(merge),
        description: `Merged into the ${merge.primaryName} you had`,
        ...undoOptions(qc, merge),
      });
      return;
    }
    const next = attempt + 1;
    if (next < ASK_AFTER_MS.length) {
      window.setTimeout(
        () => void ask(next),
        ASK_AFTER_MS[next] - ASK_AFTER_MS[attempt],
      );
    }
  };
  window.setTimeout(() => void ask(0), ASK_AFTER_MS[0]);
}
