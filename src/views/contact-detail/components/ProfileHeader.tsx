/**
 * ProfileHeader: who this contact is.
 *
 * ```
 * (avatar 96) Thomas Walker (they/them)                  ◎ Quarterly ▾  ⋮
 *          ✎  UX Researcher at Umbrella Corp
 *             Sydney · 2:45 AM AEST · 13°C · in ThomasWalker ↗ · @Thomas_Walker ↗  + link
 *             [tech-lead ×] [advisor ×] [+ tag]
 * ```
 *
 * 1. The name is the page's h1 and takes focus when a contact opens.
 * 2. The avatar ring is the relationship score. The contact's own color is
 *    the page accent.
 * 3. The meta line is text: facts are plain, links show ↗ (new tab), and
 *    "+ link" has no dot before it, because it is an action.
 * 4. No primary button. Wide, a note starts in the Timeline composer under
 *    the tabs. Track is the one control beside the kebab.
 * 5. Narrow (a phone or a slim pane) keeps to about 200 px: the headline,
 *    the summary and the tags move to the Details tab, the weather stays
 *    off, and a row of quick actions ends the header.
 */
import React, { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Sparkles,
  Archive,
  ArrowUpRight,
  CalendarClock,
  Copy,
  Mail,
  MessageCircle,
  Pencil,
  PenLine,
  Phone,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";

import type {
  Contact,
  ContactSocialLink,
  ContactUpdateData,
} from "../../../types";
import { cleanLinkedInSlug, cn, safeHref } from "../../../lib/utils";
import { PaletteButton } from "../../../components/command-palette/PaletteButton";
import { TONE_WASH } from "../../../lib/styles";
import { copyToClipboard, CLIPBOARD_DENIED } from "../../../lib/clipboard";
import { mailtoHref, smsHref, telHref } from "../../../lib/contactLinks";
import { openQuickNote } from "../../../lib/appEvents";

import {
  LocalTimeWeather,
  timeZoneAt,
} from "../../../components/LocalTimeWeather";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { ActionMenu } from "../../../components/ui/ActionMenu";
import { DotLine } from "../../../components/ui/MetaDot";
import { ScoreRingAvatar } from "../../../components/ScoreRingAvatar";
import { AnimatedSkeleton } from "../../../components/ui/AnimatedSkeleton";
import { ScoreBreakdown } from "../../../components/ScoreBreakdown";
import { scoreView } from "../../../../shared/scoreBand";

import { EditableField } from "./EditableField";
import { showUndoToast } from "./Field";
import { PlatformIcon, PLATFORM_COLORS, hasKnownIcon } from "./PlatformIcon";
import { AddLink } from "./AddLink";
import { ContactActionsMenu } from "./ContactActionsMenu";
import { ContactTags } from "./ContactTags";
import { TrackButton } from "./TrackButton";
import { BANNER_DAYS, describeFollowUp } from "../../../lib/followUp";
import { CONTACT_HEADING_ID } from "../../../components/layout/SkipLink";
import { hasUserInteracted } from "../../../lib/userInteraction";

/** The two forms of the contact page. See ContactProfile. */
type ContactLayout = "wide" | "narrow";

/** A mutation's `mutate` that takes the contact's id. */
type ContactMutate = (
  id: string,
  opts?: { onSuccess?: () => void; onError?: (err: Error) => void },
) => void;

export interface ProfileHeaderProps {
  contact: Contact;
  onUpdate: (field: string, val: string) => void;
  onDelete: () => void;
  onClose?: () => void;
  /** Opens the avatar picker. The pencil on the avatar calls it. */
  onOpenAvatarPicker: () => void;
  /**
   * The pencil, so the avatar picker can return focus to it on close. Safari
   * does not focus a button it clicks.
   */
  avatarEditRef?: React.Ref<HTMLButtonElement>;
  showNetworkButton?: boolean;
  /** Defaults to wide. */
  layout?: ContactLayout;
  /** The page Back returns to ("Network", "Map"). Without one: "Back". */
  backLabel?: string;

  // The parent's `mutate` functions, not the result objects: those are new
  // on each render and would re-render this memoized header.
  archiveContact: ContactMutate;
  unarchiveContact: ContactMutate;
  /** True while an archive or a restore is out. */
  archivePending: boolean;
  updateContact: (args: { id: string; data: ContactUpdateData }) => void;
  promoteGhost: ContactMutate;
  promotePending: boolean;
  /** A new number (from the Research card) opens "+ link". */
  linkRequest?: number;
  onLinkRequestDone?: () => void;
}

/** The first comma part of a place: "Sydney" from "Sydney, NSW, Australia". */
const shortPlace = (text: string | null | undefined): string | null =>
  text?.split(",")[0]?.trim() || null;

/** "Linkedin" from "linkedin": the label used when a link has no handle. */
const capitalize = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);

