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
  setupAccount: vi.fn(),
  uploadAccountAvatar: vi.fn(),
}));

import { AcceptInvitation } from "../../../../src/components/auth/AcceptInvitation";
import { Register } from "../../../../src/components/auth/Register";
import { SetupWizard } from "../../../../src/components/auth/SetupWizard";

const WITH_MAIL = "Used to sign in, and to email you links you ask for";
const WITHOUT_MAIL = "Used to sign in. This Contrack cannot send email";

// AuthGate passes `mailConfigured` to each of the three screens that create an
// account. It defaults to false, so a screen that dropped the prop would still
// compile and would tell every instance that it cannot send email.
const screens: [string, (mailConfigured?: boolean) => React.ReactElement][] = [
  [
    "SetupWizard",
    (mailConfigured) => (
      <SetupWizard onCreated={vi.fn()} mailConfigured={mailConfigured} />
    ),
  ],
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

  it("says links are emailed when the instance can email them", () => {
    render(screen_(true));
    expect(screen.getByText(WITH_MAIL)).toBeTruthy();
  });

  it("says the server cannot send email otherwise", () => {
    render(screen_(false));
    expect(screen.getByText(WITHOUT_MAIL)).toBeTruthy();
  });
});
