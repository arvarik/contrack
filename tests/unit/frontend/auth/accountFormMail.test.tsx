// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  AccountFields,
  useAccountForm,
} from "../../../../src/components/auth/accountForm";

const Form = ({ mailConfigured }: { mailConfigured?: boolean }) => {
  const form = useAccountForm();
  return <AccountFields form={form} mailConfigured={mailConfigured} />;
};

describe("the email hint on the account form", () => {
  afterEach(cleanup);

  it("says the server cannot send email when mail is not set up", () => {
    render(<Form mailConfigured={false} />);

    expect(
      screen.getByText("Used to sign in. This Contrack cannot send email"),
    ).toBeTruthy();
  });

  it("does not say mail is never sent once outgoing mail is set up", () => {
    render(<Form mailConfigured />);

    expect(
      screen.getByText("Used to sign in, and to email you links you ask for"),
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/never sends mail/);
  });

  it("reads as no mail while the answer is unknown", () => {
    render(<Form />);

    expect(
      screen.getByText("Used to sign in. This Contrack cannot send email"),
    ).toBeTruthy();
  });
});
