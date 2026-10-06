/**
 * A merged contact's old link opens the contact it merged into.
 *
 * A merged contact is hidden, not deleted, so that Undo can bring it back,
 * and its page used to open as if nothing had happened: every edit on it
 * failed, and nothing said why. A link in a note, a bookmark or the page of
 * a contact that merged a moment ago all land here. The page asks where the
 * contact went, goes there, and says so, with Undo.
 *
 * @module views/contact-detail/components/useMergedRedirect
 */
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { forgetMerge, useMergedInto } from "../../../api";
import { announceMergedPage } from "../../../lib/mergeNotice";
import type { Contact } from "../../../types";

/**
 * True while the page is on its way to the contact this one merged into.
 *
 * It acts only on fresh answers: the contact as the server has it now, and
 * where it went. After an undo the cache still held the merged contact, and
 * the page went straight back to the kept one.
 */
export function useMergedRedirect(
  contact: Contact | undefined,
  id: string,
  contactFetching: boolean,
): boolean {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const mergedAway = Boolean(contact?.canonicalId) && !contactFetching;
  const {
    data: merge,
    isFetchedAfterMount,
    isFetching,
  } = useMergedInto(id, mergedAway);
  const name = contact?.name ?? "This contact";

  useEffect(() => {
    if (!mergedAway || !isFetchedAfterMount || isFetching || !merge) return;
    const base = pathname.startsWith("/map/contact/")
      ? "/map/contact/"
      : "/contact/";
    announceMergedPage(qc, name, merge, () => {
      forgetMerge(qc, id);
      navigate(`${base}${id}`, { replace: true });
    });
    navigate(`${base}${merge.primaryId}`, { replace: true });
  }, [
    mergedAway,
    isFetchedAfterMount,
    isFetching,
    merge,
    name,
    id,
    pathname,
    navigate,
    qc,
  ]);

  return mergedAway && merge !== null;
}
