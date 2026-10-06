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
import { useMergedInto } from "../../../api";
import { announceMergedPage } from "../../../lib/mergeNotice";
import type { Contact } from "../../../types";

/** True while the page is on its way to the contact this one merged into. */
export function useMergedRedirect(
  contact: Contact | undefined,
  id: string,
): boolean {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const mergedAway = Boolean(contact?.canonicalId);
  const { data: merge, isFetched } = useMergedInto(id, mergedAway);
  const name = contact?.name ?? "This contact";
  const fallback = contact?.canonicalId ?? null;

  useEffect(() => {
    if (!mergedAway || !isFetched) return;
    const base = pathname.startsWith("/map/contact/")
      ? "/map/contact/"
      : "/contact/";
    if (merge) {
      announceMergedPage(qc, name, merge, () =>
        navigate(`${base}${id}`, { replace: true }),
      );
      navigate(`${base}${merge.primaryId}`, { replace: true });
    } else if (fallback) {
      navigate(`${base}${fallback}`, { replace: true });
    }
  }, [
    mergedAway,
    isFetched,
    merge,
    fallback,
    name,
    id,
    pathname,
    navigate,
    qc,
  ]);

  return mergedAway;
}
