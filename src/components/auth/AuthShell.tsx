/**
 * The frame of the sign-in and first-run screens: a centered card, a mark, a
 * title and one action. On a phone the card fills the width with no shadow.
 * Inputs are 16px on small screens, or iOS Safari zooms on focus.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn, errorText } from "../../lib/utils";
import { TONE_WASH } from "../../lib/styles";
import { CorvidMark } from "../brand/CorvidMark";
import { useCorvidControls } from "../../hooks/useCorvidLife";
import { useCorvidLevel } from "../../hooks/useCorvidLevel";
import { useAuth } from "./AuthGate";
import { isNetworkError } from "../../api/client";
import { rateLimitMessage } from "../../lib/rateLimitMessage";

/**
 * The server's sentence for a wrong credential (`server/routes/auth.ts`). The
 * bird shakes its head at this error only, not at a network failure or a
 * rate limit.
 */
export const WRONG_CREDENTIALS = "Incorrect username or password.";

/** Lets the form error reach the mark above it. Used only in this file. */
const ShakeContext = createContext<(() => void) | null>(null);

/**
 * What a sign-in screen says when its request fails: the server is out of
 * reach, the wait a rate limit asks for, or the server's own words.
 *
 * @param fallback - The words for a failure with nothing to say, starting
 *   "Could not": "Could not sign in".
 */
export const authErrorText = (err: unknown, fallback: string): string =>
  isNetworkError(err)
    ? "Could not reach the server. Is it running?"
    : (rateLimitMessage(err) ?? errorText(err, fallback));

export const AuthShell = ({
  icon,
  title,
  subtitle,
  onSubmit,
  children,
  footer,
}: {
  /**
   * A shape in place of the mark, for a screen that is not a way in: a dead
   * invitation link. Every screen that leads somewhere shows the mark, and
   * its own meaning icon sits in the submit button.
   */
  icon?: React.ReactNode;
  title: string;
  subtitle: React.ReactNode;
  onSubmit: (event: React.FormEvent) => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) => {
  const level = useCorvidLevel();
  const bird = useCorvidControls();
  const titleRef = useRef<HTMLHeadingElement>(null);

  // A new screen replaces the control that had focus. When no field takes
  // it, the title does.
  useEffect(() => {
    if (document.activeElement === document.body) titleRef.current?.focus();
  }, [title]);

  // The bird turns its head away and back: no. Only the bird moves; the
  // ring it sits in stays where it is.
  const shake = useCallback(() => {
    if (level === "off") return;
    bird.react("shake");
  }, [bird, level]);

  return (
    // The status bar and the home indicator, for a screen that fills a
    // phone outside the app's shell, such as sign-in or an app's consent.
    <div className="min-h-dvh bg-surface text-on-surface flex items-center justify-center p-0 sm:p-6 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <main className="w-full sm:max-w-md">
        <form
          onSubmit={onSubmit}
          // Our validation, not the browser's bubbles. The fields keep `type`
          // and `required` for autofill and screen readers.
          noValidate
          className={cn(
            "bg-surface-container-low p-6 sm:p-8 space-y-6",
            "min-h-dvh sm:min-h-0 sm:rounded-3xl sm:shadow-xl",
            "flex flex-col justify-center sm:block",
          )}
        >
          <header className="space-y-3 text-center">
            {/*
            The mark, then whose Contrack this is, for somebody arriving from
            an invitation link. No name when nobody has named the instance.
          */}
            {icon ? (
              <span
                className={cn(
                  "w-14 h-14 rounded-2xl flex items-center justify-center mx-auto",
                  TONE_WASH.primary,
                )}
              >
                {icon}
              </span>
            ) : (
              // The card's bird blinks, looks about, and shakes its head at a
              // wrong password. Nothing bigger: it does not react to typing.
              <span
                data-testid="auth-corvid"
                className="block mx-auto w-10 text-primary"
              >
                <CorvidMark
                  size={40}
                  alive
                  temperament="calm"
                  controls={bird}
                  className="block"
                />
              </span>
            )}
            <InstanceName />
            <h1
              ref={titleRef}
              tabIndex={-1}
              // A target for focus, not a control: no ring.
              className="text-xl font-extrabold font-headline outline-none"
            >
              {title}
            </h1>
            <p className="text-sm text-on-surface-variant text-pretty">
              {subtitle}
            </p>
          </header>
          <ShakeContext.Provider value={shake}>
            {children}
          </ShakeContext.Provider>
          {/* Inside the card: on a phone a footer below it is below the fold. */}
          {footer && (
            <p className="text-xs text-on-surface-variant text-center text-pretty">
              {footer}
            </p>
          )}
        </form>
      </main>
    </div>
  );
};

/** The instance's own name, or nothing at all. */
const InstanceName = () => {
  const { instanceName } = useAuth();
  if (!instanceName) return null;
  return (
    <p className="text-xs font-bold uppercase tracking-[0.08em] text-primary text-balance">
      {instanceName}
    </p>
  );
};

/** A labeled text input. A real `<label>`: a placeholder vanishes on typing. */
interface AuthFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  revealable?: boolean;
  capsLockHint?: boolean;
  action?: React.ReactNode;
}

