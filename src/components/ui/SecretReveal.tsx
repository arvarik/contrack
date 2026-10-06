/**
 * A value shown once: an API token, a temporary password, an invitation
 * link. The server keeps only a hash.
 *
 * A secret to be typed is shown in groups, separate elements with margin and
 * no space characters, so a hand selection copies the same characters as the
 * button. `inline-block`, not flex: a browser copies blockified flex items
 * with a line break between each.
 *
 * A secret to be pasted (a token, a link) is shown whole and wrapped.
 */
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { copyToClipboard, CLIPBOARD_DENIED } from "../../lib/clipboard";
import { groupSecret } from "../../lib/credentials";
import { cn } from "../../lib/utils";

export const SecretReveal = ({
  value,
  label,
  /** Break the value into readable groups. For values a person will type. */
  grouped = false,
}: {
  value: string;
  /** Names the value in the copy confirmation, e.g. "Token". */
  label: string;
  grouped?: boolean;
}) => {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    copyToClipboard(value)
      .then(() => {
        setCopied(true);
        toast.success(`${label} copied`);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => toast.error(CLIPBOARD_DENIED));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2 rounded-xl bg-surface-container-highest p-3">
        <code
          // `select-all`: one click takes the whole value.
          className={cn(
            "flex-1 min-w-0 select-all font-mono text-sm text-on-surface",
            grouped
              ? "block leading-loose [&>span]:inline-block [&>span]:mr-3"
              : "block break-all leading-relaxed",
          )}
        >
          {grouped
            ? groupSecret(value).map((group, index) => (
                <span key={`${index}-${group}`}>{group}</span>
              ))
            : value}
        </code>
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy ${label.toLowerCase()}`}
          className={cn(
            "shrink-0 inline-flex items-center justify-center",
            "min-w-[44px] min-h-[44px] -m-1.5 rounded-full transition-colors",
            copied
              ? "text-success"
              : "state-layer text-on-surface-variant hover:text-on-surface",
          )}
        >
          {copied ? (
            <Check className="w-4 h-4" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
        </button>
      </div>
      <p className="text-xs font-bold text-warning text-pretty">
        Copy it now. It will not be shown again
      </p>
    </div>
  );
};
