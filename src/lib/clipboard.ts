/**
 * Copy text to the clipboard in every browser. The async Clipboard API needs
 * a secure context, which a self-hosted Contrack on plain HTTP lacks, so the
 * deprecated `execCommand` is the fallback. A secret shown once must not be
 * lost to a copy button that silently does nothing.
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
  "Could not copy. Select the text and copy it by hand";