export const AuthField = React.forwardRef<HTMLInputElement, AuthFieldProps>(
  (
    {
      id,
      label,
      action,
      hint,
      error,
      revealable = false,
      capsLockHint = false,
      type = "text",
      onKeyDown,
      onKeyUp,
      onBlur,
      ...props
    },
    ref,
  ) => {
    const [revealed, setRevealed] = useState(false);
    const [capsLock, setCapsLock] = useState(false);

    const inputType =
      revealable && type === "password"
        ? revealed
          ? "text"
          : "password"
        : type;

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (capsLockHint && typeof e.getModifierState === "function") {
        setCapsLock(e.getModifierState("CapsLock"));
      }
      onKeyDown?.(e);
    };

    const handleKeyUp = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (capsLockHint && typeof e.getModifierState === "function") {
        setCapsLock(e.getModifierState("CapsLock"));
      }
      onKeyUp?.(e);
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      if (capsLockHint) {
        setCapsLock(false);
      }
      onBlur?.(e);
    };

    const describedBy =
      [
        error ? `${id}-error` : hint ? `${id}-hint` : null,
        capsLockHint && capsLock ? `${id}-caps` : null,
      ]
        .filter(Boolean)
        .join(" ") || undefined;

    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label
            htmlFor={id}
            className="block text-xs font-bold text-on-surface"
          >
            {label}
          </label>
          {action}
        </div>
        <div className="relative">
          <input
            ref={ref}
            id={id}
            type={inputType}
            // The field points at its message, so a screen reader reaching it
            // hears what is wrong.
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            onKeyDown={handleKeyDown}
            onKeyUp={handleKeyUp}
            onBlur={handleBlur}
            className={cn(
              "w-full px-4 py-3 rounded-xl bg-surface-container-highest",
              revealable && "pr-12",
              // 16px on mobile: anything less and iOS Safari zooms on focus.
              "text-base sm:text-sm",
              error && "ring-2 ring-error",
            )}
            {...props}
          />
          {revealable && (
            <button
              type="button"
              onClick={() => setRevealed((prev) => !prev)}
              aria-label={revealed ? "Hide password" : "Show password"}
              aria-pressed={revealed}
              className="state-layer absolute right-0 top-0 bottom-0 w-11 h-11 rounded-xl flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
            >
              {revealed ? (
                <EyeOff className="w-4 h-4" aria-hidden="true" />
              ) : (
                <Eye className="w-4 h-4" aria-hidden="true" />
              )}
            </button>
          )}
        </div>
        {capsLockHint && capsLock && (
          <p
            id={`${id}-caps`}
            aria-live="polite"
            className="text-xs text-warning font-medium flex items-center gap-1"
          >
            Caps Lock is on
          </p>
        )}
        {error ? (
          <p id={`${id}-error`} className="text-xs text-error">
            {error}
          </p>
        ) : hint ? (
          <p id={`${id}-hint`} className="text-xs text-on-surface-variant">
            {hint}
          </p>
        ) : null}
      </div>
    );
  },
);
AuthField.displayName = "AuthField";

/** The single primary action at the bottom of an auth form. */
export const AuthSubmit = ({
  children,
  busy,
  disabled,
}: {
  children: React.ReactNode;
  busy?: boolean;
  disabled?: boolean;
}) => (
  <button
    type="submit"
    disabled={disabled || busy}
    className="btn-primary w-full"
  >
    {children}
  </button>
);

/** An error about the submission, not a field. `role="alert"` announces it. */
export const AuthError = ({ children }: { children: React.ReactNode }) => {
  const shake = useContext(ShakeContext);

  // Once per message, so a re-render does not restart the shake.
  useEffect(() => {
    if (children === WRONG_CREDENTIALS) shake?.();
  }, [children, shake]);

  return (
    <p
      role="alert"
      className="text-xs text-error bg-error/10 rounded-lg px-3 py-2 text-center text-pretty"
    >
      {children}
    </p>
  );
};
