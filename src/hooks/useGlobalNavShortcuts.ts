/**
 * The global navigation shortcuts. Each holds two modifiers and a key, so no
 * letter typed into a field can reach it: Cmd+Shift on a Mac, Ctrl+Alt on
 * Windows and Linux, because the browser keeps Ctrl+Shift+P and
 * Ctrl+Shift+M (`lib/platform`). Both forms work everywhere. Cmd+[ and Cmd+]
 * go back and forward. Windows and Linux need no form of those: the
 * browser's Alt+Left and Alt+Right already do it. Called once in App.tsx,
 * inside the Router.
 */
import { useContext, useEffect, useTransition } from "react";
import { useNavigate } from "react-router-dom";
import { QueryClientContext } from "@tanstack/react-query";
import { markPendingNav } from "../lib/pendingNav";
import { warmPage } from "../views/pages";
import { chordLabel, NAV_MODIFIERS, navChordKey } from "../lib/platform";

/** The label of a navigation chord on this platform: ⌘⇧H, or Ctrl+Alt+H. */
const navLabel = (key: string) => chordLabel([...NAV_MODIFIERS, key]);

/** Each page's chord label, for the sidebar's and the palette's key hints. */
export const NAV_SHORTCUTS: Record<string, { keys: string }> = {
  "/": { keys: navLabel("H") },
  "/pulse": { keys: navLabel("P") },
  "/map": { keys: navLabel("M") },
  "/search": { keys: navLabel("S") },
  "/settings": { keys: navLabel(",") },
};

/** The page each chord's key opens. */
const CHORD_PATHS: Record<string, string> = {
  h: "/",
  p: "/pulse",
  m: "/map",
  s: "/search",
  ",": "/settings",
};

export const useGlobalNavShortcuts = () => {
  const navigate = useNavigate();
  const [_, startTransition] = useTransition();
  const queryClient = useContext(QueryClientContext);

  useEffect(() => {
    // The rail marks the page at once, and its code and first data start
    // together rather than one after the other (`views/pages`).
    const go = (path: string) => {
      warmPage(path, queryClient);
      markPendingNav(path);
      startTransition(() => navigate(path));
    };

    const handler = (e: KeyboardEvent) => {
      // Cmd+Shift+Letter, or Ctrl+Alt+Letter: a page.
      const path = CHORD_PATHS[navChordKey(e)];
      if (path) {
        e.preventDefault();
        go(path);
        return;
      }

      // Cmd+[ and Cmd+]: back and forward.
      if (e.metaKey && !e.shiftKey && !e.altKey) {
        if (e.key === "[") {
          e.preventDefault();
          startTransition(() => navigate(-1));
          return;
        }
        if (e.key === "]") {
          e.preventDefault();
          startTransition(() => navigate(1));
          return;
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate, queryClient]);
};
