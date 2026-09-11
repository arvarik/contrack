/**
 * InstanceView — the settings that belong to the instance, not to a person.
 *
 * Three of these moved here in 2.0 because they stopped being personal the
 * moment an instance could have more than one account. Session length used to
 * sit in Account settings and decides how long *everybody's* sign-in lasts.
 * The AI configuration is one set of provider keys paying one bill. Both are
 * an operator's decisions.
 *
 * Registration is new and is off by default, and the default is the point: a
 * self-hosted app reachable from the internet with open registration is an
 * open door, and the person who exposed it did not necessarily decide to.
 */
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { DoorOpen, Tag, Timer, TriangleAlert } from "lucide-react";
import {
  useInstanceSettings,
  useUpdateInstanceSettings,
} from "../../../api/admin";
import { AISettingsView } from "../../ai-settings";
import { SECTION_HEADING } from "../../../lib/styles";
import { cn } from "../../../lib/utils";
import { tileDelay } from "../../../lib/motion";

const GroupHeading = ({ children }: { children: React.ReactNode }) => (
  <h2 className={cn(SECTION_HEADING, "px-1 mb-2")}>{children}</h2>
);

const CARD = "bg-surface-container-lowest rounded-2xl shadow-sm p-4 sm:p-6";

/** Shown in place of a card whose value could not be read. */
const ReadFailed = ({ onRetry }: { onRetry: () => void }) => (
  <div className={cn(CARD, "space-y-3")}>
    <p className="flex items-start gap-2 text-sm text-on-surface text-pretty">
      <TriangleAlert className="w-4 h-4 text-warning shrink-0 mt-0.5" />
      This setting did not load, so its current value is unknown. Nothing has
      changed.
    </p>
    <button
      type="button"
      onClick={onRetry}
      className={cn(
        "inline-flex items-center justify-center px-4 rounded-xl",
        "min-h-[44px] sm:min-h-0 sm:py-2.5 font-bold text-sm",
        "bg-surface-container-high text-on-surface",
        "hover:bg-surface-container-highest transition-colors",
      )}
    >
      Try again
    </button>
  </div>
);

/**
 * How long a sign-in lasts.
 *
 * Presets rather than a free number: the meaningful choice is "this machine
 * is mine" against "this thing is on the internet", and asking somebody to
 * pick between 44 and 46 days is a question with no right answer. A value set
 * elsewhere that matches no preset is shown rather than silently snapped.
 */
const TTL_PRESETS = [
  { days: 1, label: "1 day", hint: "Exposed to the internet" },
  { days: 7, label: "1 week", hint: "Shared or portable machine" },
  { days: 30, label: "30 days", hint: "Default" },
  { days: 365, label: "1 year", hint: "Private machine only" },
] as const;

