/**
 * ProfileHeader: who this contact is.
 *
 * Wide (the contact pane is 768 px or more):
 *
 * ```
 * (avatar 96) Thomas Walker (they/them)                  ◎ Quarterly ▾  ⋮
 *          ✎  UX Researcher at Umbrella Corp
 *             Sydney · 2:45 AM AEST · 13°C · in ThomasWalker ↗ · @Thomas_Walker ↗  + link
 *             [tech-lead ×] [advisor ×] [+ tag]
 * ```
 *
 * Narrow (a phone, or a pane too slim for two columns):
 *
 * ```
 * ← Network
 * (avatar 56) Thomas Walker                                  ◎ ▾  ⋮
 *          ✎  UX Researcher · Umbrella Corp
 *             Sydney · 2:45 AM AEST · in ↗  +
 * ```
 *
 * 1. The name is the page's h1 and takes focus when a contact opens.
 * 2. The ring around the avatar is the relationship score (ScoreRingAvatar).
 *    The contact's own colour is the page accent, not the ring. The pencil
 *    on the ring's lower right changes the picture (`AvatarEditButton`).
 * 3. The meta line is text. Facts (place, local time with its zone, weather)
 *    are plain, and links look like links, with ↗ because they open a new
 *    tab. "+ link" ends the line with no dot before it, because it is an
 *    action and not a fact (`AddLink`).
 * 4. The header has no primary button. Colour, enrichment, copy, archive and
 *    delete sit in the kebab, and the pencil on the avatar changes the
 *    avatar. A note starts in the composer under the tabs, which is the
 *    first thing in the Timeline column, so a button for it here said the
 *    same thing twice. Track is the one control beside the kebab: a menu
 *    that says the cadence while the contact is tracked (`TrackButton`).
 * 5. The narrow header keeps to about 140 px. The headline, the summary and
 *    the tags move to the Details tab (`ContactIntro`, `ContactTags`), and
 *    the weather stays off.
 *
 * The briefing lives in the Dossier tab, not here.
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
  Pencil,
  Trash2,
} from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";

import type {
  Contact,
  ContactSocialLink,
  ContactUpdateData,
} from "../../../types";
import { cleanLinkedInSlug, cn, safeHref } from "../../../lib/utils";
import { META_LINE, TONE_WASH } from "../../../lib/styles";
import { copyToClipboard, CLIPBOARD_DENIED } from "../../../lib/clipboard";

import {
  LocalTimeWeather,
  timeZoneAt,
} from "../../../components/LocalTimeWeather";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { ActionMenu } from "../../../components/ui/ActionMenu";
import { MetaDot } from "../../../components/ui/MetaDot";
import { ScoreRingAvatar } from "../../../components/ScoreRingAvatar";
import { ScoreBreakdown } from "../../../components/ScoreBreakdown";
import { scoreView } from "../../../../shared/scoreBand";

import { EditableField } from "./EditableField";
import { PlatformIcon, PLATFORM_COLORS, hasKnownIcon } from "./PlatformIcon";
import { AddLink } from "./AddLink";
import { ContactActionsMenu } from "./ContactActionsMenu";
import { ContactTags } from "./ContactTags";
import { TrackButton } from "./TrackButton";
import { BANNER_DAYS, describeFollowUp } from "../../../lib/followUp";
import { CONTACT_HEADING_ID } from "../../../components/layout/SkipLink";
import { hasUserInteracted } from "../../../lib/userInteraction";

/** The two forms of the contact page. See ContactProfile. */
export type ContactLayout = "wide" | "narrow";

// ═══════════════════════════════════════════════════════════════════════════
// Props
// ═══════════════════════════════════════════════════════════════════════════

export interface ProfileHeaderProps {
  contact: Contact;
  onUpdate: (field: string, val: string) => void;
  onDelete: () => void;
  onClose?: () => void;
  /** Opens the avatar picker. The pencil on the avatar calls it. */
  onOpenAvatarPicker: () => void;
  /**
   * Receives the pencil, so the avatar picker can hand focus back to it when
   * it closes. Safari does not focus a button it clicks, so "wherever focus
   * was" could be the page.
   */
  avatarEditRef?: React.Ref<HTMLButtonElement>;
  showNetworkButton?: boolean;
  /** Which form to draw. Defaults to wide. */
  layout?: ContactLayout;
  /**
   * Where Back goes, by the name of the page: "Network", "Map". The button
   * says it, so nobody has to guess. Without one, the button says "Back".
   */
  backLabel?: string;

