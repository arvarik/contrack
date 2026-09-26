// =============================================================================
// Integration: AI keys saved in Settings are sealed at rest
// =============================================================================
// Keys entered in Settings → AI sat in app_settings as plain text, and so in
// every backup and every copy of the database. SMTP passwords, connector
// feeds and Google OAuth were already sealed with the instance secret. AI keys
// are now sealed the same way. A key saved before this change still works,
// and a boot pass seals it.
//
// Built-in keys are saved through the service, not the route, because the
// route checks the key against the real vendor.
// =============================================================================

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
import {
  sealStoredAiKeys,
  setProviderKey,
} from "../../server/services/aiSettingsService.ts";
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

  it("reads a key saved as plain text, and the boot pass seals it", () => {
    setSetting(SETTING_KEYS.aiProviderKeys, { openai: "sk-legacy-1111" });
    setSetting(SETTING_KEYS.aiCustomEndpoints, [
      {
        id: "old",
        label: "Old",
        baseUrl: UNREACHABLE,
        apiKey: "sk-legacy-2222",
      },
      { id: "keyless", label: "Keyless", baseUrl: UNREACHABLE },
    ]);
    expect(getProviderConfig("openai")?.apiKey).toBe("sk-legacy-1111");

    expect(sealStoredAiKeys()).toBe(2);

    const keys = stored(SETTING_KEYS.aiProviderKeys);
    const endpoints = stored(SETTING_KEYS.aiCustomEndpoints);
    expect(keys + endpoints).not.toContain("sk-legacy");
    expect(JSON.parse(endpoints)[1].apiKey).toBeUndefined();

    reload();
    expect(getProviderConfig("openai")?.apiKey).toBe("sk-legacy-1111");
    expect(getProviderConfig("custom:old")?.apiKey).toBe("sk-legacy-2222");
    expect(getProviderConfig("custom:keyless")?.apiKey).toBeUndefined();

    // The next boot finds nothing to seal, and changes nothing.
    expect(sealStoredAiKeys()).toBe(0);
    expect(stored(SETTING_KEYS.aiProviderKeys)).toBe(keys);
  });

  it("treats a key sealed with a different secret as no key", () => {
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
