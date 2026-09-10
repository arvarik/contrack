/**
 * Copy text to the clipboard, in every browser this app runs in.
 *
 * The async Clipboard API is the right one and is not always available: it
 * needs a secure context, which a self-hosted Contrack reached over plain HTTP
 * on a local network does not have. The `execCommand` fallback is deprecated
 * and still works everywhere, which is the whole reason it is here.
 *
 * This matters more in 2.0 than it did: an invitation link, a temporary
 * password and an API token are each shown once and never again. A copy
 * button that silently does nothing loses the value for good.
 *
 * @module lib/clipboard
 */

/** Resolves when the text is on the clipboard, rejects when it is not. */
export function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.cssText =
      "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
    document.body.appendChild(el);
    el.focus();
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    if (ok) resolve();
    else reject(new Error("execCommand copy failed"));
  });
}

/** The message to show when the clipboard refuses. */
export const CLIPBOARD_DENIED =
  "Clipboard access denied — select the text and copy it by hand.";
