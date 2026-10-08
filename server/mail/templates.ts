/**
 * Email templates: invitation, test, password reset and magic link, in plain
 * text and minimal HTML, with the instance name as the sender.
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

/** The HTML shell all four emails share. */
function page(body: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.5; color: #1c1b1f; padding: 16px;">
${body}
</body>
</html>`;
}

/** A button, then the same link as text for mail clients that hide buttons. */
function linkBlock(label: string, link: string): string {
  const href = escapeHtml(link);
  return `  <p style="margin: 24px 0;">
    <a href="${href}" style="display: inline-block; padding: 10px 20px; background-color: #005ac1; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 500;">${label}</a>
  </p>
  <p style="font-size: 13px; color: #44474e;">
    Or open this link in your browser:<br/>
    <a href="${href}" style="color: #005ac1;">${href}</a>
  </p>`;
}

/** The small print under the button. */
function note(text: string): string {
  return `  <p style="font-size: 12px; color: #74777f; margin-top: 32px;">${escapeHtml(text)}</p>`;
}

/** The From header, with the instance name as the display name. */
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

/** The invitation email. */
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

  const html =
    page(`  <p>You have been invited to join <strong>${escapeHtml(name)}</strong>.</p>
${linkBlock("Accept invitation", options.link)}
${note("This invitation link can only be used once.")}`);

  return { subject, text, html };
}

/** The test email. */
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

  const html =
    page(`  <p>This is a test message from <strong>${escapeHtml(name)}</strong>.</p>
  <p>If you received this email, outgoing mail is configured correctly.</p>`);

  return { subject, text, html };
}

/** The password reset email. */
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

  const html =
    page(`  <p>A password reset was requested for your account on <strong>${escapeHtml(name)}</strong>.</p>
${linkBlock("Reset password", options.link)}
${note(expiryText)}`);

  return { subject, text, html };
}

/** The magic link sign-in email. */
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

  const html =
    page(`  <p>Use this link to sign in to <strong>${escapeHtml(name)}</strong>:</p>
${linkBlock("Sign in to Contrack", options.link)}
${note("This link works for 15 minutes and can only be used once.")}`);

  return { subject, text, html };
}
