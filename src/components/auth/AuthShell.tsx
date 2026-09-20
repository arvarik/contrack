/**
 * AuthShell — the frame shared by the sign-in and first-run screens.
 *
 * Both are full-screen, single-purpose, and the only thing on the page, so
 * they get the same treatment: a centred card, a mark, a title, and one
 * obvious action. Keeping the frame here means the two screens differ only
 * where they should — in their fields.
 *
 * Mobile-first. On a phone the card fills the width and loses its shadow
 * (there is nothing to float above); from `sm` it becomes a contained card.
 * Inputs are 16px on small screens because anything smaller makes iOS Safari
 * zoom the viewport on focus, which is disorienting mid-password.
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
import { cn } from "../../lib/utils";
import { CorvidMark } from "../brand/CorvidMark";
import { playCorvidBeat } from "../../hooks/useCorvidIdle";
import { useCorvidLevel } from "../../hooks/useCorvidLevel";
import { useAuth } from "./AuthGate";

/**
 * What the server says when the credential is simply wrong.
 *
 * `server/routes/auth.ts` throws this sentence, and it reaches the card as
 * plain text. It is named here because it is the one form error the bird
 * answers: a shake of the head means "no, that is not it", which is true of
 * a wrong password and untrue of a network failure or a rate limit, and
 * those two arrive through the same component.
 */
export const WRONG_CREDENTIALS = "Incorrect username or password.";

/** How long the head shake lasts. */
export const SHAKE_MS = 200;
export const SHAKE_CLASS = "corvid-shake";

/**
 * A way for the form error below to reach the mark above it.
 *
 * The two are siblings in the same card, with the fields between them, and
 * neither is worth lifting into a prop on every screen that renders a shell.
 * The context is created and consumed inside this file, so the coupling
 * cannot spread.
 */
const ShakeContext = createContext<(() => void) | null>(null);

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
  const markRef = useRef<HTMLSpanElement>(null);
  const level = useCorvidLevel();
  const cancelShake = useRef<(() => void) | null>(null);

  const shake = useCallback(() => {
    if (level === "off") return;
    cancelShake.current?.();
    cancelShake.current = playCorvidBeat(
      markRef.current,
      SHAKE_CLASS,
      SHAKE_MS,
    );
  }, [level]);

  useEffect(() => () => cancelShake.current?.(), []);

  return (
    <div className="min-h-dvh bg-surface text-on-surface flex items-center justify-center p-0 sm:p-6">
      <main className="w-full sm:max-w-md">
        <form
          onSubmit={onSubmit}
          // `noValidate` hands validation to us: the browser's native bubbles
          // are unstyled, appear one at a time, and vanish on blur. The fields
          // still carry `type` and `required` so autofill and screen readers
          // read them correctly.
          noValidate
          className={cn(
            "bg-surface-container-low p-6 sm:p-8 space-y-6",
            "min-h-dvh sm:min-h-0 sm:rounded-3xl sm:shadow-xl",
            "flex flex-col justify-center sm:block",
          )}
        >
          <header className="space-y-3 text-center">
            {/*
            The mark first, then whose Contrack this is.

            Somebody arriving from an invitation link has never seen this
            instance. "Join my Contrack" and a hostname is not enough to know
            you are in the right place, and this is the one screen where the
            answer has to come before the question. The instance name is
            absent when nobody has named the instance, which is the default.
          */}
            {icon ? (
              <span className="w-14 h-14 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mx-auto">
                {icon}
              </span>
            ) : (
              // The wrapper is what shakes: the class sits on it so the whole
              // bird moves together, and the mark's own blink keeps running
              // underneath.
              <span
                ref={markRef}
                data-testid="auth-corvid"
                className="block mx-auto w-10 text-primary"
              >
                <CorvidMark size={40} idle className="block" />
              </span>
            )}
            <InstanceName />
            <h1 className="text-xl font-extrabold font-headline">{title}</h1>
            <p className="text-sm text-on-surface-variant text-pretty">
              {subtitle}
            </p>
          </header>
          <ShakeContext.Provider value={shake}>
            {children}
          </ShakeContext.Provider>
          {/*
          Inside the card rather than below it. On a phone the card fills the
          viewport, so a footer placed after it starts exactly one pixel below
          the fold — visible only to someone who scrolls a page that gives no
          indication there is anything to scroll to.
        */}
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
    <p className="text-xs font-bold uppercase tracking-widest text-primary text-balance">
      {instanceName}
    </p>
  );
};

/**
 * A labelled text input.
 *
 * The label is a real `<label>` rather than a placeholder: placeholder-only
 * fields lose their name the moment you type, which is exactly when a form
 * with four fields needs it most.
 */
export interface AuthFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
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
            // Errors are announced by pointing the field at its own message rather
            // than by a live region, so a screen reader reaching the field hears
            // what is wrong with it.
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
              "outline-none focus-visible:ring-2 focus-visible:ring-primary",
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
              className="absolute right-0 top-0 bottom-0 w-11 h-11 flex items-center justify-center text-on-surface-variant hover:text-on-surface focus:outline-none focus-visible:text-primary transition-colors cursor-pointer"
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
    className={cn(
      "w-full bg-primary text-on-primary font-bold py-3 rounded-xl",
      "flex items-center justify-center gap-2 transition-opacity hover:opacity-90",
      "disabled:bg-surface-container-high disabled:text-on-surface-variant",
      "disabled:cursor-not-allowed disabled:hover:opacity-100",
    )}
  >
    {children}
  </button>
);

/**
 * Form-level error — the one that is about the submission rather than a field.
 *
 * `role="alert"` so it is announced when it appears; a wrong password is not
 * something to discover by re-reading the page.
 */
export const AuthError = ({ children }: { children: React.ReactNode }) => {
  const shake = useContext(ShakeContext);

  // Once per message. A re-render that leaves the sentence alone must not
  // restart the shake, or a card that re-renders while the error is on
  // screen twitches for as long as the error is up.
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
