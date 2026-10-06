// Integration: AI keys saved in Settings are sealed at rest
// Keys entered on the AI providers page are sealed with the instance secret,
// as SMTP passwords, connector feeds and Google OAuth are, so a backup or a
// copy of the database holds no key in plain text.
//
// Built-in keys are saved through the service, not the route, because the
// route checks the key against the real vendor.

import crypto from "node:crypto";
import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";
import { sqlite } from "../../server/db.ts";
import {
  clearSettingsCache,
  setSetting,
  SETTING_KEYS,
} from "../../server/services/settingsService.ts";
import {
  getProviderConfig,
  invalidateProviderCache,
} from "../../server/ai/providerRegistry.ts";
import { setProviderKey } from "../../server/services/aiSettingsService.ts";
import { seal } from "../../server/utils/secretBox.ts";

const app = makeTestApp();

/** Refused at once, so saving an endpoint reaches no network. */
const UNREACHABLE = "http://127.0.0.1:59999/v1";

/** The row as SQLite holds it, which is what a backup copies. */
function stored(key: string): string {
  const row = sqlite
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? "";
}

/** Read from the database again, as a restarted server would. */
function reload(): void {
  clearSettingsCache();
  invalidateProviderCache();
}

afterEach(() => {
  sqlite.prepare("DELETE FROM app_settings").run();
  reload();
});

describe("AI keys at rest", () => {
  it("seals a provider key and reads it back", () => {
    setProviderKey("openai", "sk-proj-plain-4321");

    const row = stored(SETTING_KEYS.aiProviderKeys);
    expect(row).not.toContain("sk-proj-plain-4321");
    expect(JSON.parse(row).openai).toMatch(/^v1:/);

    reload();
    expect(getProviderConfig("openai")?.apiKey).toBe("sk-proj-plain-4321");
  });

  it("seals a custom endpoint key and previews the real key", async () => {
    await request(app).put("/api/settings/ai/endpoints").send({
      id: "local",
      label: "Local",
      baseUrl: UNREACHABLE,
      apiKey: "sk-endpoint-8765",
    });

    const row = stored(SETTING_KEYS.aiCustomEndpoints);
    expect(row).not.toContain("sk-endpoint-8765");
    expect(JSON.parse(row)[0].apiKey).toMatch(/^v1:/);

    reload();
    const view = await request(app).get("/api/settings/ai");
    const endpoint = view.body.customEndpoints.find(
      (e: { id: string }) => e.id === "local",
    );
    expect(endpoint.keyPreview).toBe("••••8765");
    expect(getProviderConfig("custom:local")?.apiKey).toBe("sk-endpoint-8765");
  });

  it("treats a key that is not sealed, or sealed with another secret, as no key", () => {
    setSetting(SETTING_KEYS.aiProviderKeys, { openai: "sk-plain-1111" });
    expect(getProviderConfig("openai")).toBeNull();

    // What a lost DATA_DIR/secret.key or a changed CONTRACK_SECRET_KEY
    // leaves behind. The provider must read as not connected, so the user
    // enters the key again, rather than send the sealed text as the key.
    const otherSecret = crypto.randomBytes(32);
    setSetting(SETTING_KEYS.aiProviderKeys, {
      openai: seal("sk-other-3333", otherSecret),
    });
    expect(getProviderConfig("openai")).toBeNull();
  });

  it("refuses a key that is only spaces", () => {
    expect(() => setProviderKey("openai", "   ")).toThrow(/required/i);
    expect(stored(SETTING_KEYS.aiProviderKeys)).toBe("");
  });
});
