// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  SignIn,
  LAST_IDENTIFIER_KEY,
} from "../../../../src/components/auth/SignIn";
import { passkeysSupported } from "../../../../src/api/passkeys";
import { signIn } from "../../../../src/api/auth";

vi.mock("../../../../src/components/auth/AuthGate", () => ({
  useAuth: () => ({
    instanceName: "Test Contrack",
    user: null,
    setupRequired: false,
    authRequired: true,
  }),
}));

vi.mock("../../../../src/api/auth", () => ({
  signIn: vi.fn(),
}));

vi.mock("../../../../src/api/passkeys", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../../src/api/passkeys")>();
  return {
    ...actual,
    passkeysSupported: vi.fn(),
    signInWithPasskey: vi.fn(),
    passkeyAutofillSupported: vi.fn().mockResolvedValue(false),
  };
});

describe("SignIn front door", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(passkeysSupported).mockReturnValue(false);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    localStorage.clear();
  });

  // A touch screen opens its keyboard on a focused field, over the form.
  it.each([
    [false, true],
    [true, false],
  ])(
    "focuses the name field only off a touch screen (touch %s)",
    (touch, focused) => {
      vi.stubGlobal(
        "matchMedia",
        vi.fn((query: string) => ({
          matches: touch && query === "(pointer: coarse)",
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        })),
      );
      render(<SignIn onSignedIn={vi.fn()} />);
      expect(
        document.activeElement === screen.getByLabelText("Username or email"),
      ).toBe(focused);
      vi.unstubAllGlobals();
    },
  );

  it("the caps-lock line appears", () => {
    render(<SignIn onSignedIn={vi.fn()} />);

    const passwordInput = screen.getByLabelText("Password");
    expect(screen.queryByText("Caps Lock is on")).toBeNull();

    fireEvent.keyDown(passwordInput, {
      key: "a",
      modifierCapsLock: true,
      getModifierState: (key: string) => key === "CapsLock",
    });

    const capsNotice = screen.getByText("Caps Lock is on");
    expect(capsNotice).toBeTruthy();
    expect(capsNotice.getAttribute("aria-live")).toBe("polite");

    fireEvent.keyUp(passwordInput, {
      key: "a",
      getModifierState: () => false,
    });
    expect(screen.queryByText("Caps Lock is on")).toBeNull();
  });

  it('"Not you?" clears the stored identifier', () => {
    localStorage.setItem(LAST_IDENTIFIER_KEY, "alice");

    render(<SignIn onSignedIn={vi.fn()} />);

    const identifierInput = screen.getByLabelText(
      "Username or email",
    ) as HTMLInputElement;
    expect(identifierInput.value).toBe("alice");

    const notYouBtn = screen.getByRole("button", { name: /not you\?/i });
    expect(notYouBtn).toBeTruthy();

    fireEvent.click(notYouBtn);

    expect(identifierInput.value).toBe("");
    expect(localStorage.getItem(LAST_IDENTIFIER_KEY)).toBeNull();
    expect(screen.queryByRole("button", { name: /not you\?/i })).toBeNull();
  });

  it.each<[boolean, number]>([
    [false, 0],
    [true, 1],
  ])(
    "shows the passkey button only when passkeys are supported (%s)",
    (supported, shown) => {
      vi.mocked(passkeysSupported).mockReturnValue(supported);

      render(<SignIn onSignedIn={vi.fn()} />);

      expect(
        screen.queryAllByRole("button", { name: /passkey/i }),
      ).toHaveLength(shown);
      expect(
        screen.queryAllByRole("button", { name: "Sign in with a passkey" }),
      ).toHaveLength(shown);
    },
  );

  it("offers the OIDC provider and explains a refusal from the address", () => {
    history.replaceState(null, "", "/?oidc=disabled");
    render(<SignIn onSignedIn={vi.fn()} oidc={{ name: "Authentik" }} />);
    expect(
      screen.getByRole("link", { name: "Sign in with Authentik" }),
    ).toHaveProperty("pathname", "/api/auth/oidc/start");
    expect(screen.getByRole("alert").textContent).toContain(
      "An administrator has closed this account",
    );
    expect(window.location.search).toBe("");
  });

  it("says why an account that must change its password cannot use SSO", () => {
    history.replaceState(null, "", "/?oidc=must-change-password");
    render(<SignIn onSignedIn={vi.fn()} oidc={{ name: "SSO" }} />);
    expect(screen.getByRole("alert").textContent).toContain(
      "needs a new password first",
    );
  });

  it("drops the SSO banner once the person types", () => {
    history.replaceState(null, "", "/?oidc=denied");
    render(<SignIn onSignedIn={vi.fn()} oidc={{ name: "SSO" }} />);
    expect(screen.getByRole("alert").textContent).toContain("cancelled");
    fireEvent.change(screen.getByLabelText(/username or email/i), {
      target: { value: "a" },
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("sends the keep-me-signed-in choice and the current page on the SSO link", () => {
    history.replaceState(null, "", "/contacts/42?tab=notes&oidc=failed");
    render(<SignIn onSignedIn={vi.fn()} oidc={{ name: "SSO" }} />);
    const link = () => screen.getByRole("link", { name: "Sign in with SSO" });
    expect(link().getAttribute("href")).toBe(
      "/api/auth/oidc/start?returnTo=%2Fcontacts%2F42%3Ftab%3Dnotes",
    );
    fireEvent.click(screen.getByLabelText(/keep me signed in/i));
    expect(link().getAttribute("href")).toBe(
      "/api/auth/oidc/start?remember=0&returnTo=%2Fcontacts%2F42%3Ftab%3Dnotes",
    );
  });

  it("leaves returnTo out on the home page", () => {
    history.replaceState(null, "", "/");
    render(<SignIn onSignedIn={vi.fn()} oidc={{ name: "SSO" }} />);
    expect(
      screen
        .getByRole("link", { name: "Sign in with SSO" })
        .getAttribute("href"),
    ).toBe("/api/auth/oidc/start");
  });

  it("disables the SSO link while a password sign-in runs", () => {
    history.replaceState(null, "", "/");
    vi.mocked(signIn).mockReturnValue(new Promise(() => {}));
    render(<SignIn onSignedIn={vi.fn()} oidc={{ name: "SSO" }} />);
    fireEvent.change(screen.getByLabelText(/username or email/i), {
      target: { value: "alice" },
    });
    fireEvent.change(screen.getByLabelText(/^password/i), {
      target: { value: "pw" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
    const link = screen.getByRole("link", { name: "Sign in with SSO" });
    expect(link.getAttribute("aria-disabled")).toBe("true");
    expect(fireEvent.click(link)).toBe(false);
  });
});