/** The text a social link shows: its handle, else its platform, else its host. */
function socialLinkName(sl: ContactSocialLink): string {
  const platformKey = sl.platform?.toLowerCase() || "other";
  const isKnown = hasKnownIcon(platformKey);

  let displayName = sl.handle || sl.platform;
  if (!sl.handle && sl.url) {
    try {
      displayName = new URL(sl.url).hostname.replace("www.", "");
    } catch {}
  }
  if (!sl.handle && isKnown) {
    displayName = capitalize(sl.platform);
  }

  if (platformKey === "linkedin" && sl.handle) {
    displayName = cleanLinkedInSlug(sl.handle);
  } else if (platformKey === "linkedin" && sl.url) {
    try {
      const url = new URL(sl.url);
      const pathParts = url.pathname.replace(/\/+$/, "").split("/");
      const slug = pathParts[pathParts.length - 1];
      if (slug && slug !== "in") {
        displayName = cleanLinkedInSlug(slug);
      }
    } catch {}
  }
  return displayName;
}

/** The meta line's last item and "+ link" after it, as one item. */
const META_ITEM = "inline-flex items-center gap-x-2 min-w-0 max-w-full";

/** The host of a website, without "www.". */
function websiteName(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return "Website";
  }
}

/**
 * "Change avatar": a pencil badge on the ring's lower right. It is a sibling
 * of the score button, never inside it, because a scored ring is already the
 * button that explains the score. It shows at rest, since a phone has no
 * hover.
 *
 * 1. The 44 px `hit-area` box sits 10 px out toward the empty corner.
 *    Centered, it reaches past the middle of the 56 px avatar and takes taps
 *    meant for the score.
 * 2. Hover and focus make the face solid instead of a state layer: 6 percent
 *    ink on a clear face over a photo reads as a smudge.
 * 3. Focus returns here when the picker closes (`avatarEditRef`).
 */
