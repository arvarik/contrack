import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";

/**
 * Re-severity a rule entry without discarding its options.
 *
 * Several jsx-a11y rules are only meaningful with the option objects the
 * recommended config ships (`control-has-associated-label` in particular
 * checks a bounded depth). Writing a bare "error" silently drops those and
 * changes what the rule even means, so severity is swapped in place.
 */
const withSeverity = (entry, severity) =>
  Array.isArray(entry) ? [severity, ...entry.slice(1)] : severity;

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["dist/", "node_modules/", "drizzle/"],
  },
  // Standalone Node tooling (audit scripts, codegen). These run under `node`
  // directly rather than through the app's TS build, so they need Node globals
  // declared — without this every `process`/`console` reads as undefined.
  // Listed explicitly rather than pulling in the `globals` package for one file.
  {
    files: ["scripts/**/*.{mjs,js}"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        fetch: "readonly",
        WebSocket: "readonly",
        URL: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
      },
    },
  },
  {
    rules: {
      "no-empty": "off",
      "no-useless-assignment": "off",
      "no-useless-escape": "off",
      "preserve-caught-error": "off",
      "@typescript-eslint/no-unused-expressions": "off",

      // Dead bindings are dead code, so this is an error rather than a warning.
      // Two escape hatches, both for cases where the binding is doing a job the
      // rule cannot see:
      //
      //   argsIgnorePattern   a positional parameter that must stay in the
      //                       signature even though this implementation ignores
      //                       it — prefix it with `_` to say so on purpose.
      //   ignoreRestSiblings  `const { contactId, ...rest } = row` is the
      //                       idiomatic way to *omit* a field. The binding is
      //                       unused by design; that is the whole point.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      // `any` disables strict-mode checking for everything it touches, so it
      // is an error, not a style preference. Escape hatch for genuinely
      // untypable third-party surfaces: an inline disable with a comment
      // explaining why.
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  // React hooks correctness — violations are real bugs, not style.
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      // Burned down to zero on 2026-08-09 (14 warnings, each reviewed
      // individually — one was a live stale-closure bug in ClusterSwipeCard).
      // Locked at error so the count cannot quietly climb back; a legitimate
      // mount-only effect documents itself with a targeted disable comment
      // rather than relying on the rule staying soft.
      "react-hooks/exhaustive-deps": "error",
    },
  },
  // Accessibility — the recommended set. Rules start as warnings and are
  // ratcheted to "error" once their violation count reaches zero, so a rule
  // that has been paid off cannot quietly regress. See RATCHETED below for
  // which ones are locked.
  {
    files: ["src/**/*.tsx"],
    plugins: { "jsx-a11y": jsxA11y },
    rules: {
      ...Object.fromEntries(
        Object.entries(jsxA11y.flatConfigs.recommended.rules).map(
          ([name, entry]) => [name, withSeverity(entry, "warn")],
        ),
      ),

      // Deprecated by jsx-a11y in favour of `label-has-associated-control`,
      // which is enforced below. Its default here demands BOTH nesting and a
      // matching id — stricter than the HTML spec, and unsatisfiable for the
      // captions above button groups, which are correctly marked up with
      // `aria-labelledby` rather than as labels at all.
      "jsx-a11y/label-has-for": "off",

      // ── RATCHETED: cleared to zero, locked so they stay there ──────────
      "jsx-a11y/control-has-associated-label": withSeverity(
        jsxA11y.flatConfigs.recommended.rules[
          "jsx-a11y/control-has-associated-label"
        ],
        "error",
      ),
      "jsx-a11y/label-has-associated-control": withSeverity(
        jsxA11y.flatConfigs.recommended.rules[
          "jsx-a11y/label-has-associated-control"
        ],
        "error",
      ),
      "jsx-a11y/click-events-have-key-events": withSeverity(
        jsxA11y.flatConfigs.recommended.rules[
          "jsx-a11y/click-events-have-key-events"
        ],
        "error",
      ),
      "jsx-a11y/no-static-element-interactions": withSeverity(
        jsxA11y.flatConfigs.recommended.rules[
          "jsx-a11y/no-static-element-interactions"
        ],
        "error",
      ),
      "jsx-a11y/no-noninteractive-element-interactions": withSeverity(
        jsxA11y.flatConfigs.recommended.rules[
          "jsx-a11y/no-noninteractive-element-interactions"
        ],
        "error",
      ),
      "jsx-a11y/role-supports-aria-props": withSeverity(
        jsxA11y.flatConfigs.recommended.rules[
          "jsx-a11y/role-supports-aria-props"
        ],
        "error",
      ),
      "jsx-a11y/anchor-is-valid": withSeverity(
        jsxA11y.flatConfigs.recommended.rules["jsx-a11y/anchor-is-valid"],
        "error",
      ),

      // Also ratcheted. Autofocus inside a dialog the user just opened is
      // correct and expected, and the rule cannot distinguish that from
      // autofocus on page load — which is the case it exists for. Every
      // current use is inside something the user deliberately opened and
      // carries an inline disable saying so, which is the point: a *new*
      // autofocus now has to justify itself rather than slip in.
      "jsx-a11y/no-autofocus": withSeverity(
        jsxA11y.flatConfigs.recommended.rules["jsx-a11y/no-autofocus"],
        "error",
      ),
    },
  },
);
