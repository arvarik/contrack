// @vitest-environment jsdom
// The Single sign-on card on Account settings: Link follows the current
// provider, an old provider's identity is named by its host, the unlink
// dialog tells the truth about email matching and passkeys, and the
// address's ?oidc= outcome becomes a toast.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  identities: [] as unknown[],
  passkeys: [] as unknown[],
  matchByEmail: false,
  passkeysSupported: true,
  // Never settles, so the link stays pending.
  startOidcLink: vi.fn(() => new Promise(() => {})),
}));
vi.mock("../../../../src/api/auth", () => ({
  listIdentities: () =>
    Promise.resolve({
      identities: api.identities,
      matchByEmail: api.matchByEmail,
    }),
  unlinkIdentity: vi.fn(),
  startOidcLink: api.startOidcLink,
}));
vi.mock("../../../../src/api/passkeys", () => ({
  listPasskeys: () => Promise.resolve({ passkeys: api.passkeys }),
  passkeysSupported: () => api.passkeysSupported,
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
  api.matchByEmail = false;
  api.passkeysSupported = true;
  api.startOidcLink.mockClear();
  toast.success.mockReset();
  toast.error.mockReset();
  history.replaceState(null, "", "/settings/account");
});
afterEach(cleanup);

describe("SingleSignOnCard", () => {
  it("starts one link however often the empty state's Link is clicked", async () => {
    show();
    expect(await screen.findByText("Not linked")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Link Authentik" }));
    const pending = await screen.findByRole("button", { name: "Opening…" });
    fireEvent.click(pending);
    fireEvent.click(pending);
    // A mutation reaches its function a few ticks after mutate.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(api.startOidcLink).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["hides Link while an identity is at the current provider", {}, "a@b.c", 0],
    [
      "offers Link for the new provider and names the old identity by its host",
      { email: null, issuer: "https://old.example.org", current: false },
      "old.example.org account",
      1,
    ],
  ])("%s", async (_case, over, shown, links) => {
    api.identities = [identity(over)];
    show();
    expect(await screen.findByText(shown)).toBeTruthy();
    expect(
      screen.queryAllByRole("button", { name: "Link Authentik" }),
    ).toHaveLength(links);
  });

  // The unlink dialog tells the truth about email matching and passkeys.
  it.each([
    [
      "warns that SSO links the account again while email matching is on",
      { matchByEmail: true },
      {},
      "Unlink Authentik",
      "You can still sign in with your password. Email matching is on, so your next Authentik sign-in links this account again",
    ],
    [
      "names an old provider's identity by its host, without the matching warning",
      { matchByEmail: true },
      { issuer: "https://old.example.org", current: false },
      "Unlink old.example.org",
      "You can still sign in with your password",
    ],
    [
      "does not claim the account has no passkeys when they cannot be checked",
      { passkeysSupported: false },
      {},
      "Unlink Authentik",
      "You can still sign in with your password and any other sign-in methods",
    ],
    [
      "mentions passkeys when the account has one",
      { passkeys: [{ id: "p" }] },
      {},
      "Unlink Authentik",
      "You can still sign in with your password and passkeys",
    ],
  ])("%s", async (_case, state, over, title, words) => {
    Object.assign(api, state);
    api.identities = [identity(over)];
    show();
    fireEvent.click(await screen.findByLabelText("Unlink a@b.c"));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(words)).toBeTruthy();
    expect(within(dialog).getByRole("heading").textContent).toBe(title);
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
