// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SignIn, LAST_IDENTIFIER_KEY } from "../../src/components/auth/SignIn";
import { passkeysSupported } from "../../src/api/passkeys";

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

vi.mock("../../src/api/passkeys", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/api/passkeys")>();
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
});
