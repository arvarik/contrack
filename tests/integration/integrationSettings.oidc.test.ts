import { describe, it, expect, afterEach } from "vitest";
import { makeTestApp } from "./helpers.ts";
import {
  getOidcConfig,
  setOidcConfig,
  getIntegrationsStatus,
} from "../../server/services/integrationSettings.ts";

makeTestApp(); // opens the test database

const INPUT = {
  issuer: "https://id.example.com/application/o/contrack/",
  clientId: "contrack",
  clientSecret: "s3cret-value-1234",
  name: "Authentik",
  matchByEmail: true,
};

afterEach(() => {
  setOidcConfig(null);
  delete process.env.OIDC_ISSUER;
  delete process.env.OIDC_CLIENT_ID;
  delete process.env.OIDC_CLIENT_SECRET;
  delete process.env.OIDC_NAME;
  delete process.env.OIDC_MATCH_BY_EMAIL;
});

describe("OIDC integration settings", () => {
  it("round-trips a sealed config and redacts the secret in the status", () => {
    setOidcConfig(INPUT);
    expect(getOidcConfig()).toEqual({ ...INPUT, source: "setting" });
    const status = getIntegrationsStatus().oidc;
    expect(status).toMatchObject({
      configured: true,
      source: "setting",
      issuer: INPUT.issuer,
      clientId: "contrack",
      clientSecretPreview: "••••1234",
      name: "Authentik",
      matchByEmail: true,
    });
    expect(JSON.stringify(status)).not.toContain(INPUT.clientSecret);
  });

  it("clears with null", () => {
    setOidcConfig(INPUT);
    setOidcConfig(null);
    expect(getOidcConfig()).toBeNull();
    expect(getIntegrationsStatus().oidc.configured).toBe(false);
  });

  it("lets the environment win", () => {
    setOidcConfig(INPUT);
    process.env.OIDC_ISSUER = "https://sso.example.org";
    process.env.OIDC_CLIENT_ID = "env-id";
    process.env.OIDC_CLIENT_SECRET = "env-secret";
    process.env.OIDC_MATCH_BY_EMAIL = "false";
    expect(getOidcConfig()).toEqual({
      issuer: "https://sso.example.org",
      clientId: "env-id",
      clientSecret: "env-secret",
      name: "Single sign-on",
      matchByEmail: false,
      source: "env",
    });
  });
});