  // Mutations passed from parent
  archiveContact: {
    mutate: (
      id: string,
      opts?: { onSuccess?: () => void; onError?: (err: Error) => void },
    ) => void;
    isPending: boolean;
  };
  unarchiveContact: {
    mutate: (
      id: string,
      opts?: { onSuccess?: () => void; onError?: (err: Error) => void },
    ) => void;
    isPending: boolean;
  };
  updateContact: {
    mutate: (args: { id: string; data: ContactUpdateData }) => void;
  };
  promoteGhost: {
    mutate: (
      id: string,
      opts?: { onSuccess?: () => void; onError?: (err: Error) => void },
    ) => void;
    isPending: boolean;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Meta line helpers
// ═══════════════════════════════════════════════════════════════════════════

/** The first comma part of a place: "Sydney" from "Sydney, NSW, Australia". */
const shortPlace = (text: string | null | undefined): string | null =>
  text?.split(",")[0]?.trim() || null;

/** "Linkedin" from "linkedin": the label used when a link has no handle. */
const capitalise = (text: string) =>
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
  // Capitalize platform name for known ones
  if (!sl.handle && isKnown) {
    displayName = capitalise(sl.platform);
  }

  // Clean up LinkedIn auto-generated suffixes for display
  if (platformKey === "linkedin" && sl.handle) {
    displayName = cleanLinkedInSlug(sl.handle);
  } else if (platformKey === "linkedin" && sl.url) {
    // Extract slug from LinkedIn URL and clean it
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

/** One item on the meta line, with the dot before it. */
const META_ITEM = "inline-flex items-center gap-x-2 min-w-0 max-w-full";

/** The host of a website, without "www.". */
function websiteName(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return "Website";
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// AvatarEditButton: the pencil on the avatar
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The pencil on the avatar, "Change avatar", which opens the avatar picker.
 *
 * It was an item in the kebab, one of six, far from the picture it changes.
 * The products people know put the control on the picture: GitHub an Edit
 * button with a pencil over its corner, Google a pen on the picture in the
 * account menu, Discord's app a pencil on the avatar. Slack and Discord's
 * desktop put a labelled button beside it, which this header has no room
 * for, and Notion and LinkedIn make the picture itself the button, which
 * this one cannot be: a scored ring is already the button that explains the
 * score. A layer that shows on hover over the picture would never show on a
 * phone, and it would promise that a click on the picture edits it.
 *
 * So it is a small round badge of its own, a sibling of the score button and
 * never inside it, on the ring's lower right, where the corner of the box
 * puts its centre on the circle:
 *
 * 1. 28 px on the 96 px avatar and 24 px on the narrow header's 56 px one,
 *    each with the 44 px tap box of `hit-area`. The box sits 10 px out from
 *    the badge's centre, towards the empty corner: centred, on the 56 px
 *    avatar it reached past the avatar's middle, and a tap on the face,
 *    which asks for the score, opened the picker. The pencil still wins the
 *    taps where the two boxes meet, as the later control.
 * 2. At rest it is lightly clear: the card face at 85 percent with a blur,
 *    a hairline edge and a 2 px ring in the page's colour that cuts it out
 *    of the score ring, and the pencil in the variant ink. It shows at rest
 *    on every screen, so a phone, which has no hover, always has it.
 * 3. On hover and on focus the face turns solid and the pencil takes the
 *    full ink. The face is what changes, not a layer over it: over a photo,
 *    the state layer's 6 percent ink on a clear face reads as a smudge. On
 *    press it sinks to 95 percent, which a glyph with no text may do.
 * 4. Its name and its tooltip are "Change avatar". Focus draws the app's one
 *    ring, which nothing here clips, and comes back to the pencil when the
 *    picker closes (`avatarEditRef`, passed to the picker's `Modal`).
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
      // The tap box, moved out towards the corner (see 1 above).
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

// ═══════════════════════════════════════════════════════════════════════════
// SocialLink: a text link on the meta line, with its own small actions menu
// ═══════════════════════════════════════════════════════════════════════════

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
   * The narrow header's form: the platform icon and ↗, with the handle as the
   * link's name and its tooltip. Two handles in words take a phone's meta
   * line onto three lines.
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
      {/* The icon is hidden: a favicon's alt text would add a host name to
          the link's name. */}
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
      <span aria-hidden="true" className="text-on-surface-variant">
        ↗
      </span>
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
    {onRemove && (
      <ActionMenu
        label={`Actions for ${displayName}`}
        iconClassName="w-3.5 h-3.5"
        // At rest at every width. Hidden until hover, it still took its width,
        // so the gap after each link was wider than the gap after each fact.
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

// ═══════════════════════════════════════════════════════════════════════════
// ContactIntro: the headline and the AI summary
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The headline and the summary, when they add something.
 *
 * Under the role in the wide header, and at the top of the Details tab in the
 * narrow layout. Renders nothing when there is nothing new to say.
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
  let headline: React.ReactNode = null;
  if (contact.headline) {
    // Hide the headline when it only repeats the role and company, which the
    // line above already shows.
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const headlineNorm = normalize(contact.headline);
    const isDuplicate =
      headlineNorm ===
        normalize(`${contact.role || ""} at ${contact.company || ""}`) ||
      headlineNorm ===
        normalize(`${contact.role || ""} ${contact.company || ""}`) ||
      (contact.role && headlineNorm === normalize(contact.role)) ||
      (contact.company && headlineNorm === normalize(contact.company));
    if (!isDuplicate) {
      headline = (
        <div className="text-base text-on-surface-variant font-medium italic">
          <EditableField
            value={contact.headline}
            onSave={(val) => onUpdate("headline", val)}
            placeholder="Add headline"
          />
        </div>
      );
    }
  }

  if (!headline && !contact.aiSummary) return null;
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {headline}
      {/* A model wrote the summary, so it wears the AI colour. */}
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

// ═══════════════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════════════

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
  updateContact,
  promoteGhost,
}) => {
  const navigate = useNavigate();
  const narrow = layout === "narrow";
  const { preferences } = usePreferences();

  /**
   * Opening a contact puts focus on its name.
   *
   * Clicking a row used to leave focus on the row while the contact rendered
   * beside it, and on a phone, where the list leaves the screen, focus fell to
   * the document. Either way the next Tab started somewhere unrelated to what
   * just opened. The name is the page's h1, so a screen reader also announces
   * which contact this is.
   *
   * Three cases keep focus where it is: a page that has just loaded (the
   * first Tab there belongs to the skip link), someone typing (a quick note, a
   * search field) and a contact shown inside a dialog, which manages its own
   * focus. The header mounts once per contact, because the profile is keyed
   * by id.
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

  // ── Social links ──────────────────────────────────────────────────────
  /** The links as the update takes them: what each is, not its row id. */
  const linkPayload = (links: ContactSocialLink[]) =>
    links.map((s) => ({
      platform: s.platform,
      url: s.url,
      handle: s.handle,
    }));

  /**
   * "+ link": the links the contact has, and the new one with its URL alone.
   * The server works out its platform and handle from the host.
   */
  const addSocialLink = (url: string) => {
    updateContact.mutate({
      id: contact.id,
      data: {
        socialLinks: [...linkPayload(contact.socialLinks || []), { url }],
      },
    });
  };

  const removeSocialLink = (id: string) => {
    const before = contact.socialLinks || [];
    const after = before.filter((s) => s.id !== id);
    updateContact.mutate({
      id: contact.id,
      data: { socialLinks: linkPayload(after) },
    });
    toast("Link removed", {
      duration: 7000,
      action: {
        label: "Undo",
        onClick: () =>
          updateContact.mutate({
            id: contact.id,
            data: { socialLinks: linkPayload(before) },
          }),
      },
    });
  };

  // ── Meta line ─────────────────────────────────────────────────────────
  // Each item is one fact or one link. The dots go between items, so the
  // line never starts or ends with one. "+ link" follows the last item with
  // no dot: it is an action, not a fact.
  const metaItems: { key: string; node: React.ReactNode }[] = [];
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
          // The settings revamp's `showWeather` preference replaces the wide
          // case. The narrow header has room for one line, and no weather.
          showWeather={!narrow && preferences.showWeather}
        />
      ),
    });
  }
  for (const sl of contact.socialLinks || []) {
    const platformKey = sl.platform?.toLowerCase() || "other";
    const isKnown = hasKnownIcon(platformKey);
    const displayName = socialLinkName(sl);
    const platformName = isKnown ? capitalise(platformKey) : undefined;
    metaItems.push({
      key: `link-${sl.id}`,
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

  return (
    <>
      {/*
        Back, below `lg`, where the contact has the screen and the list does
        not show. It names the page it goes to. The bar is 56 px tall, and the
        narrow layout's tabs stick right under it (ContactProfile).
      */}
      {onClose && (
        <div className="sticky top-0 z-30 glass-panel h-14 px-4 lg:hidden flex items-center shrink-0">
          <button
            type="button"
            onClick={onClose}
            aria-label={backLabel ? `Back to ${backLabel}` : undefined}
            className="hit-area state-layer flex items-center gap-2 text-on-primary-wash font-bold px-3 py-1.5 -ml-3 rounded-xl transition-colors"
          >
            <ArrowLeft aria-hidden="true" className="w-5 h-5" />
            {backLabel ?? "Back"}
          </button>
        </div>
      )}

      {/*
        The next follow-up, when it is late, today or within the week, in
        the words of the fact: "Follow-up 3 days overdue", "Follow-up due
        Friday". It read "Pending follow-up alert", which said neither what
        nor when. A week out is the last day Pulse's "This week" holds, so
        the two show the same follow-ups. Details has the date too, but under
        the fold, or behind a tab on a phone. A later follow-up is only there.
      */}
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

      <div
        className={cn(
          "max-w-6xl mx-auto w-full relative shrink-0",
          narrow ? "px-4 pt-4 pb-3" : "p-8 lg:px-10 lg:pt-8 lg:pb-6",
        )}
      >
        <section
          className={cn(
            "flex flex-row items-start",
            narrow ? "gap-4" : "gap-6",
          )}
        >
          {/* Avatar in the score ring, with the pencil that changes it.

              A scored ring is the button that explains the score. The
              breakdown used to be reachable only from the map's hover card,
              which is the one place a person is not reading about this
              contact. The ring is then decorative, because the button around
              it carries the name.

              `flex`, so the box is the avatar's own size: as a block around
              an inline button it ran 6 px under the ring, and everything
              placed on its edge sat 6 px low. */}
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
            {/* The warning ink on the card face, lifted off the page by its
                shadow. White on a raw amber measured about 2 to 1. It sits
                just under the avatar, centred: over the ring's bottom edge,
                where it sat before the pencil came, it ran into the pencil
                at both sizes. The narrow header drops the glyph and some
                padding: at 95 px the chip was wider than the 56 px avatar
                and its gap, and ran off the phone's edge and into the meta
                line. The word says it alone. */}
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
                    ? `Seen ${count} time${count === 1 ? "" : "s"} in your ${sourceName}. Waiting to be populated.`
                    : "Created automatically from a mention. Waiting to be populated.";

                  return (
                    <div className="absolute -top-3 -right-3 flex items-center justify-center w-8 h-8 rounded-full bg-surface-container-highest border-2 border-surface-container-lowest shadow-sm z-20 group/ghosticon cursor-help">
                      <Sparkles className="w-4 h-4 text-primary opacity-80 group-hover/ghosticon:opacity-100 transition-opacity" />
                      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-48 bg-surface text-on-surface text-xs font-medium p-2.5 rounded-xl shadow-lg border border-surface-container opacity-0 pointer-events-none group-hover/ghosticon:opacity-100 transition-all z-50 text-center leading-relaxed">
                        <strong className="block text-primary mb-0.5">
                          Ghost profile
                        </strong>
                        {ghostText}
                      </div>
                    </div>
                  );
                })()
              : null}
          </div>

          {/* Identity */}
          <div className="flex-1 min-w-0 w-full">
            {/* The name, then the actions. On a narrow screen the actions
                wrap under the name. */}
            <div
              className={cn(
                "flex items-center justify-between",
                narrow ? "gap-2" : "flex-wrap gap-x-4 gap-y-3",
              )}
            >
              {/*
                The page's h1. `tabIndex={-1}` lets focus land here on
                navigation and from the skip link without adding a Tab stop.
                No ring: it is a place, not a control, and the name inside it
                is the control and shows its own.
              */}
              <h1
                id={CONTACT_HEADING_ID}
                ref={headingRef}
                tabIndex={-1}
                className={cn(
                  "min-w-0 font-extrabold font-headline tracking-tight text-on-surface flex flex-wrap items-center gap-x-2 gap-y-1 py-0.5 outline-none",
                  narrow ? "text-2xl" : "text-4xl",
                )}
              >
                <EditableField
                  value={contact.name}
                  onSave={(val) => onUpdate("name", val)}
                  placeholder="Contact name"
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
                {!!contact.isGhost && !narrow && (
                  <button
                    type="button"
                    onClick={() => {
                      promoteGhost.mutate(contact.id, {
                        onSuccess: () =>
                          toast.success(`${contact.name} promoted to network!`),
                      });
                    }}
                    disabled={promoteGhost.isPending}
                    className="btn-secondary"
                  >
                    <Sparkles aria-hidden="true" className="w-4 h-4" />
                    {promoteGhost.isPending
                      ? "Promoting…"
                      : "Promote to contact"}
                  </button>
                )}

                {/* Track: a menu that says the cadence while tracked. A
                    ghost cannot be tracked: it shows Promote to contact. */}
                {!contact.isGhost && (
                  <TrackButton contact={contact} compact={narrow} />
                )}

                <ContactActionsMenu
                  contact={contact}
                  onDelete={onDelete}
                  archiveContact={archiveContact}
                  unarchiveContact={unarchiveContact}
                  updateContact={updateContact}
                />
              </div>
            </div>

            {/* Role at company. Narrow, a dot joins them, as in the meta line. */}
            <div
              className={cn(
                "font-medium text-on-surface-variant flex flex-wrap items-center gap-x-1.5",
                narrow ? "text-sm" : "mt-1 text-lg",
              )}
            >
              <EditableField
                value={contact.role}
                onSave={(val) => onUpdate("role", val)}
                placeholder="Role / title"
              />
              {narrow ? <MetaDot /> : <span>at</span>}
              <EditableField
                value={contact.company}
                onSave={(val) => onUpdate("company", val)}
                placeholder="Company"
              />
            </div>

            {!narrow && (
              <ContactIntro
                contact={contact}
                onUpdate={onUpdate}
                className="mt-3"
              />
            )}

            {/* Meta line: facts as text, links as links, and "+ link" at
                the end. The line always shows, so "+ link" is always there,
                even for a contact with no facts yet. */}
            <div className={cn(META_LINE, narrow ? "mt-1" : "mt-3")}>
              {/* Each dot stays with the item after it, so a line that
                  wraps never ends on a dot. */}
              {metaItems.slice(0, -1).map((item, index) => (
                <span key={item.key} className={META_ITEM}>
                  {index > 0 && <MetaDot />}
                  {item.node}
                </span>
              ))}
              {/*
                The last item and "+ link" wrap as one: on a phone the plus
                on a line of its own read as a stray bullet. No dot before
                it: an action, not a fact. The pair is one element whatever
                the last item is, so "+ link" is the same element after a
                save, and focus stays on it while the new link arrives in
                front of it.
              */}
              <span key="last" className={META_ITEM}>
                {metaItems.length > 1 && <MetaDot />}
                {metaItems.at(-1)?.node}
                <AddLink
                  links={knownLinks}
                  onAdd={addSocialLink}
                  iconOnly={narrow}
                />
              </span>
            </div>

            {/* Tags, then lists. Narrow, they open the Details tab. */}
            {!narrow && (
              <ContactTags
                contact={contact}
                updateContact={updateContact}
                className="mt-3"
              />
            )}

            {/* A ghost's one step, under the name where a phone has room. */}
            {!!contact.isGhost && narrow && (
              <button
                type="button"
                onClick={() => {
                  promoteGhost.mutate(contact.id, {
                    onSuccess: () =>
                      toast.success(`${contact.name} promoted to network!`),
                  });
                }}
                disabled={promoteGhost.isPending}
                className="btn-secondary mt-3"
              >
                <Sparkles aria-hidden="true" className="w-4 h-4" />
                {promoteGhost.isPending ? "Promoting…" : "Promote to contact"}
              </button>
            )}

            {/* Actions Row */}
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
      </div>
    </>
  );
};

export const ProfileHeader = React.memo(ProfileHeaderInner);
