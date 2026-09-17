/**
 * server/services/mailService.ts — Outgoing mail service.
 *
 * Resolves SMTP configuration from the environment (SMTP_URL, MAIL_FROM)
 * or instance settings (key "mail.smtp"). Manages nodemailer transport,
 * enforces a 10s timeout, provides safe sending and test sending, and exposes
 * a JSON transport test seam.
 */

import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";
import { AppError } from "../utils/AppError.ts";
import { getSetting, setSetting, deleteSetting } from "./settingsService.ts";
import { seal, open, SecretUnavailableError } from "../utils/secretBox.ts";
import { formatSender } from "../mail/templates.ts";
import { getInstanceName } from "./authService.ts";

export type MailSource = "env" | "settings" | "none";

export interface MailConfig {
  source: MailSource;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  replyTo: string;
  hasPassword: boolean;
}

export interface InternalMailConfig extends MailConfig {
  password?: string;
}

export interface StoredSmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  passwordSealed?: string;
  from: string;
  replyTo?: string;
}

export interface SendMailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface RecordedMessage {
  from?: string;
  to?: string | string[];
  subject?: string;
  text?: string;
  html?: string;
  messageId?: string;
  [key: string]: unknown;
}

const SETTING_KEY = "mail.smtp";

// ── Test seam state ─────────────────────────────────────────────────────────

let isJsonTransportActive = false;
const recordedMessages: RecordedMessage[] = [];

/**
 * Activates the JSON transport test seam.
 * When active, emails are recorded into an in-memory list rather than sent over the network.
 */
export function __useJsonTransport(enabled = true): {
  getMessages: () => RecordedMessage[];
  clear: () => void;
} {
  isJsonTransportActive = enabled;
  if (!enabled) {
    recordedMessages.length = 0;
  }
  return {
    getMessages: () => [...recordedMessages],
    clear: () => {
      recordedMessages.length = 0;
    },
  };
}

export function __getSentMessages(): RecordedMessage[] {
  return [...recordedMessages];
}

export function __clearSentMessages(): void {
  recordedMessages.length = 0;
}

// ── Transport cache ─────────────────────────────────────────────────────────

let cachedTransport: Transporter | null = null;
let cachedTransportKey: string | null = null;

export function __invalidateTransportCache(): void {
  cachedTransport = null;
  cachedTransportKey = null;
}

// ── Configuration resolution ────────────────────────────────────────────────

function parseSmtpUrl(urlStr: string): {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password?: string;
} {
  const url = new URL(urlStr);
  const secure = url.protocol === "smtps:";
  const port = url.port ? parseInt(url.port, 10) : secure ? 465 : 587;
  const host = url.hostname;
  const user = url.username ? decodeURIComponent(url.username) : "";
  const password = url.password ? decodeURIComponent(url.password) : undefined;
  return { host, port, secure, user, password };
}

/**
 * Resolves internal configuration (including unsealed password).
 */
export function resolveInternalConfig(): InternalMailConfig {
  if (process.env.SMTP_URL) {
    try {
      const parsed = parseSmtpUrl(process.env.SMTP_URL);
      const from =
        process.env.MAIL_FROM || (parsed.user.includes("@") ? parsed.user : "");
      return {
        source: "env",
        host: parsed.host,
        port: parsed.port,
        secure: parsed.secure,
        user: parsed.user,
        password: parsed.password,
        from,
        replyTo: process.env.MAIL_REPLY_TO || "",
        hasPassword: Boolean(parsed.password),
      };
    } catch (err) {
      log.warn("Mail", `Failed to parse SMTP_URL: ${getErrorMessage(err)}`);
    }
  }

  const stored = getSetting<StoredSmtpSettings>(SETTING_KEY);
  if (stored && stored.host) {
    let password: string | undefined;
    if (stored.passwordSealed) {
      try {
        password = open(stored.passwordSealed);
      } catch (err) {
        if (err instanceof SecretUnavailableError) {
          log.warn(
            "Mail",
            `Stored SMTP password cannot be decrypted with current secret key: ${getErrorMessage(err)}`,
          );
        } else {
          log.warn(
            "Mail",
            `Could not unseal stored SMTP password: ${getErrorMessage(err)}`,
          );
        }
      }
    }
    return {
      source: "settings",
      host: stored.host,
      port: stored.port || (stored.secure ? 465 : 587),
      secure: Boolean(stored.secure),
      user: stored.user || "",
      password,
      from: stored.from || "",
      replyTo: stored.replyTo || "",
      hasPassword: Boolean(stored.passwordSealed),
    };
  }

  return {
    source: "none",
    host: "",
    port: 587,
    secure: false,
    user: "",
    from: "",
    replyTo: "",
    hasPassword: false,
  };
}

/**
 * Resolves public configuration (without password) for UI and API consumption.
 */
export function resolveConfig(): MailConfig {
  const internal = resolveInternalConfig();
  const { password: _pw, ...publicConfig } = internal;
  return publicConfig;
}

