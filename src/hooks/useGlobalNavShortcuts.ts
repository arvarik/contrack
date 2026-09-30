/**
 * useGlobalNavShortcuts — Global keyboard shortcuts for page navigation.
 *
 * All shortcuts use Cmd+Shift+Letter to guarantee zero collision with typing.
 * Called once in App.tsx inside the Router context.
 *
 * Shortcut map:
 *   Cmd+Shift+H → Network (/)
 *   Cmd+Shift+P → Pulse (/pulse)
 *   Cmd+Shift+M → Map (/map)
 *   Cmd+Shift+S → Ask Contrack (/search)
 *   Cmd+Shift+, → Settings (/settings)
 *
 * The labels come from `lib/names`, the one place a destination is named, so
 * the palette's hints match the sidebar and the page headings.
 *   Cmd+[       → Browser back
 *   Cmd+]       → Browser forward
 *
 * @module src/hooks/useGlobalNavShortcuts
 */
import { useContext, useEffect, useTransition } from "react";
import { useNavigate } from "react-router-dom";
import { QueryClientContext } from "@tanstack/react-query";
import { markPendingNav } from "../lib/pendingNav";
import { warmPage } from "../views/pages";

/** Shortcut definitions — exported for reuse in ZeroStateView KBD hints */
export const NAV_SHORTCUTS: Record<string, { keys: string }> = {
  "/": { keys: "⌘⇧H" },
  "/pulse": { keys: "⌘⇧P" },
  "/map": { keys: "⌘⇧M" },
  "/search": { keys: "⌘⇧S" },
  "/settings": { keys: "⌘⇧," },
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
      // ── Cmd+Shift+Letter navigation ──
      if (e.metaKey && e.shiftKey && !e.altKey) {
        const key = e.key.toLowerCase();

        switch (key) {
          case "h":
            e.preventDefault();
            go("/");
            return;
          case "p":
            e.preventDefault();
            go("/pulse");
            return;
          case "m":
            e.preventDefault();
            go("/map");
            return;
          case "s":
            e.preventDefault();
            go("/search");
            return;
          case ",":
            e.preventDefault();
            go("/settings");
            return;
        }
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
