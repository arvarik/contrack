// @vitest-environment jsdom
// The Single sign-on card on Account settings: Link follows the current
// provider, an old provider's identity is named by its host, the unlink
// dialog tells the truth about email matching and passkeys, and the
// address's ?oidc= outcome becomes a toast.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  identities: [] as unknown[],
  passkeys: [] as unknown[],
}));
vi.mock("../../../../src/api/auth", () => ({
  listIdentities: () => Promise.resolve({ identities: api.identities }),
  unlinkIdentity: vi.fn(),
  startOidcLink: vi.fn(),
}));
vi.mock("../../../../src/api/passkeys", () => ({
  listPasskeys: () => Promise.resolve({ passkeys: api.passkeys }),
  passkeysSupported: () => true,
}));
vi.mock("../../../../src/components/auth/AuthGate", () => ({
  useAuth: () => ({ oidc: { name: "Authentik" } }),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { SingleSignOnCard } from "../../../../src/views/settings/account/SingleSignOnCard";

const identity = (over: Record<string, unknown> = {}) => ({
  id: "i1",
  issuer: "https://id.example.com",
  email: "a@b.c",
  createdAt: "2026-01-02 03:04:05",
  lastUsedAt: null,
  current: true,
  ...over,
});

function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SingleSignOnCard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.identities = [];
  api.passkeys = [];
  toast.success.mockReset();
  toast.error.mockReset();
  history.replaceState(null, "", "/settings/account");
});
afterEach(cleanup);

describe("SingleSignOnCard", () => {
  it("offers Link in the empty state", async () => {
    show();
    expect(await screen.findByText("Not linked")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Link Authentik" })).toBeTruthy();
  });

  it("hides Link while an identity is at the current provider", async () => {
    api.identities = [identity()];
    show();
    await screen.findByText("a@b.c");
    expect(screen.queryByRole("button", { name: "Link Authentik" })).toBeNull();
  });

  it("offers Link for the new provider and names the old identity by its host", async () => {
    api.identities = [
      identity({
        email: null,
        issuer: "https://old.example.org",
        current: false,
      }),
    ];
    show();
    expect(await screen.findByText("old.example.org account")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Link Authentik" })).toBeTruthy();
  });

  it("tells the truth in the unlink dialog, and leaves passkeys out when there are none", async () => {
    api.identities = [identity()];
    show();
    fireEvent.click(await screen.findByLabelText("Unlink a@b.c"));
    const text = (await screen.findByRole("dialog")).textContent ?? "";
    expect(text).toContain("If email matching is on");
    expect(text).not.toContain("passkeys");
  });

  it("mentions passkeys when the account has one", async () => {
    api.identities = [identity()];
    api.passkeys = [{ id: "p" }];
    show();
    await screen.findByText("a@b.c");
    fireEvent.click(screen.getByLabelText("Unlink a@b.c"));
    await screen.findByText(/and passkeys/);
  });

  it("reports the outcome in the address and keeps the history state", async () => {
    history.replaceState({ key: "k" }, "", "/settings/account?oidc=denied");
    show();
    await screen.findByText("Not linked");
    expect(toast.error).toHaveBeenCalledWith("Linking was cancelled");
    expect(window.location.search).toBe("");
    expect(history.state).toEqual({ key: "k" });
  });
});
