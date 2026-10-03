import { useParams, useNavigate, useLocation } from "react-router-dom";
import { X } from "lucide-react";
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

  const handleClose = () => navigate(back.to);

  return (
    <div className="h-full w-full relative bg-surface md:bg-transparent">
      {/* In the Back bar's height below `lg`. From `lg`, 2 px from the top:
          inside the 44 px follow-up banner when there is one, where 16 px
          left it half on the banner and half off. No fill of its own: it
          wears the surface under it, the banner's wash or the page, where a
          page-coloured square sat on the red wash. */}
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
