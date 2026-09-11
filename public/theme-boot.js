/*
 * theme-boot — paint the chosen theme before the first frame.
 *
 * A classic, blocking script rather than an inline one, because the production
 * Content-Security-Policy is `script-src 'self'` and weakening it to avoid one
 * flash of the wrong palette would be a poor trade. It is a few hundred bytes,
 * same-origin, and cached for the life of the deploy.
 *
 * It reads a cache the app writes (see `applyTheme` in src/lib/theme.ts) and
 * does nothing clever with it. The account's real preference arrives one
 * request later and replaces whatever this painted.
 *
 * "system" writes no attribute at all: index.css answers that case with
 * `prefers-color-scheme`, which needs no JavaScript and cannot be wrong.
 */
(function () {
  try {
    var raw = window.localStorage.getItem("contrack.theme");
    if (!raw) return;

    var cached = JSON.parse(raw);
    var root = document.documentElement;

    if (cached.theme === "light" || cached.theme === "dark") {
      root.setAttribute("data-theme", cached.theme);
    }

    // A cached accent belongs to the palette it was derived for. When the
    // machine has flipped since the last visit, the five colours are for the
    // wrong palette, so they are left off and the app derives them again.
    var wanted =
      cached.theme === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : cached.theme;
    if (cached.mode !== wanted) return;

    var vars = cached.vars || {};
    for (var name in vars) {
      if (name.indexOf("--color-") === 0) {
        root.style.setProperty(name, String(vars[name]));
      }
    }
  } catch {
    /* Private browsing, blocked storage, a cache from a future version. The
       stylesheet's own values are a correct answer; they are just not the
       chosen one for one paint. */
  }
})();
