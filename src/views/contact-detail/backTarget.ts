/** Where the contact page's Back goes, and the words on it. */
import { NAMES } from "../../lib/names";

/** The title of the archived contacts page in Settings. */
const ARCHIVED_LABEL = "Archived contacts";

interface BackTarget {
  to: string;
  label: string;
}

/**
 * Where Back goes and its words stay together, so the button never names
 * one page and opens another. A page that opens a contact from its own list
 * (Enrichment, with its filters) passes `{ back: { to, label } }` in the
 * link state. Only a path inside the app counts: "//" and "/\" start
 * another site's address. Otherwise the route decides.
 */
export function backTarget(
  pathname: string,
  state: unknown,
  search = "",
): BackTarget {
  const opener = (
    state as { back?: Partial<Record<keyof BackTarget, unknown>> } | null
  )?.back;
  if (
    typeof opener?.to === "string" &&
    typeof opener.label === "string" &&
    opener.to.startsWith("/") &&
    !/^\/[/\\]/.test(opener.to)
  )
    return { to: opener.to, label: opener.label };
  if (pathname.startsWith("/settings/archived"))
    return { to: "/settings/archived", label: ARCHIVED_LABEL };
  if (pathname.startsWith("/map"))
    return { to: `/map${search}`, label: NAMES.map.label };
  return { to: `/${search}`, label: NAMES.network.label };
}
