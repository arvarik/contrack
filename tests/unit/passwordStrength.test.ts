// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import {
  passwordStrength,
  WORST_PASSWORDS,
  STRENGTH_WORDS,
  PasswordStrengthMeter,
} from "../../src/lib/passwordStrength";

afterEach(() => {
  cleanup();
});

describe("passwordStrength", () => {
  it("has exactly 40 worst passwords", () => {
    expect(WORST_PASSWORDS).toHaveLength(40);
  });

  it("returns 0 for empty password", () => {
    expect(passwordStrength("")).toBe(0);
  });

  it("returns 1 for short passwords (< 8 chars)", () => {
    expect(passwordStrength("abc")).toBe(1);
    expect(passwordStrength("short1!")).toBe(1);
  });

  it("returns 1 for any password in the worst passwords list", () => {
    expect(passwordStrength("password")).toBe(1);
    expect(passwordStrength("12345678")).toBe(1);
    expect(passwordStrength("contrack123")).toBe(1);
    expect(passwordStrength("PASSWORD123")).toBe(1);
  });

  it("returns 2 (OK) for basic 8+ character passwords with 2 classes", () => {
    expect(passwordStrength("lowercase1")).toBe(2);
    expect(passwordStrength("mynameis1")).toBe(2);
  });

  it("returns 3 (Good) for stronger length and class combinations", () => {
    expect(passwordStrength("Pass1234!")).toBe(3);
    expect(passwordStrength("somelongword1")).toBe(3);
  });

  it("returns 4 (Strong) for long passwords with diverse classes", () => {
    expect(passwordStrength("correct horse battery staple")).toBe(4);
    expect(passwordStrength("ValidPassw0rd123!")).toBe(4);
  });

  it("defines standard words Short, OK, Good, Strong", () => {
    expect(STRENGTH_WORDS[1]).toBe("Short");
    expect(STRENGTH_WORDS[2]).toBe("OK");
    expect(STRENGTH_WORDS[3]).toBe("Good");
    expect(STRENGTH_WORDS[4]).toBe("Strong");
  });
});

describe("PasswordStrengthMeter", () => {
  it("renders nothing when password is empty", () => {
    const { container } = render(
      React.createElement(PasswordStrengthMeter, { password: "" }),
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders Short for weak password", () => {
    render(React.createElement(PasswordStrengthMeter, { password: "abc" }));
    expect(screen.getByText("Short")).toBeTruthy();
    expect(screen.getByRole("status").getAttribute("aria-label")).toBe(
      "Password strength: Short",
    );
  });

  it("renders Strong for strong password", () => {
    render(
      React.createElement(PasswordStrengthMeter, {
        password: "Correct-Horse-Battery-Staple-2026!",
      }),
    );
    expect(screen.getByText("Strong")).toBeTruthy();
    expect(screen.getByRole("status").getAttribute("aria-label")).toBe(
      "Password strength: Strong",
    );
  });
});
