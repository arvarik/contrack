/**
 * A merged contact's old link opens the contact it merged into, and says so,
 * with Undo. A merged contact is hidden, not deleted, so Undo can bring it
 * back, and every edit on its own page would fail.
 */
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { forgetMerge, useMergedInto } from "../../../api";
import { announceMergedPage } from "../../../lib/mergeNotice";
import type { Contact } from "../../../types";

/**
 * True while the page is on its way to the contact this one merged into. It
 * acts only on fresh answers: after an undo the cache still holds the merged
 * contact, which would send the page straight back to the kept one.
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
