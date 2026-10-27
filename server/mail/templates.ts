/**
 * Email templates: invitation, test, password reset, magic link, email change
 * and account notices, in plain text and minimal HTML, with the instance name
 * as the sender.
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

/** The HTML shell every email shares. */
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

/** The email-change confirmation, sent to the new address. */
export function renderEmailChangeEmail(options: {
  instanceName?: string;
  link: string;
  email: string;
}): RenderedEmail {
  const name = options.instanceName?.trim() || "Contrack";
  const subject = `Confirm your new email for ${name}`;
  const expiryText =
    "This link works for 24 hours and can only be used once. Until you open it, your account keeps its old email.";
  const text = [
    `Your account on ${name} asked to use ${options.email} as its email.`,
    "",
    "To confirm, visit:",
    options.link,
    "",
    expiryText,
    "If you did not ask for this, you can safely ignore this message.",
  ].join("\n");

  const html =
    page(`  <p>Your account on <strong>${escapeHtml(name)}</strong> asked to use <strong>${escapeHtml(options.email)}</strong> as its email.</p>
${linkBlock("Confirm new email", options.link)}
${note(expiryText)}`);

  return { subject, text, html };
}

/** A change to how an account signs in, for the person it belongs to. */
export type AccountNotice =
  | { kind: "email-change"; email: string }
  | { kind: "sign-on-linked"; provider: string }
  | { kind: "sign-on-unlinked"; provider: string };

/**
 * The notice of an account change, so a change its owner did not make does not
 * go unseen. It holds no link: the person acts in Contrack itself.
 */
export function renderAccountNoticeEmail(
  options: { instanceName?: string } & AccountNotice,
): RenderedEmail {
  const name = options.instanceName?.trim() || "Contrack";
  const what =
    options.kind === "email-change"
      ? {
          subject: `Your email for ${name} is changing`,
          line: `Your account on ${name} asked to use ${options.email} as its email. The change happens only when that address opens the link it was sent.`,
          act: "If this was not you, change your password now and cancel the change under Account settings.",
        }
      : options.kind === "sign-on-linked"
        ? {
            subject: `Single sign-on was linked to your account on ${name}`,
            line: `Your account on ${name} can now sign in with ${options.provider}.`,
            act: "If this was not you, change your password now and unlink it under Account settings.",
          }
        : {
            subject: `Single sign-on was unlinked from your account on ${name}`,
            line: `Your account on ${name} no longer signs in with ${options.provider}.`,
            act: "If this was not you, change your password now.",
          };
  const text = [what.line, "", what.act].join("\n");
  const html = page(`  <p>${escapeHtml(what.line)}</p>
${note(what.act)}`);
  return { subject: what.subject, text, html };
}