const AvatarEditButton = ({
  narrow,
  onClick,
  buttonRef,
}: {
  narrow: boolean;
  onClick: () => void;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) => (
  <button
    ref={buttonRef}
    type="button"
    onClick={onClick}
    aria-label="Change avatar"
    title="Change avatar"
    className={cn(
      "hit-area absolute right-0 bottom-0 z-10 flex items-center justify-center rounded-full",
      // The tap box, moved out toward the corner (see 1 above).
      "after:translate-x-2.5 after:translate-y-2.5",
      narrow ? "size-6" : "size-7",
      "bg-surface-container-lowest/85 backdrop-blur-sm border border-outline-variant/70 ring-2 ring-surface shadow-sm",
      "text-on-surface-variant transition duration-(--dur-fast)",
      "hover:bg-surface-container-lowest hover:text-on-surface",
      "focus-visible:bg-surface-container-lowest focus-visible:text-on-surface",
      "active:scale-95",
    )}
  >
    <Pencil aria-hidden="true" className={narrow ? "w-3 h-3" : "w-3.5 h-3.5"} />
  </button>
);

/** A text link on the meta line, with its own small actions menu. */
const SocialLink = ({
  url,
  platform,
  displayName,
  platformName,
  iconClassName,
  useFavicon,
  onRemove,
  iconOnly = false,
}: {
  url: string;
  platform: string;
  displayName: string;
  /** Said to a screen reader when the icon is the only sign of the platform. */
  platformName?: string;
  iconClassName: string;
  useFavicon: boolean;
  /** When set, the link gets a menu with Copy link and Remove link. */
  onRemove?: () => void;
  /**
   * Narrow: the icon only, with the handle as name and tooltip. Two
   * handles in words wrap a phone's meta line to three lines.
   */
  iconOnly?: boolean;
}) => (
  <span className="group/link inline-flex items-center gap-1 max-w-full">
    <a
      href={safeHref(url)}
      target="_blank"
      rel="noopener noreferrer"
      title={iconOnly ? displayName : undefined}
      className="hit-area inline-flex items-center gap-1.5 min-w-0 rounded font-medium text-on-surface underline-offset-2 hover:underline"
    >
      {/* Hidden: a favicon's alt text would add a host to the link's name. */}
      <span aria-hidden="true" className="inline-flex shrink-0">
        <PlatformIcon
          platform={platform}
          url={url}
          className={cn("w-4 h-4", iconClassName)}
          useFavicon={useFavicon}
        />
      </span>
      <span className={iconOnly ? "sr-only" : "min-w-0 break-words"}>
        {displayName}
      </span>
      {platformName && <span className="sr-only">, {platformName}</span>}
      {/* A lone brand icon reads as a link already: the arrow beside it was
          one more glyph in a crowded phone row. */}
      {!iconOnly && (
        <span aria-hidden="true" className="text-on-surface-variant">
          ↗
        </span>
      )}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
    {onRemove && (
      <ActionMenu
        label={`Actions for ${displayName}`}
        iconClassName="w-3.5 h-3.5"
        // Always shown: hidden until hover, it still takes its width, and the
        // gap after a link looks wider than the gap after a fact.
        triggerClassName="p-1 rounded-lg"
        items={[
          {
            id: "copy",
            label: "Copy link",
            icon: Copy,
            onSelect: () => {
              copyToClipboard(url).then(
                () => toast.success("Link copied"),
                () => toast.error(CLIPBOARD_DENIED),
              );
            },
          },
          {
            id: "remove",
            label: "Remove link",
            icon: Trash2,
            danger: true,
            onSelect: onRemove,
          },
        ]}
      />
    )}
  </span>
);

/**
 * At most 144 px wide from `sm`, so a lone Log note on a tablet is a tile, not
 * a bar. On a phone the tiles share the whole row.
 */
const QUICK_ACTION =
  "state-layer flex-1 basis-0 min-w-0 sm:max-w-36 flex flex-col items-center justify-center gap-1 min-h-[52px] px-1 py-2 rounded-xl text-xs font-semibold";

/**
 * The narrow header's last row, only on a touch screen: a narrow desktop
 * window has no use for tel: and sms:. A tile shows only when the contact has
 * its value. Call and Message ask which number when there are two or more.
 * Log note opens the quick note sheet from any tab.
 */
const QuickActions = ({ contact }: { contact: Contact }) => {
  const phones = (contact.phones ?? []).filter((p) => p.phone);
  const email = contact.emails?.[0]?.email;
  const tile = cn(QUICK_ACTION, TONE_WASH.primary);
  /** A tile that dials or texts: a link for one number, a chooser for more. */
  const phoneTile = (label: string, Icon: LucideIcon, href: typeof telHref) => {
    const numbers = phones.flatMap((p) => {
      const to = href(p.phone);
      return to ? [{ ...p, to }] : [];
    });
    const face = (
      <>
        <Icon aria-hidden="true" className="w-5 h-5" />
        {label}
      </>
    );
    if (numbers.length > 1)
      return (
        <ActionMenu
          label={`${label}, choose a number`}
          className="flex-1 basis-0 min-w-0 sm:max-w-36"
          triggerClassName={cn(tile, "w-full max-w-none")}
          triggerContent={face}
          items={numbers.map((p, i) => ({
            id: `${i}`,
            label: p.label ? `${p.phone}, ${p.label}` : p.phone,
            onSelect: () => window.location.assign(p.to),
          }))}
        />
      );
    return numbers[0] ? (
      <a href={numbers[0].to} className={tile}>
        {face}
      </a>
    ) : null;
  };
  return (
    <div
      role="group"
      aria-label="Quick actions"
      className="mt-3 hidden pointer-coarse:flex items-stretch gap-2"
    >
      {phoneTile("Call", Phone, telHref)}
      {phoneTile("Message", MessageCircle, smsHref)}
      {email && (
        <a href={mailtoHref(email)} className={tile}>
          <Mail aria-hidden="true" className="w-5 h-5" />
          Email
        </a>
      )}
      <button
        type="button"
        onClick={() => openQuickNote(contact.id)}
        className={tile}
      >
        <PenLine aria-hidden="true" className="w-5 h-5" />
        Log note
      </button>
    </div>
  );
};

/**
 * What a headline says that the role and company line above it does not.
 * "Partner at Northwind | Investor" under "Partner at Northwind" is
 * "Investor". Each part between | · • is dropped when it is only the role,
 * the company and small words. Null when nothing is left.
 */
export function newInHeadline({
  headline,
  role,
  company,
}: Pick<Contact, "headline" | "role" | "company">): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const known = [role, company].filter(Boolean).map((s) => norm(s!));
  const parts = (headline ?? "").split(/\s*[|·•]\s*/).filter((part) => {
    let rest = norm(part);
    for (const k of known) rest = rest.replace(k, "");
    return !/^(at|of|and|for)?$/.test(rest);
  });
  return parts.length ? parts.join(" · ") : null;
}

