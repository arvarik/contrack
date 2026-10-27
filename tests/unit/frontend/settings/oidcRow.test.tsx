// @vitest-environment jsdom
// The OpenID Connect row in Settings → Administration → General: it fills
// from the saved provider, saves any change on its own (an empty secret keeps
// the saved one for the same client), shows the server's refusal, and locks
// to a read-only block when OIDC_* sets the provider.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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

import { OidcRow } from "../../../../src/views/settings/admin/GeneralView";

const SAVED: {
  configured: boolean;
  source: "setting" | "env" | "none";
  issuer: string | null;
  clientId: string | null;
  clientSecretPreview: string | null;
  name: string | null;
  matchByEmail: boolean;
  envIssuerInvalid: boolean;
  redirectUri: string;
} = {
  configured: true,
  source: "setting",
  issuer: "https://id.example.com",
  clientId: "contrack",
  clientSecretPreview: "••••1234",
  name: "Authentik",
  matchByEmail: false,
  envIssuerInvalid: false,
  redirectUri: `${window.location.origin}/api/auth/oidc/callback`,
};

const mutate = vi.fn();

function show(oidc: Partial<typeof SAVED> = {}) {
  vi.mocked(adminApi.useIntegrations).mockReturnValue({
    data: { oidc: { ...SAVED, ...oidc } },
    isLoading: false,
  } as unknown as ReturnType<typeof adminApi.useIntegrations>);
  return render(
    <MemoryRouter>
      <OidcRow />
    </MemoryRouter>,
  );
}

const save = () => screen.getByRole("button", { name: "Save" });

beforeEach(() => {
  mutate.mockReset();
  vi.mocked(adminApi.useUpdateIntegrations).mockReturnValue({
    mutate,
    isPending: false,
  } as unknown as ReturnType<typeof adminApi.useUpdateIntegrations>);
});
afterEach(cleanup);

describe("OidcRow", () => {
  it("fills Issuer and Client ID from the saved provider and starts with Save off", () => {
    show();
    expect((screen.getByLabelText("Issuer") as HTMLInputElement).value).toBe(
      SAVED.issuer,
    );
    expect((screen.getByLabelText("Client ID") as HTMLInputElement).value).toBe(
      "contrack",
    );
    expect((save() as HTMLButtonElement).disabled).toBe(true);
  });

  it("saves the switch alone without a client secret", () => {
    show();
    fireEvent.click(
      screen.getByRole("switch", {
        name: /same verified email can sign in/i,
      }),
    );
    expect((save() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save());
    expect(mutate.mock.calls[0][0]).toEqual({
      oidc: {
        issuer: SAVED.issuer,
        clientId: "contrack",
        name: "Authentik",
        matchByEmail: true,
      },
    });
  });

  it("sends a typed secret, and limits the button name to 40 characters", () => {
    show();
    expect(
      (screen.getByLabelText("Button name") as HTMLInputElement).maxLength,
    ).toBe(40);
    fireEvent.change(screen.getByLabelText("Client secret"), {
      target: { value: " new-secret " },
    });
    fireEvent.click(save());
    expect(mutate.mock.calls[0][0].oidc.clientSecret).toBe("new-secret");
  });

  it("needs a secret for a first setup, and starts with matching off", () => {
    show({
      configured: false,
      source: "none",
      issuer: null,
      clientId: null,
      clientSecretPreview: null,
      name: null,
    });
    fireEvent.change(screen.getByLabelText("Issuer"), {
      target: { value: "https://id.example.com" },
    });
    fireEvent.change(screen.getByLabelText("Client ID"), {
      target: { value: "c" },
    });
    expect((save() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Client secret"), {
      target: { value: "s" },
    });
    fireEvent.click(save());
    expect(mutate.mock.calls[0][0].oidc).toMatchObject({
      name: "OpenID Connect",
      matchByEmail: false,
    });
  });

  it("needs the secret again once the issuer or client ID names another client", () => {
    show();
    const secret = screen.getByLabelText("Client secret") as HTMLInputElement;
    const keep = "Leave empty to keep the current secret";
    expect(secret.placeholder).toBe(keep);
    fireEvent.change(screen.getByLabelText("Client ID"), {
      target: { value: "another" },
    });
    expect((save() as HTMLButtonElement).disabled).toBe(true);
    expect(secret.placeholder).toBe("");

    // The saved issuer's discovery URL names the same client.
    fireEvent.change(screen.getByLabelText("Client ID"), {
      target: { value: "contrack" },
    });
    fireEvent.change(screen.getByLabelText("Issuer"), {
      target: { value: `${SAVED.issuer}/.well-known/openid-configuration` },
    });
    expect((save() as HTMLButtonElement).disabled).toBe(false);
    expect(secret.placeholder).toBe(keep);

    fireEvent.change(screen.getByLabelText("Issuer"), {
      target: { value: "https://other.example.com" },
    });
    expect((save() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(secret, { target: { value: "new-secret" } });
    expect((save() as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the server's refusal next to the form", async () => {
    show();
    fireEvent.click(
      screen.getByRole("switch", { name: /same verified email/i }),
    );
    fireEvent.click(save());
    mutate.mock.calls[0][1].onError(
      new Error("The provider did not answer discovery: timeout"),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "did not answer discovery",
      ),
    );
  });

  it("shows the saved button name after saving an empty one", async () => {
    show();
    fireEvent.change(screen.getByLabelText("Button name"), {
      target: { value: "" },
    });
    fireEvent.click(save());
    expect(mutate.mock.calls[0][0].oidc.name).toBe("OpenID Connect");
    mutate.mock.calls[0][1].onSuccess({
      oidc: { ...SAVED, name: "OpenID Connect" },
    });
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Button name") as HTMLInputElement).value,
      ).toBe("OpenID Connect"),
    );
  });

  it("clears the refusal when the secret is typed again", async () => {
    show();
    fireEvent.click(
      screen.getByRole("switch", { name: /same verified email/i }),
    );
    fireEvent.click(save());
    mutate.mock.calls[0][1].onError(new Error("Discovery failed"));
    await screen.findByRole("alert");
    fireEvent.change(screen.getByLabelText("Client secret"), {
      target: { value: "s" },
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("explains which account emails Contrack trusts", () => {
    show();
    expect(
      screen.getByText(/only an account whose\s+email Contrack trusts/i),
    ).toBeTruthy();
  });

  it("locks to a read-only block when the environment sets the provider", () => {
    show({ source: "env", matchByEmail: true });
    expect(screen.queryByLabelText("Issuer")).toBeNull();
    expect(screen.getByText("https://id.example.com")).toBeTruthy();
    expect(screen.getByText("Authentik")).toBeTruthy();
    expect(screen.getByText("On")).toBeTruthy();
    const note = screen.getByText(/^Set by OIDC_ISSUER/);
    for (const name of [
      "OIDC_CLIENT_SECRET",
      "OIDC_NAME",
      "OIDC_MATCH_BY_EMAIL",
    ]) {
      expect(note.textContent).toContain(name);
    }
  });

  it("warns that OIDC_ISSUER must be https when the environment's issuer is refused", () => {
    show({
      source: "env",
      configured: false,
      issuer: null,
      envIssuerInvalid: true,
    });
    expect(screen.getByText(/OIDC_ISSUER must start with https/)).toBeTruthy();
  });

  it("warns when the browser opened Contrack at another address than the server sends", () => {
    show({ redirectUri: "https://crm.example.com/api/auth/oidc/callback" });
    expect(
      screen.getByText(/sends the provider https:\/\/crm\.example\.com/),
    ).toBeTruthy();
  });
});
