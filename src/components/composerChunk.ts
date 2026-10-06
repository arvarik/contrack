/**
 * The composer's chunk (TipTap and ProseMirror), shared by the contact page
 * and the quick note dialog. A `preloadable`, not `React.lazy`, which
 * suspends on each first render even with its code in memory.
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
