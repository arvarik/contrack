// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { DEFAULT_PREFERENCES } from "../../../../src/api/preferences";
import * as authApi from "../../../../src/api/auth";
import * as passkeysApi from "../../../../src/api/passkeys";
import { AccountSettings } from "../../../../src/views/settings/AccountSettings";
import { PasskeysCard } from "../../../../src/views/settings/account/PasskeysCard";
import { findRows } from "../../../../src/views/settings/registry";

const authState = vi.hoisted(() => ({
  user: {
    id: "u1",
    email: "ada@example.com",
    username: "ada",
    displayName: "Ada Lovelace",
    role: "admin",
    createdAt: "2026-01-01T00:00:00Z",
    lastLoginAt: "2026-01-01T00:00:00Z",
    status: "active",
    credentialState: "password",
    mustChangePassword: false,
    avatarUrl: null as string | null,
  },
  authRequired: true,
  isAdmin: true,
  refresh: vi.fn(),
  beginSetup: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("../../../../src/components/auth/AuthGate", () => ({
  useAuth: () => authState,
}));

vi.mock("../../../../src/contexts/PreferencesContext", () => ({
  usePreferences: () => ({
    preferences: DEFAULT_PREFERENCES,
    mode: "light",
    stored: [],
    changed: [],
    setPreference: vi.fn(),
    resetPreference: vi.fn(),
  }),
}));

vi.mock("../../../../src/api/auth", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../../src/api/auth")>();
  return {
    ...actual,
    updateProfile: vi.fn(),
    changePassword: vi.fn(),
    fetchSessions: vi.fn(),
    revokeOtherSessions: vi.fn(),
    fetchApiTokens: vi.fn(),
    createApiToken: vi.fn(),
    revokeApiToken: vi.fn(),
  };
});

vi.mock("../../../../src/api/passkeys", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../../src/api/passkeys")>();
  return {
    ...actual,
    passkeysSupported: vi.fn(() => true),
    listPasskeys: vi.fn(),
    renamePasskey: vi.fn(),
    removePasskey: vi.fn(),
    registerPasskey: vi.fn(),
  };
});

function renderWithProviders(
  ui: React.ReactElement,
  client = new QueryClient(),
) {
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter>{ui}</MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  authState.user = {
    id: "u1",
    email: "ada@example.com",
    username: "ada",
    displayName: "Ada Lovelace",
    role: "admin",
    createdAt: "2026-01-01T00:00:00Z",
    lastLoginAt: "2026-01-01T00:00:00Z",
    status: "active",
    credentialState: "password",
    mustChangePassword: false,
    avatarUrl: null,
  };
  vi.mocked(authApi.fetchSessions).mockResolvedValue({ sessions: [] });
  vi.mocked(authApi.fetchApiTokens).mockResolvedValue({ tokens: [] });
  vi.mocked(passkeysApi.listPasskeys).mockResolvedValue({
    passkeys: [
      {
        id: "pk-1",
        name: "MacBook Pro",
        deviceType: "multiDevice",
        backedUp: true,
        transports: ["internal"],
        createdAt: "2026-01-01T00:00:00Z",
        lastUsedAt: null,
      },
    ],
    nudgeDismissed: false,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AccountSettings hardening", () => {
  it("trims and normalizes profile fields, blocks empty username/email, and formats error toast", async () => {
    const errorToast = vi.spyOn(toast, "error");
    vi.mocked(authApi.updateProfile).mockRejectedValueOnce(
      new Error("Username is already taken."),
    );

    renderWithProviders(<AccountSettings />);

    const usernameInput = screen.getByLabelText("Username") as HTMLInputElement;
    const emailInput = screen.getByLabelText("Email") as HTMLInputElement;
    const saveBtn = screen.getByRole("button", {
      name: "Save changes",
    }) as HTMLButtonElement;

    expect(saveBtn.disabled).toBe(true);

    // Whitespace-only or case-only difference is not dirty
    fireEvent.change(usernameInput, { target: { value: "  ADA  " } });
    expect(saveBtn.disabled).toBe(true);

    // Clearing username disables save
    fireEvent.change(usernameInput, { target: { value: "   " } });
    expect(saveBtn.disabled).toBe(true);

    // Valid change enables save and sends trimmed/lowercased values
    fireEvent.change(usernameInput, { target: { value: "  Ada_Lovelace  " } });
    fireEvent.change(emailInput, {
      target: { value: "  ADA.NEW@Example.com " },
    });
    expect(saveBtn.disabled).toBe(false);

    fireEvent.click(saveBtn);
    await waitFor(() => {
      expect(authApi.updateProfile).toHaveBeenCalledWith({
        displayName: "Ada Lovelace",
        username: "ada_lovelace",
        email: "ada.new@example.com",
      });
    });

    await waitFor(() => {
      expect(errorToast).toHaveBeenCalledWith(
        "Could not update profile: Username is already taken",
      );
    });
    errorToast.mockRestore();
  });

  it("validates whitespace-only, unchanged, and mismatched passwords and invalidates sessions on success", async () => {
    vi.mocked(authApi.changePassword).mockResolvedValueOnce({ success: true });
    const client = new QueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    renderWithProviders(<AccountSettings />, client);

    const currentInput = screen.getByLabelText("Current password");
    const newInput = screen.getByLabelText("New password", { exact: true });
    const confirmInput = screen.getByLabelText("Confirm new password");
    const submitBtn = screen.getByRole("button", {
      name: "Change password",
    }) as HTMLButtonElement;

    fireEvent.change(currentInput, { target: { value: "old-password-123" } });

    // 8 spaces should be rejected as whitespace-only
    fireEvent.change(newInput, { target: { value: "        " } });
    fireEvent.change(confirmInput, { target: { value: "        " } });
    expect(screen.getByText("Enter a password")).toBeTruthy();
    expect(submitBtn.disabled).toBe(true);

    // Same as current password should be rejected
    fireEvent.change(newInput, { target: { value: "old-password-123" } });
    fireEvent.change(confirmInput, { target: { value: "old-password-123" } });
    expect(screen.getByText("Choose a different password")).toBeTruthy();
    expect(submitBtn.disabled).toBe(true);

    // Valid new password submits, clears fields, and invalidates sessions
    fireEvent.change(newInput, { target: { value: "new-password-456" } });
    fireEvent.change(confirmInput, { target: { value: "new-password-456" } });
    expect(submitBtn.disabled).toBe(false);

    fireEvent.click(submitBtn);
    await waitFor(() => {
      expect(authApi.changePassword).toHaveBeenCalledWith({
        currentPassword: "old-password-123",
        newPassword: "new-password-456",
      });
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["auth", "sessions"],
    });
  });
});

describe("PasskeysCard hardening", () => {
  it("skips mutation when renamed to the same name, disables save when empty, and formats error toast", async () => {
    const errorToast = vi.spyOn(toast, "error");
    vi.mocked(passkeysApi.renamePasskey).mockRejectedValueOnce(
      new Error("Server refused."),
    );

    renderWithProviders(<PasskeysCard />);

    const renameBtn = await screen.findByRole("button", {
      name: "Rename MacBook Pro",
    });
    fireEvent.click(renameBtn);

    const input = screen.getByRole("textbox", {
      name: "Rename passkey MacBook Pro",
    });
    const saveBtn = screen.getByRole("button", {
      name: "Save name",
    }) as HTMLButtonElement;

    // Empty name disables save button
    fireEvent.change(input, { target: { value: "   " } });
    expect(saveBtn.disabled).toBe(true);

    // Unchanged name closes edit mode without calling renamePasskey
    fireEvent.change(input, { target: { value: "  MacBook Pro  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(passkeysApi.renamePasskey).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("textbox", { name: "Rename passkey MacBook Pro" }),
    ).toBeNull();

    // New name calls renamePasskey and formats error toast on failure
    fireEvent.click(screen.getByRole("button", { name: "Rename MacBook Pro" }));
    const reopenedInput = screen.getByRole("textbox", {
      name: "Rename passkey MacBook Pro",
    });
    fireEvent.change(reopenedInput, { target: { value: "Work Laptop" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));

    await waitFor(() => {
      expect(passkeysApi.renamePasskey).toHaveBeenCalledWith(
        "pk-1",
        "Work Laptop",
      );
      expect(errorToast).toHaveBeenCalledWith(
        "Could not rename passkey: Server refused",
      );
    });
    errorToast.mockRestore();
  });
});

describe("You registry search", () => {
  it("finds passkey and avatar rows under Account settings", () => {
    const passkeyHits = findRows("passkey", { authRequired: true });
    expect(passkeyHits.map((h) => h.path)).toContain(
      "/settings/account#password",
    );
    const avatarHits = findRows("avatar", { authRequired: true });
    expect(avatarHits.map((h) => h.path)).toContain(
      "/settings/account#profile",
    );
  });
});
