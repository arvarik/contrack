import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["dist/", "node_modules/", "drizzle/"],
  },
  {
    rules: {
      "no-empty": "off",
      "no-useless-assignment": "off",
      "no-useless-escape": "off",
      "preserve-caught-error": "off",
      "@typescript-eslint/no-unused-expressions": "off",

      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_" },
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
      // Dependency fixes can change runtime behavior (effects re-firing), so
      // this starts as a warning to burn down deliberately, not mechanically.
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  // Accessibility — recommended set, surfaced as warnings while the backlog
  // (documented in docs/recommendations/) is burned down. Ratchet rules to
  // "error" as their violation count reaches zero.
  {
    files: ["src/**/*.tsx"],
    plugins: { "jsx-a11y": jsxA11y },
    rules: Object.fromEntries(
      Object.entries(jsxA11y.flatConfigs.recommended.rules).map(([name]) => [
        name,
        "warn",
      ]),
    ),
  },
);
