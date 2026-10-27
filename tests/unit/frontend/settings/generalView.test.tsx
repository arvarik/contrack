// @vitest-environment jsdom
// The integration rows in Settings → Administration → General. The Google
// OAuth client row shows its five setup steps until a client is saved, and
// the redirect address the server itself sends. The OpenID Connect row asks
// for the secret again for another client, and shows the server's refusal.
// Both warn when the browser reached Contrack at another address than the
// server sends, and name the variables when the environment sets them. The
// browser journey in tests/e2e/oidc.spec.ts saves, fills and removes the
// provider, and shows the environment's read-only block.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import * as adminApi from "../../../../src/api/admin";

vi.mock("../../../../src/api/admin", () => ({
  useIntegrations: vi.fn(),
  useUpdateIntegrations: vi.fn(),
}));
vi.mock("../../../../src/components/auth/AuthGate", () => ({
  useAuth: () => ({ publicUrl: null }),
}));

import {
  GoogleRow,
  OidcRow,
} from "../../../../src/views/settings/admin/GeneralView";

const GOOGLE_CALLBACK = "/api/connectors/google/callback";

const GOOGLE = {
  configured: false,
  source: "none" as "setting" | "env" | "none",
  clientId: null as string | null,
  clientSecretPreview: null as string | null,
  redirectUri: `${window.location.origin}${GOOGLE_CALLBACK}`,
};

const OIDC = {
  configured: true,
  source: "setting" as "setting" | "env" | "none",
  issuer: "https://id.example.com" as string | null,
  clientId: "contrack" as string | null,
  clientSecretPreview: "••••1234" as string | null,
  name: "Authentik" as string | null,
  matchByEmail: false,
  envIssuerInvalid: false,
  redirectUri: `${window.location.origin}/api/auth/oidc/callback`,
};

/** Render a row with these integrations. */
function show(
  row: React.ReactNode,
  data: {
    googleOAuth?: Partial<typeof GOOGLE>;
    oidc?: Partial<typeof OIDC>;
  } = {},
) {
  vi.mocked(adminApi.useIntegrations).mockReturnValue({
    data: {
      googleOAuth: { ...GOOGLE, ...data.googleOAuth },
      oidc: { ...OIDC, ...data.oidc },
    },
    isLoading: false,
  } as unknown as ReturnType<typeof adminApi.useIntegrations>);
  return render(<MemoryRouter>{row}</MemoryRouter>);
}

const mutate = vi.fn();
const save = () =>
  screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  mutate.mockReset();
  vi.mocked(adminApi.useUpdateIntegrations).mockReturnValue({
    mutate,
    isPending: false,
  } as unknown as ReturnType<typeof adminApi.useUpdateIntegrations>);
});
afterEach(cleanup);