/**
 * True if mail has been configured (via env or settings) with valid host and from.
 */
export function isConfigured(): boolean {
  if (isJsonTransportActive) return true;
  const config = resolveConfig();
  return (
    config.source !== "none" && Boolean(config.host) && Boolean(config.from)
  );
}

/**
 * Update mail settings from the admin Outgoing mail page.
 */
export function updateMailSettings(input: {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
  replyTo?: string;
}): MailConfig {
  const current = resolveConfig();
  if (current.source === "env") {
    throw new AppError(
      "Mail is configured by the environment (SMTP_URL). Edit the environment to change it.",
      409,
      { code: "MAIL_CONFIGURED_BY_ENV" },
    );
  }

  const stored = getSetting<StoredSmtpSettings>(SETTING_KEY);
  let passwordSealed = stored?.passwordSealed;

  if (input.password !== undefined && input.password !== "") {
    passwordSealed = seal(input.password);
  }

  const newSettings: StoredSmtpSettings = {
    host: input.host.trim(),
    port: input.port,
    secure: Boolean(input.secure),
    user: input.user?.trim() || "",
    passwordSealed,
    from: input.from.trim(),
    replyTo: input.replyTo?.trim() || "",
  };

  setSetting(SETTING_KEY, newSettings);
  __invalidateTransportCache();

  return resolveConfig();
}

/**
 * Delete stored mail settings.
 */
export function deleteMailSettings(): MailConfig {
  const current = resolveConfig();
  if (current.source === "env") {
    throw new AppError(
      "Mail is configured by the environment (SMTP_URL)",
      409,
      { code: "MAIL_CONFIGURED_BY_ENV" },
    );
  }

  deleteSetting(SETTING_KEY);
  __invalidateTransportCache();
  return resolveConfig();
}

// ── Transport initialization ────────────────────────────────────────────────

function getTransport(): Transporter {
  if (isJsonTransportActive) {
    return nodemailer.createTransport({ jsonTransport: true });
  }

  const config = resolveInternalConfig();
  if (config.source === "none" || !config.host) {
    throw new AppError("Mail is not configured", 409, {
      code: "MAIL_NOT_CONFIGURED",
    });
  }

  const cacheKey = JSON.stringify({
    host: config.host,
    port: config.port,
    secure: config.secure,
    user: config.user,
    hasPassword: Boolean(config.password),
  });

  if (cachedTransport && cachedTransportKey === cacheKey) {
    return cachedTransport;
  }

  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user
      ? {
          user: config.user,
          pass: config.password || "",
        }
      : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
  });

  cachedTransport = transport;
  cachedTransportKey = cacheKey;
  return transport;
}

// ── Mail Sending ────────────────────────────────────────────────────────────

/**
 * Sends an email, throwing on error. Used by the test route.
 */
export async function sendOrThrow(
  options: SendMailOptions,
): Promise<{ messageId?: string }> {
  const config = resolveInternalConfig();
  if (!isJsonTransportActive && (config.source === "none" || !config.host)) {
    throw new AppError("Mail is not configured", 409, {
      code: "MAIL_NOT_CONFIGURED",
    });
  }

  const fromAddress = config.from || "noreply@contrack.local";
  const instanceName = getInstanceName();
  const from = formatSender(fromAddress, instanceName);

  const transport = getTransport();
  try {
    const info = await transport.sendMail({
      from,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
      replyTo: config.replyTo || undefined,
    });

    if (isJsonTransportActive && typeof info.message === "string") {
      try {
        const parsed = JSON.parse(info.message) as RecordedMessage;
        recordedMessages.push(parsed);
      } catch {
        recordedMessages.push({
          from,
          to: options.to,
          subject: options.subject,
          text: options.text,
          html: options.html,
        });
      }
    }

    return { messageId: info.messageId };
  } catch (err) {
    log.warn(
      "Mail",
      `sendOrThrow failed to ${options.to}: ${getErrorMessage(err)}`,
    );
    throw err;
  }
}

/**
 * Sends an email safely. Never throws to a route; logs warning on failure.
 * Returns true if sending succeeded, false otherwise.
 */
export async function send(options: SendMailOptions): Promise<boolean> {
  try {
    if (!isConfigured()) {
      log.warn(
        "Mail",
        `Cannot send email to ${options.to}: mail is not configured`,
      );
      return false;
    }
    await sendOrThrow(options);
    return true;
  } catch (err) {
    log.warn(
      "Mail",
      `Failed to send email to ${options.to}: ${getErrorMessage(err)}`,
    );
    return false;
  }
}

export const mailService = {
  resolveConfig,
  resolveInternalConfig,
  isConfigured,
  updateMailSettings,
  deleteMailSettings,
  send,
  sendOrThrow,
  __useJsonTransport,
  __getSentMessages,
  __clearSentMessages,
  __invalidateTransportCache,
};
