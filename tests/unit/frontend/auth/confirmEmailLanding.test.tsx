// @vitest-environment jsdom
// The page an email-change link opens: it spends the link once, even when
// StrictMode mounts it twice, and says what happened.

import { afterEach, expect, it, vi } from "vitest";
import React, { StrictMode } from "react";
import { cleanup, render, screen } from "@testing-library/react";

const completeEmailChange = vi.hoisted(() => vi.fn());
vi.mock("../../../../src/api/authLinks", () => ({ completeEmailChange }));

import { ConfirmEmailLanding } from "../../../../src/components/auth/ConfirmEmailLanding";

afterEach(() => {
  cleanup();
  completeEmailChange.mockReset();
});

it("spends the link once, then names the new email", async () => {
  completeEmailChange.mockResolvedValue({ email: "ada@new.example" });
  render(
    <StrictMode>
      <ConfirmEmailLanding token="t-once" onDone={() => {}} />
    </StrictMode>,
  );
  expect(
    await screen.findByText("Your account now uses ada@new.example"),
  ).toBeTruthy();
  expect(completeEmailChange).toHaveBeenCalledTimes(1);
});

it("says a spent link is no longer valid", async () => {
  completeEmailChange.mockRejectedValue(new Error("That link has expired."));
  render(<ConfirmEmailLanding token="t-spent" onDone={() => {}} />);
  expect(
    await screen.findByRole("heading", {
      name: "This link is no longer valid",
    }),
  ).toBeTruthy();
});