describe("GoogleRow", () => {
  it("lists the five steps until a client is saved, then folds them away and points to Connectors", () => {
    const { unmount } = show(<GoogleRow />);
    expect(screen.getByText("Not set up")).toBeTruthy();
    const steps = screen.getByRole("list");
    expect(within(steps).getAllByRole("listitem")).toHaveLength(5);
    expect(
      within(steps).getByText(`${window.location.origin}${GOOGLE_CALLBACK}`),
    ).toBeTruthy();
    unmount();

    show(<GoogleRow />, {
      googleOAuth: {
        configured: true,
        source: "setting",
        clientId: "1-x.apps.googleusercontent.com",
        clientSecretPreview: "••••2345",
      },
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
});

describe("the integration rows", () => {
  it.each([
    [
      "the Google client",
      <GoogleRow key="g" />,
      { googleOAuth: { configured: true, source: "env" as const } },
      "Client ID",
      /in GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET, where this server reads them/,
    ],
    [
      "an OIDC_ISSUER that is not https",
      <OidcRow key="o" />,
      {
        oidc: {
          source: "env" as const,
          configured: false,
          issuer: null,
          envIssuerInvalid: true,
        },
      },
      "Issuer",
      /OIDC_ISSUER must start with https/,
    ],
  ])(
    "locks the fields and names the variables when the environment sets %s",
    (_case, row, data, field, words) => {
      show(row, data);
      expect(screen.queryByLabelText(field)).toBeNull();
      expect(screen.getByText(words)).toBeTruthy();
    },
  );

  // Behind an https proxy with no PUBLIC_URL or TRUST_PROXY_HOPS, the server
  // sees http and sends the provider that, while the browser has https.
  it.each([
    [
      "Google",
      <GoogleRow key="g" />,
      {
        googleOAuth: {
          redirectUri: `http://crm.example.com${GOOGLE_CALLBACK}`,
        },
      },
      `http://crm.example.com${GOOGLE_CALLBACK}`,
      /sends Google http:\/\/crm\.example\.com/,
    ],
    [
      "the OIDC provider",
      <OidcRow key="o" />,
      {
        oidc: { redirectUri: "https://crm.example.com/api/auth/oidc/callback" },
      },
      "https://crm.example.com/api/auth/oidc/callback",
      /sends the provider https:\/\/crm\.example\.com/,
    ],
  ])(
    "shows the address the server sends %s, and warns when the browser reached Contrack at another one",
    (_case, row, data, address, warning) => {
      show(row, data);
      expect(screen.getByText(address)).toBeTruthy();
      expect(screen.getByRole("note").textContent).toMatch(warning);
      cleanup();

      show(row);
      expect(screen.queryByRole("note")).toBeNull();
    },
  );
});

describe("OidcRow", () => {
  it("needs a secret for a first setup, sends it trimmed, and shows the button name it saved", async () => {
    show(<OidcRow />, {
      oidc: {
        configured: false,
        source: "none",
        issuer: null,
        clientId: null,
        clientSecretPreview: null,
        name: null,
      },
    });
    expect(
      screen.getByText(/only an account whose\s+email Contrack trusts/i),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText("Button name") as HTMLInputElement).maxLength,
    ).toBe(40);
    type("Issuer", "https://id.example.com");
    type("Client ID", "c");
    expect(save().disabled).toBe(true);
    type("Client secret", " new-secret ");
    fireEvent.click(save());
    expect(mutate.mock.calls[0][0].oidc).toEqual({
      issuer: "https://id.example.com",
      clientId: "c",
      clientSecret: "new-secret",
      name: "OpenID Connect",
      matchByEmail: false,
    });
    mutate.mock.calls[0][1].onSuccess({
      oidc: { ...OIDC, name: "OpenID Connect" },
    });
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Button name") as HTMLInputElement).value,
      ).toBe("OpenID Connect"),
    );
  });

  it("needs the secret again once the issuer or client ID names another client", () => {
    show(<OidcRow />);
    const secret = screen.getByLabelText("Client secret") as HTMLInputElement;
    const keep = "Leave empty to keep the current secret";
    expect(secret.placeholder).toBe(keep);
    type("Client ID", "another");
    expect(save().disabled).toBe(true);
    expect(secret.placeholder).toBe("");

    // The saved issuer's discovery URL names the same client.
    type("Client ID", "contrack");
    type("Issuer", `${OIDC.issuer}/.well-known/openid-configuration`);
    expect(save().disabled).toBe(false);
    expect(secret.placeholder).toBe(keep);

    type("Issuer", "https://other.example.com");
    expect(save().disabled).toBe(true);
    fireEvent.change(secret, { target: { value: "new-secret" } });
    expect(save().disabled).toBe(false);
  });

  it("clears the server's refusal when the secret is typed again", async () => {
    show(<OidcRow />);
    fireEvent.click(
      screen.getByRole("switch", { name: /same verified email/i }),
    );
    fireEvent.click(save());
    mutate.mock.calls[0][1].onError(new Error("Discovery failed"));
    await screen.findByRole("alert");
    type("Client secret", "s");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
