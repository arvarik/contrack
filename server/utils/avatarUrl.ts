// The same-origin address of a generated avatar, apart from
// services/avatarService, which loads the DiceBear artwork: a URL needs none of
// it, and the database's boot migration builds URLs before anything renders.

import { lookFromPronouns, type AvatarLook } from "./smartAvatar.ts";
import type { AvatarStyle, AvatarTheme } from "../services/avatarService.ts";

/** A look in one letter, for the avatar URL: `look=f`, `m` or `n`. */
const LOOK_PARAM: Record<AvatarLook, string> = {
  female: "f",
  male: "m",
  neutral: "n",
};

/** Read a `look` query value. Anything unrecognized means "decide from the seed". */
export function parseAvatarLook(value: unknown): AvatarLook | undefined {
  if (typeof value !== "string") return undefined;
  return (Object.keys(LOOK_PARAM) as AvatarLook[]).find(
    (look) => LOOK_PARAM[look] === value,
  );
}

/**
 * The app-relative URL that renders `seed` in `style`.
 *
 * Same-origin by construction: no contact name leaves the machine.
 */
export function buildAvatarUrl(
  seed: string,
  style: AvatarStyle = "avataaars",
  options: {
    background?: boolean;
    theme?: AvatarTheme;
    look?: AvatarLook;
  } = {},
): string {
  const params = new URLSearchParams({ seed });
  if (options.background) params.set("bg", "1");
  if (options.theme) params.set("theme", options.theme);
  if (options.look) params.set("look", LOOK_PARAM[options.look]);
  return `/api/avatar/${style}?${params.toString()}`;
}

/**
 * The avatar a contact gets when nobody chose one. Pronouns go into the URL,
 * because the route sees only the seed. The name does not: the route reads it
 * at render time, so a better name table reaches every contact without
 * rewriting a row.
 */
export function defaultAvatarUrl(
  name: string,
  pronouns?: string | null,
): string {
  const look = lookFromPronouns(pronouns);
  return buildAvatarUrl(name, "avataaars", look ? { look } : {});
}

/**
 * True when `url` is the default avatar for a contact called `name`, with any
 * pronoun look. A face from the picker has `bg=1` and one of the picker's own
 * seeds, and a photo is an upload path, so neither matches; a rename or a
 * pronoun edit can redraw the default face without replacing a choice.
 */
export function isDefaultAvatarFor(
  url: string | null | undefined,
  name: string | null | undefined,
): boolean {
  if (!url || !name) return false;
  const [path, query = ""] = url.split("?");
  if (path !== "/api/avatar/avataaars") return false;
  const params = new URLSearchParams(query);
  for (const key of params.keys()) {
    if (key !== "seed" && key !== "look") return false;
  }
  return params.get("seed") === name;
}
