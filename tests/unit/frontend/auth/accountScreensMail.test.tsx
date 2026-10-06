// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("../../../../src/components/auth/AuthGate", () => ({
  useAuth: () => ({ instanceName: "", authRequired: true }),
}));
vi.mock("../../../../src/api/auth", () => ({
  registerAccount: vi.fn(),
  acceptInvitation: vi.fn(),
  checkInvitation: vi.fn(() => Promise.resolve({ ok: true })),
  setupAccount: vi.fn(),
  uploadAccountAvatar: vi.fn(),
}));

import { AcceptInvitation } from "../../../../src/components/auth/AcceptInvitation";
import { Register } from "../../../../src/components/auth/Register";

const WITH_MAIL = "Used to sign in, and to email you links you ask for";
const WITHOUT_MAIL = "Used to sign in. This Contrack cannot send email";

// AuthGate passes `mailConfigured` to each of the three screens that create an
// account. It defaults to false, so a screen that dropped the prop would still
// compile and would tell every instance that it cannot send email. The setup
// screen's two answers are checked in a browser, against a real
// `/api/auth/status`, in tests/e2e/account-form-mail.spec.ts.
const screens: [string, (mailConfigured?: boolean) => React.ReactElement][] = [
  [
    "Register",
    (mailConfigured) => (
      <Register
        onRegistered={vi.fn()}
        onCancel={vi.fn()}
        mailConfigured={mailConfigured}
      />
    ),
  ],
  [
    "AcceptInvitation",
    (mailConfigured) => (
      <AcceptInvitation
        token="t"
        onAccepted={vi.fn()}
        onCancel={vi.fn()}
        mailConfigured={mailConfigured}
      />
    ),
  ],
];

describe.each(screens)("%s email hint", (_name, screen_) => {
  afterEach(cleanup);

  // The invitation screen checks its link first, so the form comes later.
  it("says links are emailed when the instance can email them", async () => {
    render(screen_(true));
    expect(await screen.findByText(WITH_MAIL)).toBeTruthy();
  });

  it("says the server cannot send email otherwise", async () => {
    render(screen_(false));
    expect(await screen.findByText(WITHOUT_MAIL)).toBeTruthy();
  });
});
