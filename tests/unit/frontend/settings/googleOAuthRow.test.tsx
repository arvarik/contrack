// @vitest-environment jsdom
// The Google OAuth client row in Settings → Administration → General: the
// five setup steps until a client is saved, the redirect address the server
// itself sends to Google, and a warning when the browser reached Contrack
// at another address than that one.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import * as adminApi from "../../../../src/api/admin";

vi.mock("../../../../src/api/admin", () => ({
  useIntegrations: vi.fn(),
  useUpdateIntegrations: vi.fn(),
}));
const auth = vi.hoisted(() => ({ publicUrl: null as string | null }));
vi.mock("../../../../src/components/auth/AuthGate", () => ({
  useAuth: () => ({ publicUrl: auth.publicUrl }),
}));

import { GoogleRow } from "../../../../src/views/settings/admin/GeneralView";

const CALLBACK = "/api/connectors/google/callback";

function show(
  googleOAuth: Partial<{
    configured: boolean;
    source: "setting" | "env" | "none";
    clientId: string | null;
    clientSecretPreview: string | null;
    redirectUri: string;
  }>,
) {
  vi.mocked(adminApi.useIntegrations).mockReturnValue({
    data: {
      googleOAuth: {
        configured: false,
        source: "none",
        clientId: null,
        clientSecretPreview: null,
        redirectUri: `${window.location.origin}${CALLBACK}`,
        ...googleOAuth,
      },
    },
    isLoading: false,
  } as unknown as ReturnType<typeof adminApi.useIntegrations>);
  return render(
    <MemoryRouter>
      <GoogleRow />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  auth.publicUrl = null;
  vi.mocked(adminApi.useUpdateIntegrations).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof adminApi.useUpdateIntegrations>);
});
afterEach(cleanup);

describe("GoogleRow", () => {
  it("lists the five steps until a client is saved, then folds them away and points to Connectors", () => {
    const { unmount } = show({});
    expect(screen.getByText("Not set up")).toBeTruthy();
    const steps = screen.getByRole("list");
    expect(within(steps).getAllByRole("listitem")).toHaveLength(5);
    expect(
      within(steps).getByText(`${window.location.origin}${CALLBACK}`),
    ).toBeTruthy();
    unmount();

    show({
      configured: true,
      source: "setting",
      clientId: "1-x.apps.googleusercontent.com",
      clientSecretPreview: "••••2345",
    });
    expect(screen.getByText("Configured")).toBeTruthy();
    const fold = screen
      .getByText("How to create a client in Google Cloud")
      .closest("details");
    expect(fold?.open).toBe(false);
    expect(
      screen.getByRole("link", { name: "Connectors" }).getAttribute("href"),
    ).toBe("/settings/connectors");
    expect(screen.getByRole("button", { name: "Remove" })).toBeTruthy();
  });

  it("names the environment variables when the environment sets the client", () => {
    show({ configured: true, source: "env", clientId: "1-x" });
    expect(screen.queryByLabelText("Client ID")).toBeNull();
    expect(
      screen.getByText(
        /in GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET, where this server reads them/,
      ),
    ).toBeTruthy();
  });

  it("shows the server's address, and warns when the browser reached Contrack at another one", () => {
    // Behind an https proxy with no PUBLIC_URL or TRUST_PROXY_HOPS, the
    // server sees http and sends Google that, while the browser has https.
    show({ redirectUri: `http://crm.example.com${CALLBACK}` });
    expect(screen.getByText(`http://crm.example.com${CALLBACK}`)).toBeTruthy();
    expect(screen.getByRole("note").textContent).toMatch(
      /sends Google http:\/\/crm\.example\.com/,
    );
    cleanup();

    show({});
    expect(screen.queryByRole("note")).toBeNull();
  });
});
