// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ForgotPassword } from "../../../../src/components/auth/ForgotPassword";

vi.mock("../../../../src/components/auth/AuthGate", () => ({
  useAuth: () => ({ instanceName: "", authRequired: true }),
}));

describe("ForgotPassword on an instance that cannot send mail", () => {
  afterEach(cleanup);

  it("names a command that the production image can run", () => {
    render(<ForgotPassword onBack={vi.fn()} mailConfigured={false} />);

    // The image ships node and scripts/reset-password.ts. It has no tsx.
    expect(
      screen.getByText("node scripts/reset-password.ts <username>"),
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/tsx/);
  });
});
