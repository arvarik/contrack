import { describe, it, expect, afterEach, vi } from "vitest";
import { makeTestApp } from "./helpers.ts";
import { log } from "../../server/utils/logger.ts";
import { seal } from "../../server/utils/secretBox.ts";
import {
  setSetting,
  SETTING_KEYS,
} from "../../server/services/settingsService.ts";
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
  it("round-trips a sealed config, redacts the secret in the status, and clears with null", () => {
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
      envIssuerInvalid: false,
    });
    expect(JSON.stringify(status)).not.toContain(INPUT.clientSecret);

    setOidcConfig(null);
    expect(getOidcConfig()).toBeNull();
    expect(getIntegrationsStatus().oidc.configured).toBe(false);
  });

  it("lets the environment win, and matches by email only for true", () => {
    setOidcConfig(INPUT);
    process.env.OIDC_ISSUER = "https://sso.example.org";
    process.env.OIDC_CLIENT_ID = "env-id";
    process.env.OIDC_CLIENT_SECRET = "env-secret";
    expect(getOidcConfig()).toEqual({
      issuer: "https://sso.example.org",
      clientId: "env-id",
      clientSecret: "env-secret",
      name: "OpenID Connect",
      matchByEmail: false,
      source: "env",
    });
    for (const [value, matchByEmail] of [
      ["false", false],
      ["yes", false],
      ["true", true],
    ] as const) {
      process.env.OIDC_MATCH_BY_EMAIL = value;
      expect(getOidcConfig()?.matchByEmail, value).toBe(matchByEmail);
    }

    delete process.env.OIDC_ISSUER;
    // A saved provider without the field, and the status with no provider.
    setSetting(
      SETTING_KEYS.oidc,
      seal(JSON.stringify({ ...INPUT, matchByEmail: undefined })),
    );
    expect(getOidcConfig()?.matchByEmail).toBe(false);
    setOidcConfig(null);
    expect(getIntegrationsStatus().oidc.matchByEmail).toBe(false);
  });

  it("leaves sign-in off for an OIDC_ISSUER that is not https, and warns once", () => {
    const warn = vi.spyOn(log, "warn");
    process.env.OIDC_ISSUER = "http://idp.lan";
    process.env.OIDC_CLIENT_ID = "env-id";
    process.env.OIDC_CLIENT_SECRET = "env-secret";
    expect(getOidcConfig()).toBeNull();
    expect(getOidcConfig()).toBeNull();
    const warnings = warn.mock.calls.filter(([, msg]) =>
      String(msg).includes("OIDC_ISSUER"),
    );
    expect(warnings).toHaveLength(1);
    warn.mockRestore();
    // The environment still owns the setting, so the admin card stays locked.
    expect(getIntegrationsStatus().oidc).toMatchObject({
      configured: false,
      source: "env",
      envIssuerInvalid: true,
    });
  });
});
