import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { usePreferences } from "../../contexts/PreferencesContext";
import { StartPanel } from "./StartPanel";

export const START_PAGE_SESSION_KEY = "contrack.started";

/**
 * StartRedirect — Handles the startPage preference on first navigation.
 *
 * Runs once per browser session. If startPage is set to "pulse", redirects
 * from "/" to "/pulse". Only applies to exact "/" navigations.
 */
export function StartRedirect() {
  const { preferences, isLoaded } = usePreferences();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoaded) return;
    const started = sessionStorage.getItem(START_PAGE_SESSION_KEY);
    if (!started) {
      sessionStorage.setItem(START_PAGE_SESSION_KEY, "true");
      if (preferences.startPage === "pulse") {
        navigate("/pulse", { replace: true });
      }
    }
  }, [isLoaded, preferences.startPage, navigate]);

  return <StartPanel />;
}
