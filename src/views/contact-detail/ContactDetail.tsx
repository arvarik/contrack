import { useLayoutEffect } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";
import { settleSlide, useSlideNavigate } from "../settings/slide";
import { ContactProfile } from "./components/ContactProfile";
import { backTarget } from "./backTarget";

export const ContactDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const isMapActive = location.pathname.startsWith("/map");
  const isArchived = location.pathname.startsWith("/settings/archived");
  const isOverlayActive = isMapActive || isArchived;

  const back = backTarget(location.pathname, location.state, location.search);

  /**
   * Below `lg` on the network route, a row slides the contact in and Back
   * slides it out (`views/settings/slide`). Over the map and in Settings the
   * contact is a panel, and nothing slides.
   */
  const slide = useSlideNavigate();
  const handleClose = () =>
    // Only the list and the Settings pages finish a slide, so any other
    // target navigates. The list's address can carry a query ("/?q=ada").
    isOverlayActive ||
    !(/^\/(\?|$)/.test(back.to) || back.to.startsWith("/settings"))
      ? navigate(back.to)
      : slide(back.to, "back");
  useLayoutEffect(() => {
    if (!isOverlayActive) settleSlide(location.pathname);
  }, [isOverlayActive, location.pathname]);

  return (
    <div
      className={cn(
        "h-full w-full relative bg-surface",
        // Opaque at every width, or the list shows through the sliding contact.
        isOverlayActive ? "md:bg-transparent" : "settings-stage",
      )}
    >
      {/* From `lg`, 2 px from the top, so it sits inside the 44 px follow-up
          banner. No fill of its own: it takes the banner's wash. */}
      {isOverlayActive && (
        <button
          onClick={handleClose}
          className="hit-area state-layer hidden md:flex absolute top-2 right-2 md:top-4 md:right-4 lg:top-0.5 lg:right-2 p-2.5 rounded-lg z-[100] text-on-surface-variant hover:text-on-surface transition-colors"
          title="Close details"
          aria-label="Close contact details"
        >
          <X className="w-5 h-5" />
        </button>
      )}

      {id ? (
        <ContactProfile
          key={id}
          contactId={id}
          onClose={handleClose}
          backLabel={back.label}
        />
      ) : (
        <div className="p-12 text-center text-on-surface-variant">
          No contact selected
        </div>
      )}
    </div>
  );
};
