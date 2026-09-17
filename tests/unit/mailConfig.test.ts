import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const settingsStore = new Map<string, unknown>();
vi.mock("../../server/services/settingsService.ts", () => ({
  getSetting: (key: string) => settingsStore.get(key) ?? null,
  setSetting: (key: string, value: unknown) => settingsStore.set(key, value),
  deleteSetting: (key: string) => settingsStore.delete(key),
  clearSettingsCache: () => settingsStore.clear(),
}));

import {
  resolveConfig,
  resolveInternalConfig,
  updateMailSettings,
  deleteMailSettings,
  isConfigured,
  __invalidateTransportCache,
  type StoredSmtpSettings,
} from "../../server/services/mailService.ts";

describe("mailConfig", () => {
  const originalSmtpUrl = process.env.SMTP_URL;
  const originalMailFrom = process.env.MAIL_FROM;

  beforeEach(() => {
    delete process.env.SMTP_URL;
    delete process.env.MAIL_FROM;
    settingsStore.clear();
    __invalidateTransportCache();
  });

  afterEach(() => {
    if (originalSmtpUrl !== undefined) process.env.SMTP_URL = originalSmtpUrl;
    else delete process.env.SMTP_URL;

    if (originalMailFrom !== undefined)
      process.env.MAIL_FROM = originalMailFrom;
    else delete process.env.MAIL_FROM;

    settingsStore.clear();
    __invalidateTransportCache();
  });

  it("returns none source when neither env nor settings are configured", () => {
    const config = resolveConfig();
    expect(config.source).toBe("none");
    expect(config.hasPassword).toBe(false);
    expect(isConfigured()).toBe(false);
  });

  it("parses SMTP_URL correctly with various protocols and auth", () => {
    process.env.SMTP_URL =
      "smtps://mailer%40example.com:secret%21pass@smtp.mailprovider.com:465";
    process.env.MAIL_FROM = "sender@example.com";

    const config = resolveConfig();
    expect(config.source).toBe("env");
    expect(config.host).toBe("smtp.mailprovider.com");
    expect(config.port).toBe(465);
    expect(config.secure).toBe(true);
    expect(config.user).toBe("mailer@example.com");
    expect(config.from).toBe("sender@example.com");
    expect(config.hasPassword).toBe(true);
    expect(
      (config as unknown as Record<string, unknown>).password,
    ).toBeUndefined();

    // Internal config does have the password
    const internal = resolveInternalConfig();
    expect(internal.password).toBe("secret!pass");
    expect(isConfigured()).toBe(true);
  });

  it("defaults smtp protocol port to 587 and secure to false", () => {
    process.env.SMTP_URL = "smtp://relay.local";
    process.env.MAIL_FROM = "alerts@relay.local";

    const config = resolveConfig();
    expect(config.source).toBe("env");
    expect(config.host).toBe("relay.local");
    expect(config.port).toBe(587);
    expect(config.secure).toBe(false);
    expect(config.user).toBe("");
    expect(config.hasPassword).toBe(false);
  });

  it("prioritizes environment config over stored settings", () => {
    // Configure settings first
    updateMailSettings({
      host: "settings-host.com",
      port: 2525,
      secure: false,
      user: "settings-user",
      password: "settings-password",
      from: "settings@example.com",
    });

    let config = resolveConfig();
    expect(config.source).toBe("settings");
    expect(config.host).toBe("settings-host.com");

    // Now set env
    process.env.SMTP_URL = "smtps://env-host.com:465";
    process.env.MAIL_FROM = "env@example.com";

    config = resolveConfig();
    expect(config.source).toBe("env");
    expect(config.host).toBe("env-host.com");
    expect(config.from).toBe("env@example.com");

    // Attempting to update settings while env is active throws 409
    expect(() =>
      updateMailSettings({
        host: "fail.com",
        port: 587,
        secure: false,
        from: "a@b.com",
      }),
    ).toThrow("Mail is configured by the environment (SMTP_URL)");
  });

  it("seals password in settings and round-trips correctly", () => {
    const saved = updateMailSettings({
      host: "smtp.provider.net",
      port: 465,
      secure: true,
      user: "app-user",
      password: "my-unsealed-password",
      from: "crm@provider.net",
      replyTo: "support@provider.net",
    });

    expect(saved.source).toBe("settings");
    expect(saved.hasPassword).toBe(true);
    expect(
      (saved as unknown as Record<string, unknown>).password,
    ).toBeUndefined();

    // Verify stored settings has passwordSealed starting with v1:
    const stored = settingsStore.get("mail.smtp") as StoredSmtpSettings;
    expect(stored).toBeDefined();
    expect(stored.passwordSealed).toMatch(/^v1:/);
    expect(
      (stored as unknown as Record<string, unknown>).password,
    ).toBeUndefined();

    // Internal config unseals it correctly
    const internal = resolveInternalConfig();
    expect(internal.password).toBe("my-unsealed-password");
    expect(internal.host).toBe("smtp.provider.net");
    expect(internal.replyTo).toBe("support@provider.net");

    // Updating without password preserves existing sealed password
    const updated = updateMailSettings({
      host: "smtp2.provider.net",
      port: 587,
      secure: false,
      from: "crm2@provider.net",
    });

    expect(updated.hasPassword).toBe(true);
    const internal2 = resolveInternalConfig();
    expect(internal2.password).toBe("my-unsealed-password");
    expect(internal2.host).toBe("smtp2.provider.net");

    // Deleting settings clears config
    deleteMailSettings();
    expect(resolveConfig().source).toBe("none");
    expect(resolveConfig().hasPassword).toBe(false);
  });
});