const SessionLengthCard = () => {
  const { data, isLoading, isError, refetch } = useInstanceSettings();
  const save = useUpdateInstanceSettings();
  const current = data?.sessionTtlDays ?? 30;
  const isCustom = !TTL_PRESETS.some((preset) => preset.days === current);

  // A failed read leaves `isLoading` false and `data` undefined, so the
  // fallback above would paint "30 days" as though it were the setting. A
  // control showing a value nobody chose is worse than no control.
  if (isError) return <ReadFailed onRetry={() => void refetch()} />;

  return (
    <div className={cn(CARD, "space-y-4")}>
      <p className="text-sm text-on-surface-variant text-pretty">
        How long a sign-in lasts on this instance before Contrack asks for a
        password again. It applies to every account.
      </p>

      {isLoading ? (
        <p className="text-sm text-on-surface-variant">Loading…</p>
      ) : (
        <div
          role="radiogroup"
          aria-label="Session length"
          className="grid grid-cols-1 sm:grid-cols-2 gap-2"
        >
          {TTL_PRESETS.map((preset) => {
            const active = preset.days === current;
            return (
              <button
                key={preset.days}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={save.isPending}
                onClick={() =>
                  !active &&
                  save.mutate(
                    { sessionTtlDays: preset.days },
                    {
                      onSuccess: ({ sessionTtlDays }) =>
                        toast.success(
                          `New sign-ins will last ${
                            sessionTtlDays === 1
                              ? "1 day"
                              : `${sessionTtlDays} days`
                          }`,
                        ),
                      onError: (error: Error) => toast.error(error.message),
                    },
                  )
                }
                className={cn(
                  "text-left px-4 py-3 rounded-xl transition-colors",
                  "disabled:cursor-not-allowed",
                  active
                    ? "bg-primary/10 ring-2 ring-inset ring-primary"
                    : "bg-surface-container-highest hover:bg-surface-container-high",
                )}
              >
                <span
                  className={cn(
                    "block text-sm font-bold",
                    active ? "text-primary" : "text-on-surface",
                  )}
                >
                  {preset.label}
                </span>
                <span className="block text-xs text-on-surface-variant mt-0.5">
                  {preset.hint}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {isCustom && !isLoading && (
        <p className="text-xs text-on-surface-variant">
          Currently set to {current} days, which isn&rsquo;t one of the presets.
          Choosing one above will replace it.
        </p>
      )}

      {/*
        Said plainly because the opposite assumption is the dangerous one:
        somebody shortening this to lock out a device they lost will otherwise
        believe they have done it.
      */}
      <p className="text-xs text-on-surface-variant text-pretty">
        This applies to sign-ins from now on. Sessions that already exist keep
        the length they were created with. To end those, disable the account or
        reset its password.
      </p>
    </div>
  );
};

const RegistrationCard = () => {
  const { data, isLoading, isError, refetch } = useInstanceSettings();
  const save = useUpdateInstanceSettings();
  const open = data?.registrationOpen === true;

  // The same rule, and it matters more here: `data?.registrationOpen === true`
  // reads a failed request as "registration is closed", which is the
  // reassuring answer and may be the wrong one.
  if (isError) return <ReadFailed onRetry={() => void refetch()} />;

  return (
    <div className={cn(CARD, "space-y-4")}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-bold text-sm text-on-surface">
            Anyone can create an account
          </h3>
          <p className="text-xs sm:text-sm text-on-surface-variant mt-0.5 text-pretty">
            Adds a &ldquo;Create one&rdquo; link to the sign-in screen. New
            accounts are always members and start empty.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={open}
          aria-label="Anyone can create an account"
          disabled={isLoading || save.isPending || !data}
          onClick={() =>
            save.mutate(
              { registrationOpen: !open },
              {
                onSuccess: (settings) =>
                  toast.success(
                    settings.registrationOpen
                      ? "Anyone who reaches the sign-in page can now create an account"
                      : "Registration is closed",
                  ),
                onError: (error: Error) => toast.error(error.message),
              },
            )
          }
          // The visible track stays 56 x 32. The hit area is the 44 px
          // square STYLE.md requires, which is what a thumb actually needs.
          className={cn(
            "shrink-0 inline-flex items-center justify-center",
            "min-w-[44px] min-h-[44px] rounded-full",
            "outline-none focus-visible:ring-2 focus-visible:ring-primary",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "relative block w-14 h-8 rounded-full transition-colors",
              open ? "bg-primary" : "bg-surface-container-high",
            )}
          >
            <span
              className={cn(
                "absolute top-1 w-6 h-6 rounded-full bg-surface-container-lowest shadow-sm",
                "transition-transform",
                open ? "translate-x-7" : "translate-x-1",
              )}
            />
          </span>
        </button>
      </div>

      {open && (
        <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-xs text-on-surface text-pretty">
          <DoorOpen className="w-4 h-4 text-warning shrink-0 mt-0.5" />
          While this is on, anybody who can reach this instance can make an
          account on it. On something exposed to the internet, invitations do
          the same job without the door being open.
        </p>
      )}
    </div>
  );
};

/**
 * What this instance calls itself.
 *
 * A single-user install never needed a name: there was one instance and it
 * was yours. An invitation link changes that, because the person clicking one
 * arrives at a sign-in screen belonging to an instance they have never seen.
 *
 * The field is uncontrolled against the server value until the server answers
 * and then seeded once. A value that reset itself while somebody was typing,
 * every time the query refetched, would be worse than no field.
 */
const InstanceNameCard = () => {
  const { data, isLoading, isError, refetch } = useInstanceSettings();
  const save = useUpdateInstanceSettings();
  const [draft, setDraft] = useState<string | null>(null);
  const stored = data?.instanceName ?? "";
  const max = data?.instanceNameMax ?? 60;
  const value = draft ?? stored;

  // Seeded once, when the value first arrives. `draft` stays null until
  // somebody types, so a refetch cannot overwrite what they are writing.
  useEffect(() => {
    if (draft === null && data) setDraft(data.instanceName);
  }, [data, draft]);

  if (isError) return <ReadFailed onRetry={() => void refetch()} />;

  const dirty = value.trim() !== stored;

  return (
    <form
      className={cn(CARD, "space-y-4")}
      onSubmit={(event) => {
        event.preventDefault();
        if (!dirty) return;
        save.mutate(
          { instanceName: value.trim() },
          {
            onSuccess: (settings) => {
              setDraft(settings.instanceName);
              toast.success(
                settings.instanceName
                  ? `This instance is now "${settings.instanceName}"`
                  : "The instance name was cleared",
              );
            },
            onError: (error: Error) => toast.error(error.message),
          },
        );
      }}
    >
      <div className="space-y-1.5">
        <label
          htmlFor="instance-name"
          className="block text-sm font-bold text-on-surface"
        >
          Instance name
        </label>
        <p className="text-sm text-on-surface-variant text-pretty">
          Shown on the sign-in and join screens, in the account menu, and in the
          browser tab. Leave it empty to show the product name.
        </p>
      </div>

      <input
        id="instance-name"
        type="text"
        value={value}
        maxLength={max}
        disabled={isLoading || save.isPending}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Contrack"
        autoComplete="off"
        className={cn(
          "w-full px-4 rounded-xl min-h-[44px]",
          "bg-surface-container-high text-on-surface text-base sm:text-sm",
          "outline-none focus-visible:ring-2 focus-visible:ring-primary",
          "disabled:opacity-50",
        )}
      />

      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-on-surface-variant">
          {value.length} of {max}
        </p>
        <button
          type="submit"
          disabled={!dirty || save.isPending}
          className={cn(
            "inline-flex items-center gap-2 px-5 rounded-full",
            "min-h-[44px] sm:min-h-0 sm:py-2.5 font-bold text-sm",
            "bg-primary text-on-primary hover:bg-primary/90 transition-colors",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          <Tag className="w-4 h-4" />
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </div>

      <p className="flex items-start gap-2 text-xs text-on-surface-variant text-pretty">
        <DoorOpen className="w-4 h-4 shrink-0 mt-0.5" />
        The sign-in screen has no credential behind it, so this name is visible
        to anybody who can reach this instance.
      </p>
    </form>
  );
};

export const InstanceView = () => (
  <div className="p-4 sm:p-6 md:p-10 max-w-4xl mx-auto space-y-8 pb-28 md:pb-10">
    <section className="tile-enter" style={{ animationDelay: tileDelay(0) }}>
      <GroupHeading>
        <span className="inline-flex items-center gap-1.5">
          <Tag className="w-3.5 h-3.5" />
          Name
        </span>
      </GroupHeading>
      <InstanceNameCard />
    </section>

    <section className="tile-enter" style={{ animationDelay: tileDelay(1) }}>
      <GroupHeading>Who can join</GroupHeading>
      <RegistrationCard />
    </section>

    <section className="tile-enter" style={{ animationDelay: tileDelay(2) }}>
      <GroupHeading>
        <span className="inline-flex items-center gap-1.5">
          <Timer className="w-3.5 h-3.5" />
          Session length
        </span>
      </GroupHeading>
      <SessionLengthCard />
    </section>

    {/*
      The AI configuration page, rendered inside this one. It is one set of
      provider keys, one budget and one bill for the whole instance, so it is
      an operator's page and not a personal one — and it was already written,
      so it is embedded rather than reimplemented. Its own route redirects
      here.
    */}
    <section className="tile-enter" style={{ animationDelay: tileDelay(3) }}>
      <GroupHeading>AI configuration</GroupHeading>
      <AISettingsView embedded />
    </section>
  </div>
);
