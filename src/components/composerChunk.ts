/**
 * The composer's chunk, shared by the contact page and the quick note dialog.
 *
 * The composer carries TipTap and ProseMirror, so it arrives in its own
 * chunk. It was a plain `React.lazy` in each place, and a lazy component
 * suspends on each first render, even with its code in memory. The contact
 * page is built anew on each return to the Network page, so each return
 * drew `ComposerPlaceholder`, pale and inert, and swapped the editor in a
 * few frames later. As a `preloadable` it renders at once when its code is
 * here, and one load serves both places.
 *
 * @module components/composerChunk
 */
import type { ComponentProps } from "react";
import { preloadable } from "../lib/preloadable";
import type { InteractionComposer, NoteEditor } from "./InteractionComposer";

export const composerChunk = preloadable<
  ComponentProps<typeof InteractionComposer>
>(() =>
  import("./InteractionComposer").then((m) => ({
    default: m.InteractionComposer,
  })),
);

/** The editor alone, from the same chunk, for the timeline's note overlay. */
export const noteEditorChunk = preloadable<ComponentProps<typeof NoteEditor>>(
  () =>
    import("./InteractionComposer").then((m) => ({ default: m.NoteEditor })),
);
