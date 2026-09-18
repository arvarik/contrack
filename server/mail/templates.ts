/**
 * server/mail/templates.ts — email templates for Contrack.
 *
 * Renders invitation, test, password reset, and magic link emails
 * in plain text and minimal HTML, using the instance name as the sender.
 */

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * Format the sender From header, setting the display name to the instance name.
 */
export function formatSender(
  fromAddress: string,
  instanceName?: string,
): string {
  const trimmed = instanceName?.trim();
  if (trimmed) {
    return `"${trimmed.replace(/"/g, "")}" <${fromAddress}>`;
  }
  return fromAddress;
}

/**
 * Invitation email template.
 */
export function renderInvitationEmail(options: {
  instanceName?: string;
  link: string;
  role?: string;
  expiresAt?: string;
}): RenderedEmail {
  const name = options.instanceName?.trim() || "Contrack";
  const subject = `You've been invited to ${name}`;
  const text = [
    `You have been invited to join ${name}.`,
    "",
    `To accept your invitation and create your account, visit:`,
    options.link,
    "",
    "This invitation link can only be used once.",
  ].join("\n");

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.5; color: #1c1b1f; padding: 16px;">
  <p>You have been invited to join <strong>${escapeHtml(name)}</strong>.</p>
  <p style="margin: 24px 0;">
    <a href="${escapeHtml(options.link)}" style="display: inline-block; padding: 10px 20px; background-color: #005ac1; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 500;">Accept invitation</a>
  </p>
  <p style="font-size: 13px; color: #44474e;">
    Or open this link in your browser:<br/>
    <a href="${escapeHtml(options.link)}" style="color: #005ac1;">${escapeHtml(options.link)}</a>
  </p>
  <p style="font-size: 12px; color: #74777f; margin-top: 32px;">This invitation link can only be used once.</p>
</body>
</html>`;

  return { subject, text, html };
}

/**
 * Test message email template.
 */
export function renderTestEmail(options: {
  instanceName?: string;
}): RenderedEmail {
  const name = options.instanceName?.trim() || "Contrack";
  const subject = `${name}: Test message`;
  const text = [
    `This is a test message from ${name}.`,
    "",
    "If you received this email, outgoing mail is configured correctly.",
  ].join("\n");

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.5; color: #1c1b1f; padding: 16px;">
  <p>This is a test message from <strong>${escapeHtml(name)}</strong>.</p>
  <p>If you received this email, outgoing mail is configured correctly.</p>
</body>
</html>`;

  return { subject, text, html };
}

// ─── Future templates (Prompt 3: Reset and sign-in links) ───────────────────

/**
 * Password reset email template (implemented in Prompt 3).
 */
export function renderPasswordResetEmail(options: {
  instanceName?: string;
  link: string;
  expiresHours?: number;
}): RenderedEmail {
  const name = options.instanceName?.trim() || "Contrack";
  const subject = `Reset your password for ${name}`;
  const hours = options.expiresHours ?? 1;
  const expiryText =
    hours === 1
      ? "This link works for one hour and can only be used once."
      : `This link works for ${hours} hours and can only be used once.`;

  const text = [
    `A password reset was requested for your account on ${name}.`,
    "",
    `To choose a new password, visit:`,
    options.link,
    "",
    expiryText,
    "If you did not request this reset, you can safely ignore this message.",
  ].join("\n");

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.5; color: #1c1b1f; padding: 16px;">
  <p>A password reset was requested for your account on <strong>${escapeHtml(name)}</strong>.</p>
  <p style="margin: 24px 0;">
    <a href="${escapeHtml(options.link)}" style="display: inline-block; padding: 10px 20px; background-color: #005ac1; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 500;">Reset password</a>
  </p>
  <p style="font-size: 13px; color: #44474e;">
    Or open this link in your browser:<br/>
    <a href="${escapeHtml(options.link)}" style="color: #005ac1;">${escapeHtml(options.link)}</a>
  </p>
  <p style="font-size: 12px; color: #74777f; margin-top: 32px;">${escapeHtml(expiryText)}</p>
</body>
</html>`;

  return { subject, text, html };
}

/**
 * Magic link sign-in email template (implemented in Prompt 3).
 */
export function renderMagicLinkEmail(options: {
  instanceName?: string;
  link: string;
}): RenderedEmail {
  const name = options.instanceName?.trim() || "Contrack";
  const subject = `Sign in to ${name}`;
  const text = [
    `Use this link to sign in to ${name}:`,
    options.link,
    "",
    "This link works for 15 minutes and can only be used once.",
  ].join("\n");

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.5; color: #1c1b1f; padding: 16px;">
  <p>Use this link to sign in to <strong>${escapeHtml(name)}</strong>:</p>
  <p style="margin: 24px 0;">
    <a href="${escapeHtml(options.link)}" style="display: inline-block; padding: 10px 20px; background-color: #005ac1; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 500;">Sign in to Contrack</a>
  </p>
  <p style="font-size: 13px; color: #44474e;">
    Or open this link in your browser:<br/>
    <a href="${escapeHtml(options.link)}" style="color: #005ac1;">${escapeHtml(options.link)}</a>
  </p>
  <p style="font-size: 12px; color: #74777f; margin-top: 32px;">This link works for 15 minutes and can only be used once.</p>
</body>
</html>`;

  return { subject, text, html };
}
