// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import {
  passwordStrength,
  PasswordStrengthMeter,
} from "../../../../src/lib/passwordStrength";

afterEach(() => {
  cleanup();
});

describe("passwordStrength", () => {
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
});

describe("PasswordStrengthMeter", () => {
  it("renders nothing when password is empty", () => {
    const { container } = render(
      React.createElement(PasswordStrengthMeter, { password: "" }),
    );
    expect(container.firstChild).toBeNull();
  });

  it.each([
    ["Short", "abc"],
    ["OK", "lowercase1"],
    ["Good", "Pass1234!"],
    ["Strong", "Correct-Horse-Battery-Staple-2026!"],
  ])("renders %s for %s", (word, password) => {
    render(React.createElement(PasswordStrengthMeter, { password }));
    expect(screen.getByText(word)).toBeTruthy();
    expect(screen.getByRole("status").getAttribute("aria-label")).toBe(
      `Password strength: ${word}`,
    );
  });
});
