// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SignIn, LAST_IDENTIFIER_KEY } from "../../src/components/auth/SignIn";

vi.mock("../../src/components/auth/AuthGate", () => ({
  useAuth: () => ({
    instanceName: "Test Contrack",
    user: null,
    setupRequired: false,
    authRequired: true,
  }),
}));

vi.mock("../../src/api/auth", () => ({
  signIn: vi.fn(),
}));

const mockPasskeysSupported = true;

vi.mock("../../src/api/passkeys", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/api/passkeys")>();
  return {
    ...actual,
    passkeysSupported: () => {
      if (typeof window === "undefined" || !("PublicKeyCredential" in window)) {
        return false;
      }
      return mockPasskeysSupported;
    },
    signInWithPasskey: vi.fn(),
    passkeyAutofillSupported: vi.fn().mockResolvedValue(false),
  };
});

describe("SignIn front door", () => {
  const originalPublicKeyCredential = window.PublicKeyCredential;

  beforeEach(() => {
    localStorage.clear();
    // Default to no PublicKeyCredential unless explicitly configured in test
    // @ts-expect-error test cleanup
    delete window.PublicKeyCredential;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    localStorage.clear();
    if (originalPublicKeyCredential !== undefined) {
      window.PublicKeyCredential = originalPublicKeyCredential;
    } else {
      // @ts-expect-error test cleanup
      delete window.PublicKeyCredential;
    }
  });

  it("the toggle changes type and aria-pressed", () => {
    render(<SignIn onSignedIn={vi.fn()} />);

    const passwordInput = screen.getByLabelText("Password");
    expect(passwordInput.getAttribute("type")).toBe("password");

    const toggleBtn = screen.getByRole("button", { name: "Show password" });
    expect(toggleBtn.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(toggleBtn);
    expect(passwordInput.getAttribute("type")).toBe("text");
    expect(toggleBtn.getAttribute("aria-label")).toBe("Hide password");
    expect(toggleBtn.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(toggleBtn);
    expect(passwordInput.getAttribute("type")).toBe("password");
    expect(toggleBtn.getAttribute("aria-label")).toBe("Show password");
    expect(toggleBtn.getAttribute("aria-pressed")).toBe("false");
  });

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

  it("the passkey button is absent without PublicKeyCredential", () => {
    // @ts-expect-error explicitly remove PublicKeyCredential
    delete window.PublicKeyCredential;

    render(<SignIn onSignedIn={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /passkey/i })).toBeNull();
  });

  it("the passkey button is present when PublicKeyCredential is supported", () => {
    // @ts-expect-error mock PublicKeyCredential existence
    window.PublicKeyCredential = class {};

    render(<SignIn onSignedIn={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: "Sign in with a passkey" }),
    ).toBeTruthy();
  });
});
