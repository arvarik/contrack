/**
 * SecretReveal — a value that exists on this screen and nowhere else.
 *
 * Three things in 2.0 are shown exactly once: a personal API token, the
 * temporary password an administrator hands over, and an invitation link. The
 * server keeps only a hash of each, so a person who navigates away without
 * taking the value has lost it. That fact is what this component is for.
 *
 * Two details are load-bearing.
 *
 * A secret meant to be read aloud or typed is shown in groups, because a
 * 20-character mixed-case string in one run is where transcription errors
 * come from. The groups are separate elements with a CSS gap and no space
 * characters between them, so selecting the text by hand gives exactly the
 * same characters as the copy button. A literal space would be a different
 * password.
 *
 * A secret meant to be pasted — a token, a link — is shown whole and
 * wrapped. Grouping a URL would be nonsense, and grouping a token invites
 * somebody to type it.
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
  note = "Copy it now. It will not be shown again.",
}: {
  value: string;
  /** Names the value in the copy confirmation, e.g. "Token". */
  label: string;
  grouped?: boolean;
  note?: string;
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
          // `select-all` so one click takes the whole value: a partial
          // selection of a credential is a credential that does not work,
          // discovered later and somewhere else.
          className={cn(
            "flex-1 min-w-0 select-all font-mono text-sm text-on-surface",
            grouped
              ? "flex flex-wrap gap-x-3 gap-y-1"
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
              : "text-on-surface-variant hover:text-primary hover:bg-primary/10",
          )}
        >
          {copied ? (
            <Check className="w-4 h-4" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
        </button>
      </div>
      {note && (
        <p className="text-xs font-bold text-warning text-pretty">{note}</p>
      )}
    </div>
  );
};
