/**
 * useGlobalNavShortcuts — Global keyboard shortcuts for page navigation.
 *
 * All shortcuts use Cmd+Shift+Letter to guarantee zero collision with typing.
 * Called once in App.tsx inside the Router context.
 *
 * Shortcut map:
 *   Cmd+Shift+N → Network (/)
 *   Cmd+Shift+P → Pulse (/pulse)
 *   Cmd+Shift+M → Map (/map)
 *   Cmd+Shift+S → AI Search (/search)
 *   Cmd+Shift+, → Settings (/settings)
 *   Cmd+[       → Browser back
 *   Cmd+]       → Browser forward
 *
 * @module src/hooks/useGlobalNavShortcuts
 */
import { useEffect, useTransition } from "react";
import { useNavigate } from "react-router-dom";

/** Shortcut definitions — exported for reuse in ZeroStateView KBD hints */
export const NAV_SHORTCUTS: Record<string, { path: string; label: string; keys: string }> = {
  "/": { path: "/", label: "Network", keys: "⌘⇧H" },
  "/pulse": { path: "/pulse", label: "Relationship Pulse", keys: "⌘⇧P" },
  "/map": { path: "/map", label: "Map", keys: "⌘⇧M" },
  "/search": { path: "/search", label: "AI Search", keys: "⌘⇧S" },
  "/settings": { path: "/settings", label: "Settings", keys: "⌘⇧," },
};

export const useGlobalNavShortcuts = () => {
  const navigate = useNavigate();
  const [_, startTransition] = useTransition();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // ── Cmd+Shift+Letter navigation ──
      if (e.metaKey && e.shiftKey && !e.altKey) {
        const key = e.key.toLowerCase();

        switch (key) {
          case "h":
            e.preventDefault();
            startTransition(() => navigate("/"));
            return;
          case "p":
            e.preventDefault();
            startTransition(() => navigate("/pulse"));
            return;
          case "m":
            e.preventDefault();
            startTransition(() => navigate("/map"));
            return;
          case "s":
            e.preventDefault();
            startTransition(() => navigate("/search"));
            return;
          case ",":
            e.preventDefault();
            startTransition(() => navigate("/settings"));
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
  }, [navigate]);
};
