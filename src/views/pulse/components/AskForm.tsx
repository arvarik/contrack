/**
 * AskForm: one field under the masthead, "Ask about your network".
 *
 * The morning page is where a question about the network occurs to a
 * person, and the Ask page is one navigation away. The form sends its text
 * to `/search?q=`, where the People search runs it. It renders only when AI
 * is allowed for the account, and only from `sm` up: on a phone the tab bar
 * has Ask Contrack one tap away, and the masthead must not push the queue
 * off the first screen. No new key: the palette's `⌘K` is unchanged.
 *
 * The Ask button waits for three characters, which is the shortest question
 * the search accepts.
 */
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { SEARCH_INPUT } from "../../../lib/styles";
import { cn } from "../../../lib/utils";

/** The shortest question the People search runs. `SearchView` ignores less. */
export const ASK_MIN_LENGTH = 3;

export const AskForm = ({ className }: { className?: string }) => {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const question = value.trim();
  const ready = question.length >= ASK_MIN_LENGTH;

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready) return;
    navigate(`/search?q=${encodeURIComponent(question)}`);
  };

  return (
    <form
      role="search"
      aria-label="Ask about your network"
      onSubmit={submit}
      className={cn(
        "hidden sm:flex items-center gap-2 w-full max-w-xl",
        className,
      )}
    >
      <div className="relative flex-1 min-w-0">
        <Sparkles
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant pointer-events-none"
          aria-hidden="true"
        />
        <input
          type="search"
          name="q"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-label="Ask about your network"
          placeholder="Ask about your network"
          autoComplete="off"
          enterKeyHint="search"
          className={cn(SEARCH_INPUT, "text-on-surface")}
        />
      </div>
      <button type="submit" disabled={!ready} className="btn-primary">
        Ask
      </button>
    </form>
  );
};
