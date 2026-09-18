/**
 * passwordStrength — evaluates password strength on a 0 to 4 scale.
 *
 * Checks password length and character classes against a list of common
 * weak passwords. Returns an integer from 0 (empty) to 4 (strong).
 * Also exports PasswordStrengthMeter, a 4-segment visual indicator.
 *
 * @module lib/passwordStrength
 */

import React from "react";
import { cn } from "./utils";

export const WORST_PASSWORDS = [
  "password",
  "12345678",
  "123456789",
  "1234567890",
  "qwertyui",
  "qwertyuiop",
  "11111111",
  "00000000",
  "iloveyou",
  "admin123",
  "welcome1",
  "password1",
  "password123",
  "monkey123",
  "dragon123",
  "master123",
  "football",
  "baseball",
  "superman",
  "sunshine",
  "princess",
  "shadow12",
  "secret12",
  "trustno1",
  "letmein1",
  "passw0rd",
  "pass1234",
  "abc12345",
  "login123",
  "contrack",
  "contrack1",
  "contrack123",
  "changeme",
  "temporary",
  "testing1",
  "guest123",
  "user1234",
  "default1",
  "hunter22",
  "root1234",
] as const;

export const WORST_PASSWORDS_SET = new Set<string>(WORST_PASSWORDS);

export const STRENGTH_WORDS = ["", "Short", "OK", "Good", "Strong"] as const;

export type StrengthWord = (typeof STRENGTH_WORDS)[number];

/**
 * Score password strength from 0 (empty) to 4 (strong).
 *
 * Evaluates length and variety of character classes (lowercase, uppercase,
 * numbers, symbols). Checks against a list of 40 common worst passwords.
 */
export function passwordStrength(password: string): number {
  if (!password) return 0;

  const normalized = password.toLowerCase();
  if (WORST_PASSWORDS_SET.has(normalized)) {
    return 1;
  }

  if (password.length < 8) {
    return 1;
  }

  let classes = 0;
  if (/[a-z]/.test(password)) classes++;
  if (/[A-Z]/.test(password)) classes++;
  if (/[0-9]/.test(password)) classes++;
  if (/[^a-zA-Z0-9]/.test(password)) classes++;

  if (password.length >= 16 && classes >= 2) return 4;
  if (password.length >= 12 && classes >= 3) return 4;
  if (password.length >= 12 && classes >= 2) return 3;
  if (password.length >= 10 && classes >= 3) return 3;
  if (password.length >= 8 && classes >= 4) return 3;
  if (password.length >= 8 && classes >= 2) return 2;

  return 1;
}

function getSegmentColor(strength: number): string {
  switch (strength) {
    case 1:
      return "bg-error";
    case 2:
      return "bg-amber-500";
    case 3:
      return "bg-primary";
    case 4:
      return "bg-emerald-500";
    default:
      return "bg-surface-container-highest";
  }
}

function getWordColor(strength: number): string {
  switch (strength) {
    case 1:
      return "text-error";
    case 2:
      return "text-warning";
    case 3:
      return "text-primary";
    case 4:
      return "text-success dark:text-emerald-400";
    default:
      return "text-on-surface-variant";
  }
}

/**
 * Four-segment visual password strength meter with the words Short, OK, Good, Strong.
 * Does not block form submission.
 */
export const PasswordStrengthMeter = ({ password }: { password?: string }) => {
  if (!password) return null;

  const score = passwordStrength(password);
  const word = STRENGTH_WORDS[score] || "Short";
  const segmentClass = getSegmentColor(score);
  const wordClass = getWordColor(score);

  return React.createElement(
    "div",
    {
      className: "space-y-1 pt-1.5",
      role: "status",
      "aria-label": `Password strength: ${word}`,
    },
    React.createElement(
      "div",
      { className: "flex items-center gap-2" },
      React.createElement(
        "div",
        { className: "flex-1 grid grid-cols-4 gap-1.5 h-1.5" },
        [1, 2, 3, 4].map((step) =>
          React.createElement("div", {
            key: step,
            className: cn(
              "h-full rounded-full transition-colors duration-200",
              step <= score ? segmentClass : "bg-surface-container-highest",
            ),
          }),
        ),
      ),
      React.createElement(
        "span",
        {
          className: cn(
            "text-xs font-semibold shrink-0 min-w-[3rem] text-right",
            wordClass,
          ),
        },
        word,
      ),
    ),
  );
};
