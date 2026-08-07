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
import React from "react";
import { cn } from "../../lib/utils";

export const AuthShell = ({
  icon,
  title,
  subtitle,
  onSubmit,
  children,
  footer,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: React.ReactNode;
  onSubmit: (event: React.FormEvent) => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) => (
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
          <span className="w-14 h-14 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mx-auto">
            {icon}
          </span>
          <h1 className="text-xl font-extrabold font-headline">{title}</h1>
          <p className="text-sm text-on-surface-variant text-pretty">
            {subtitle}
          </p>
        </header>
        {children}
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

/**
 * A labelled text input.
 *
 * The label is a real `<label>` rather than a placeholder: placeholder-only
 * fields lose their name the moment you type, which is exactly when a form
 * with four fields needs it most.
 */
export const AuthField = ({
  id,
  label,
  hint,
  error,
  ...props
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
} & React.InputHTMLAttributes<HTMLInputElement>) => (
  <div className="space-y-1.5">
    <label htmlFor={id} className="block text-xs font-bold text-on-surface">
      {label}
    </label>
    <input
      id={id}
      // Errors are announced by pointing the field at its own message rather
      // than by a live region, so a screen reader reaching the field hears
      // what is wrong with it.
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
      className={cn(
        "w-full px-4 py-3 rounded-xl bg-surface-container-highest",
        // 16px on mobile: anything less and iOS Safari zooms on focus.
        "text-base sm:text-sm",
        "outline-none focus-visible:ring-2 focus-visible:ring-primary",
        error && "ring-2 ring-error",
      )}
      {...props}
    />
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
export const AuthError = ({ children }: { children: React.ReactNode }) => (
  <p
    role="alert"
    className="text-xs text-error bg-error/10 rounded-lg px-3 py-2 text-center text-pretty"
  >
    {children}
  </p>
);