/**
 * The headline and the summary, when they add something: under the role when
 * wide, at the top of the Details tab when narrow.
 */
export const ContactIntro = ({
  contact,
  onUpdate,
  className,
}: {
  contact: Contact;
  onUpdate: (field: string, val: string) => void;
  className?: string;
}) => {
  const fresh = newInHeadline(contact);
  const headline = fresh && (
    <div className="text-base text-on-surface-variant font-medium italic">
      <EditableField
        value={contact.headline}
        display={fresh}
        onSave={(val) => onUpdate("headline", val)}
        placeholder="Add headline"
      />
    </div>
  );

  if (!headline && !contact.aiSummary) return null;
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {headline}
      {/* A model wrote the summary, so it wears the AI color. */}
      {contact.aiSummary && (
        <div className="flex items-start gap-2 bg-ai/10 text-on-ai-wash rounded-xl p-3 max-w-fit">
          <Sparkles aria-hidden="true" className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="text-sm font-medium leading-relaxed italic">
            {contact.aiSummary}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Back, below `lg`, where the list does not show. The bar is 56 px tall, and
 * the narrow tabs stick right under it (ContactProfile). With a `name`, the
 * name fades into the bar as the header's name scrolls under it
 * (`.contact-bar-name` in index.css), as an iOS large title does.
 */
export const BackBar = ({
  onClose,
  backLabel,
  name,
}: Pick<ProfileHeaderProps, "backLabel"> & {
  onClose: () => void;
  name?: string;
}) => (
  // Solid, like the sticky tab row under it: the header's text scrolls
  // under both.
  <div className="sticky top-0 z-30 bg-surface h-14 px-4 lg:hidden flex items-center justify-between shrink-0">
    <button
      type="button"
      onClick={onClose}
      aria-label={backLabel ? `Back to ${backLabel}` : undefined}
      className="hit-area state-layer flex items-center gap-2 text-on-primary-wash font-bold px-3 py-1.5 -ml-3 rounded-xl transition-colors"
    >
      <ArrowLeft aria-hidden="true" className="w-5 h-5" />
      {backLabel ?? "Back"}
    </button>
    {/* The page's `h1` names the person, so a screen reader skips this. */}
    {name && (
      <span
        aria-hidden="true"
        className="contact-bar-name flex-1 min-w-0 px-2 truncate text-center text-sm font-bold text-on-surface pointer-events-none"
      >
        {name}
      </span>
    )}
    {/* A phone has no ⌘K: the way to the next person from this one. */}
    <PaletteButton className="-mr-2" />
  </div>
);

/** The box around the avatar and the name, in both forms. */
const headerBox = (narrow: boolean) =>
  cn(
    "max-w-6xl mx-auto w-full relative shrink-0",
    narrow ? "px-4 pt-4 pb-3" : "p-8 lg:px-10 lg:pt-8 lg:pb-6",
  );

/**
 * The header while the full contact loads, filled from the list row when there
 * is one. Nothing edits: the row has empty links and addresses, and an edit
 * writes a list back whole, so it would wipe the contact's own.
 */
export const ProfileHeaderSkeleton = ({
  contact,
  layout = "wide",
  onClose,
  backLabel,
}: Pick<ProfileHeaderProps, "layout" | "onClose" | "backLabel"> & {
  contact?: Contact;
}) => {
  const narrow = layout === "narrow";
  return (
    <>
      {onClose && <BackBar onClose={onClose} backLabel={backLabel} />}
      <div className={headerBox(narrow)} aria-busy="true">
        <div className={cn("flex items-start", narrow ? "gap-4" : "gap-6")}>
          {contact ? (
            <ScoreRingAvatar
              contact={contact}
              size={narrow ? 56 : 96}
              ring="header"
            />
          ) : (
            <AnimatedSkeleton
              className={cn("rounded-full", narrow ? "size-14" : "size-24")}
            />
          )}
          <div className="flex-1 min-w-0 flex flex-col gap-2">
            {contact ? (
              <h1
                className={cn(
                  "font-extrabold font-headline tracking-tight text-on-surface py-0.5",
                  narrow ? "text-2xl" : "text-4xl",
                )}
              >
                {contact.name}
              </h1>
            ) : (
              <>
                <span className="sr-only">Loading contact</span>
                <AnimatedSkeleton className="h-9 w-48 rounded-full" />
              </>
            )}
            <p
              className={cn(
                "font-medium text-on-surface-variant",
                narrow ? "text-sm" : "text-lg",
              )}
            >
              {[contact?.role, contact?.company]
                .filter(Boolean)
                .join(narrow ? " · " : " at ")}
            </p>
            <AnimatedSkeleton className="h-4 w-2/3 max-w-sm rounded-full" />
          </div>
        </div>
      </div>
    </>
  );
};

const ProfileHeaderInner: React.FC<ProfileHeaderProps> = ({
  contact,
  onUpdate,
  onDelete,
  onClose,
  onOpenAvatarPicker,
  avatarEditRef,
  showNetworkButton = false,
  layout = "wide",
  backLabel,
  archiveContact,
  unarchiveContact,
  archivePending,
  updateContact,
  promoteGhost,
  promotePending,
  linkRequest,
  onLinkRequestDone,
}) => {
  const navigate = useNavigate();
  const narrow = layout === "narrow";
  const { preferences } = usePreferences();

  /**
   * Opening a contact moves focus to its name, the h1, so the next Tab starts
   * here and a screen reader says who this is. Focus stays put on a fresh page
   * load (the skip link owns the first Tab), while someone types, and inside a
   * dialog. The profile is keyed by id, so this runs once per contact.
   */
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const heading = headingRef.current;
    if (!heading || !hasUserInteracted()) return;
    if (heading.closest('[role="dialog"]')) return;
    const active = document.activeElement as HTMLElement | null;
    if (
      active?.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(active?.tagName ?? "") ||
      active?.closest('[role="dialog"]')
    ) {
      return;
    }
    heading.focus({ preventScroll: true });
  }, []);

  const timezone = useMemo(
    () => timeZoneAt(contact.lat, contact.lng),
    [contact.lat, contact.lng],
  );

  /** The links as the update takes them: what each is, not its row id. */
  const linkPayload = (links: ContactSocialLink[]) =>
    links.map((s) => ({
      platform: s.platform,
      url: s.url,
      handle: s.handle,
    }));

  /** The server derives the new link's platform and handle from its URL. */
  const addSocialLink = (url: string) => {
    updateContact({
      id: contact.id,
      data: {
        socialLinks: [...linkPayload(contact.socialLinks || []), { url }],
      },
    });
  };

  const removeSocialLink = (id: string) => {
    const before = contact.socialLinks || [];
    const after = before.filter((s) => s.id !== id);
    updateContact({
      id: contact.id,
      data: { socialLinks: linkPayload(after) },
    });
    showUndoToast("Link removed", () =>
      updateContact({
        id: contact.id,
        data: { socialLinks: linkPayload(before) },
      }),
    );
  };

  // Meta line: one fact or one link per item, with dots between items.
  // Narrow, a link is an icon, and two icons in a row need no dot.
  const metaItems: { key: string; node: React.ReactNode; dot?: boolean }[] = [];
  const dotBeforeLink = () =>
    !narrow || !/^(link-|website$)/.test(metaItems.at(-1)?.key ?? "");
  const place =
    shortPlace(contact.addresses?.[0]?.address) ?? shortPlace(contact.location);
  if (place) {
    metaItems.push({ key: "place", node: <span>{place}</span> });
  }
  if (timezone) {
    metaItems.push({
      key: "time",
      node: (
        <LocalTimeWeather
          lat={contact.lat}
          lng={contact.lng}
          // The narrow header has room for one line, and no weather.
          showWeather={!narrow && preferences.showWeather}
        />
      ),
    });
  }
  for (const sl of contact.socialLinks || []) {
    const platformKey = sl.platform?.toLowerCase() || "other";
    const isKnown = hasKnownIcon(platformKey);
    const displayName = socialLinkName(sl);
    const platformName = isKnown ? capitalize(platformKey) : undefined;
    metaItems.push({
      key: `link-${sl.id}`,
      dot: dotBeforeLink(),
      node: (
        <SocialLink
          iconOnly={narrow}
          url={sl.url}
          platform={sl.platform}
          displayName={displayName}
          platformName={
            platformName && platformName !== displayName
              ? platformName
              : undefined
          }
          iconClassName={
            PLATFORM_COLORS[platformKey] || "text-on-surface-variant"
          }
          useFavicon={!isKnown}
          onRemove={() => removeSocialLink(sl.id)}
        />
      ),
    });
  }
  // The website, when it is not already one of the social links.
  if (
    contact.website &&
    !contact.socialLinks?.some((sl) => sl.url === contact.website)
  ) {
    metaItems.push({
      key: "website",
      dot: dotBeforeLink(),
      node: (
        <SocialLink
          iconOnly={narrow}
          url={contact.website}
          platform="website"
          displayName={websiteName(contact.website)}
          iconClassName="text-on-surface-variant"
          useFavicon
        />
      ),
    });
  }
  const roleField = (
    <EditableField
      value={contact.role}
      onSave={(val) => onUpdate("role", val)}
      placeholder="Role / title"
    />
  );
  const companyField = (
    <EditableField
      value={contact.company}
      onSave={(val) => onUpdate("company", val)}
      placeholder="Company"
    />
  );
  // What a new link must not repeat: the links, and the website beside them.
  const knownLinks = [
    ...(contact.socialLinks || []).map((sl) => sl.url),
    ...(contact.website ? [contact.website] : []),
  ];

  const avatarSize = narrow ? 56 : 96;
  const followUp = describeFollowUp(contact.nextFollowUpAt);

  // The score the ring draws, or null when there is none: nobody tracks this
  // contact, or nothing is logged yet. Only a scored ring explains itself.
  const view = scoreView(contact);
  const headerScore = view.kind === "scored" ? view.score : null;

  // A ghost's one step: beside the menus on a wide header, under the name on
  // a phone.
  const addToNetwork = (className: string) => (
    <button
      type="button"
      onClick={() => {
        promoteGhost(contact.id, {
          onSuccess: () => toast.success(`${contact.name} added to Network`),
        });
      }}
      disabled={promotePending}
      className={className}
    >
      <Sparkles aria-hidden="true" className="w-4 h-4" />
      {promotePending ? "Adding…" : "Add to Network"}
    </button>
  );

  return (
    <>
      {onClose && (
        <BackBar onClose={onClose} backLabel={backLabel} name={contact.name} />
      )}

      {/* A follow-up that is late, today or within the week, the same window
          as Pulse's "This week". A later one shows only in Details. */}
      {followUp && followUp.days <= BANNER_DAYS && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            "w-full px-6 py-3 flex items-center justify-center gap-2",
            TONE_WASH[followUp.tone],
          )}
        >
          <CalendarClock aria-hidden="true" className="w-4 h-4 shrink-0" />
          <span className="text-sm font-bold truncate">{followUp.text}</span>
        </motion.div>
      )}

      <div className={headerBox(narrow)}>
        <section
          className={cn(
            "flex flex-row items-start",
            narrow ? "gap-4" : "gap-6",
          )}
        >
          {/* A scored ring is the button that explains the score, so the
              ring inside is decorative. `flex` sizes the box to the avatar:
              a block box runs 6 px under the ring, and badges sit low. */}
          <div className="relative shrink-0 flex">
            {headerScore === null ? (
              <ScoreRingAvatar
                contact={contact}
                size={avatarSize}
                ring="header"
              />
            ) : (
              <ScoreBreakdown contactId={contact.id} score={headerScore}>
                <ScoreRingAvatar
                  contact={contact}
                  size={avatarSize}
                  ring="header"
                  decorative
                />
              </ScoreBreakdown>
            )}
            <AvatarEditButton
              narrow={narrow}
              onClick={onOpenAvatarPicker}
              buttonRef={avatarEditRef}
            />
            {/* Warning ink on the card face: white on amber is about 2 to 1.
                Centered under the avatar, clear of the pencil. Narrow drops
                the glyph, or the chip runs off a phone's edge. */}
            {!!contact.isArchived && (
              <div
                className={cn(
                  "absolute top-full mt-1.5 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-surface-container-lowest text-warning text-[11px] font-bold uppercase tracking-[0.08em] py-0.5 rounded-md shadow-sm whitespace-nowrap z-20",
                  narrow ? "px-1.5" : "px-2",
                )}
              >
                {!narrow && (
                  <Archive aria-hidden="true" className="w-2.5 h-2.5" />
                )}
                Archived
              </div>
            )}
            {contact.isGhost
              ? (() => {
                  const connectorSource = contact.sources?.find((s) =>
                    ["calendar", "email", "google"].includes(s.platform),
                  );
                  const count = contact.interactionCount ?? 1;
                  const sourceName = connectorSource
                    ? connectorSource.platform === "calendar"
                      ? "calendar"
                      : connectorSource.platform === "email"
                        ? "mail"
                        : connectorSource.platform
                    : null;
                  const ghostText = sourceName
                    ? `Seen ${count} time${count === 1 ? "" : "s"} in your ${sourceName}, and not added yet`
                    : "Named in a note, and not added yet";

                  return (
                    <div className="absolute -top-3 -right-3 flex items-center justify-center w-8 h-8 rounded-full bg-surface-container-highest border-2 border-surface-container-lowest shadow-sm z-20 group/ghosticon cursor-help">
                      <Sparkles className="w-4 h-4 text-primary opacity-80 group-hover/ghosticon:opacity-100 transition-opacity" />
                      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-48 bg-surface text-on-surface text-xs font-medium p-2.5 rounded-xl shadow-lg border border-surface-container opacity-0 pointer-events-none group-hover/ghosticon:opacity-100 transition-all z-50 text-center leading-relaxed">
                        <strong className="block text-primary mb-0.5">
                          Not in your network
                        </strong>
                        {ghostText}
                      </div>
                    </div>
                  );
                })()
              : null}
          </div>

          <div className="flex-1 min-w-0 w-full">
            {/* Wide, the actions keep the top right corner. Narrow, they wrap
                under a long name, so the name breaks between words, not
                inside one. */}
            <div
              className={cn(
                "flex justify-between",
                narrow
                  ? "flex-wrap items-center gap-x-2 gap-y-1"
                  : "items-start gap-4",
              )}
            >
              {/* `tabIndex={-1}` takes focus on navigation and from the skip
                  link without a Tab stop. No ring: the name inside is the
                  control and shows its own. */}
              <h1
                id={CONTACT_HEADING_ID}
                ref={headingRef}
                tabIndex={-1}
                className={cn(
                  "min-w-0 font-extrabold font-headline tracking-tight text-on-surface flex flex-wrap items-center gap-x-2 gap-y-1 py-0.5 outline-none",
                  narrow ? "text-2xl" : "text-4xl flex-1",
                )}
              >
                {/* A long name wraps between its words, and inside a word
                    only when one word is wider than the whole line. */}
                <EditableField
                  value={contact.name}
                  onSave={(val) => onUpdate("name", val)}
                  placeholder="Contact name"
                  className="min-w-0 max-w-full"
                />
                {contact.pronouns && (
                  <span
                    className={cn(
                      "text-on-surface-variant font-medium tracking-normal inline-block align-middle",
                      narrow ? "text-base" : "text-xl",
                    )}
                  >
                    ({contact.pronouns})
                  </span>
                )}
              </h1>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {!!contact.isGhost && !narrow && addToNetwork("btn-secondary")}

                {/* A ghost cannot be tracked: it shows Add to Network. */}
                {!contact.isGhost && (
                  <TrackButton contact={contact} compact={narrow} />
                )}

                <ContactActionsMenu
                  contact={contact}
                  onDelete={onDelete}
                  archiveContact={archiveContact}
                  unarchiveContact={unarchiveContact}
                  archivePending={archivePending}
                  updateContact={updateContact}
                />
              </div>
            </div>

            {/* Narrow, a dot joins role and company, as in the meta line. */}
            {narrow ? (
              <DotLine
                className="font-medium text-on-surface-variant text-sm"
                items={[
                  { key: "role", node: roleField },
                  { key: "company", node: companyField },
                ]}
              />
            ) : (
              <div className="font-medium text-on-surface-variant flex flex-wrap items-center gap-x-1.5 mt-1 text-lg">
                {roleField}
                <span>at</span>
                {companyField}
              </div>
            )}

            {!narrow && (
              <ContactIntro
                contact={contact}
                onUpdate={onUpdate}
                className="mt-3"
              />
            )}

            {/* Always drawn, so "+ link" is always there. The last item and
                "+ link" are one element: a lone plus on a phone reads as a
                stray bullet, and focus stays on "+ link" while a new link
                arrives in front of it. */}
            <DotLine
              className={cn(
                "text-sm text-on-surface-variant",
                narrow ? "mt-1" : "mt-3",
              )}
              items={[
                ...metaItems.slice(0, -1),
                {
                  key: "last",
                  dot: metaItems.at(-1)?.dot,
                  node: (
                    <span className={META_ITEM}>
                      {metaItems.at(-1)?.node}
                      <AddLink
                        links={knownLinks}
                        onAdd={addSocialLink}
                        iconOnly={narrow}
                        openRequest={linkRequest}
                        onOpenRequestDone={onLinkRequestDone}
                      />
                    </span>
                  ),
                },
              ]}
            />

            {/* Tags, then lists. Narrow, they open the Details tab. */}
            {!narrow && (
              <ContactTags
                contact={contact}
                updateContact={updateContact}
                className="mt-3"
              />
            )}

            {!!contact.isGhost && narrow && addToNetwork("btn-secondary mt-3")}

            {showNetworkButton && (
              <div className="mt-4 flex items-center gap-3 flex-wrap">
                <button
                  onClick={() => {
                    if (onClose) onClose();
                    navigate(`/contact/${contact.id}`);
                  }}
                  className="btn-secondary"
                >
                  <ArrowUpRight aria-hidden="true" className="w-4 h-4" />
                  Open in Network
                </button>
              </div>
            )}
          </div>
        </section>
        {narrow && !contact.isGhost && <QuickActions contact={contact} />}
      </div>
    </>
  );
};

export const ProfileHeader = React.memo(ProfileHeaderInner);
