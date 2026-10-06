/**
 * How a device is described in the Devices list: what it runs, and how it
 * signed in.
 *
 * @module shared/devices
 */

/**
 * The ways a session can begin. The server writes one of these to
 * `sessions.method`, and the Devices list names each. A new way to sign in
 * needs a label here, which the compiler asks for.
 */
export type SessionMethod = "password" | "passkey" | "email-link";

const SESSION_METHOD_LABELS: Record<SessionMethod, string> = {
  password: "Password",
  passkey: "Passkey",
  "email-link": "Emailed link",
};

/**
 * The Devices list's words for how a session signed in. A session from before
 * the method was recorded has none, and reads as a password.
 */
export function describeSessionMethod(method?: string | null): string {
  return method && Object.hasOwn(SESSION_METHOD_LABELS, method)
    ? SESSION_METHOD_LABELS[method as SessionMethod]
    : SESSION_METHOD_LABELS.password;
}

/** Turn a User-Agent into something a person can recognize their laptop in. */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  const browser = /Firefox\//.test(userAgent)
    ? "Firefox"
    : /Edg\//.test(userAgent)
      ? "Edge"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "Browser";
  const platform = /iPhone|iPad/.test(userAgent)
    ? "iOS"
    : /Android/.test(userAgent)
      ? "Android"
      : /Mac OS X/.test(userAgent)
        ? "macOS"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "";
  return platform ? `${browser} on ${platform}` : browser;
}
