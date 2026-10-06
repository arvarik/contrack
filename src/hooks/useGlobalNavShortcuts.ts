/**
 * useGlobalNavShortcuts — Global keyboard shortcuts for page navigation.
 *
 * Every shortcut holds two modifiers and a letter, so no letter typed into a
 * field can reach it. A Mac holds Cmd+Shift. Windows and Linux hold Ctrl+Alt,
 * because the browser keeps Ctrl+Shift+P and Ctrl+Shift+M for itself
 * (`lib/platform` says why). Both forms work everywhere, and the labels show
 * the form of the platform the page runs on.
 * Called once in App.tsx inside the Router context.
 *
 * Shortcut map (Mac form, then the Windows and Linux form):
 *   Cmd+Shift+H, Ctrl+Alt+H → Network (/)
 *   Cmd+Shift+P, Ctrl+Alt+P → Pulse (/pulse)
 *   Cmd+Shift+M, Ctrl+Alt+M → Map (/map)
 *   Cmd+Shift+S, Ctrl+Alt+S → Ask Contrack (/search)
 *   Cmd+Shift+, Ctrl+Alt+, → Settings (/settings)
 *   Cmd+[                  → Browser back
 *   Cmd+]                  → Browser forward
 *
 * Back and forward need no Windows or Linux form: there, the browser's own
 * Alt+Left and Alt+Right go back and forward.
 *
 * The labels come from `lib/names`, the one place a destination is named, so
 * the palette's hints match the sidebar and the page headings.
 *
 * @module src/hooks/useGlobalNavShortcuts
 */
import { useContext, useEffect, useTransition } from "react";
import { useNavigate } from "react-router-dom";
import { QueryClientContext } from "@tanstack/react-query";
import { markPendingNav } from "../lib/pendingNav";
import { warmPage } from "../views/pages";
import { chordLabel, NAV_MODIFIERS, navChordKey } from "../lib/platform";

/** The label of a navigation chord on this platform: ⌘⇧H, or Ctrl+Alt+H. */
const navLabel = (key: string) => chordLabel([...NAV_MODIFIERS, key]);

/** Shortcut definitions — exported for reuse in ZeroStateView KBD hints */
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
      // ── Cmd+Shift+Letter, or Ctrl+Alt+Letter, navigation ──
      const path = CHORD_PATHS[navChordKey(e)];
      if (path) {
        e.preventDefault();
        go(path);
        return;
      }

      // ── Cmd+[ / Cmd+] browser navigation ──
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
