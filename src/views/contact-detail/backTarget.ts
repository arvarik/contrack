/**
 * Where the contact page's Back goes, and the words on it.
 *
 * @module views/contact-detail/backTarget
 */
import { NAMES } from "../../lib/names";

/** The title of the archived contacts page in Settings. */
const ARCHIVED_LABEL = "Archived contacts";

/** Where Back goes, and the words on it. */
interface BackTarget {
  to: string;
  label: string;
}

/**
 * Where Back goes, and the name the button says. The two stay together so
 * the button never names one page and opens another.
 *
 * A page that opens a contact from a list of its own names itself in the
 * link's state, `{ back: { to, label } }`, so Back returns to that list: the
 * Enrichment page does, with its filters. Only a path inside the app is
 * taken: "//" and "/\" start another site's address in a browser.
 * Otherwise the route decides: the archived list, the map with its filter
 * (`search`), or the network.
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
  return { to: "/", label: NAMES.network.label };
}
