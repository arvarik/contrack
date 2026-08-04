import React, { useEffect, useState } from "react";
import { Lock, LogIn } from "lucide-react";

// =============================================================================
// AuthGate — token sign-in screen shown when the server enforces auth
// =============================================================================
// On mount, asks /api/auth/status (always reachable). When auth is required
// and the browser has no valid cookie, renders a token form; POST /api/auth/
// login sets an HttpOnly cookie and the app proceeds. When the server runs
// without auth (default local setup) this renders children immediately.
// =============================================================================

type GateState = "checking" | "locked" | "open";

export const AuthGate = ({ children }: { children: React.ReactNode }) => {
  const [state, setState] = useState<GateState>("checking");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/status")
      .then((res) => res.json())
      .then((status: { authRequired: boolean; authenticated: boolean }) => {
        if (cancelled) return;
        setState(
          status.authRequired && !status.authenticated ? "locked" : "open",
        );
      })
      .catch(() => {
        // Status unreachable (server restarting?) — don't lock the UI.
        if (!cancelled) setState("open");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });
      if (!res.ok) {
        setError(
          "That token was not accepted. Check the server logs or your AUTH_TOKEN.",
        );
        return;
      }
      // Full reload so every query starts fresh with the cookie present.
      window.location.reload();
    } catch {
      setError("Could not reach the server. Is it running?");
    } finally {
      setSubmitting(false);
    }
  };

  if (state === "checking") return null;
  if (state === "open") return <>{children}</>;

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-6 text-on-surface">
      <form
        onSubmit={handleSubmit}
        className="max-w-sm w-full bg-surface-container-low rounded-3xl p-8 shadow-xl space-y-5"
      >
        <div className="w-14 h-14 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto">
          <Lock className="w-7 h-7" />
        </div>
        <div className="text-center space-y-1">
          <h1 className="text-xl font-extrabold font-headline">
            Contrack is locked
          </h1>
          <p className="text-sm text-on-surface-variant">
            Enter your access token to continue. It's in the server logs on
            first boot, or in your <code>AUTH_TOKEN</code> setting.
          </p>
        </div>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Access token"
          autoFocus
          className="w-full px-4 py-3 rounded-xl bg-surface-container-highest text-sm font-mono outline-none focus:ring-2 focus:ring-primary/50"
        />
        {error && <p className="text-xs text-red-500 text-center">{error}</p>}
        <button
          type="submit"
          disabled={!token.trim() || submitting}
          className="w-full bg-primary text-on-primary font-bold py-3 rounded-xl flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          <LogIn className="w-4 h-4" />
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
};
