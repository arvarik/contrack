import React from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { X } from "lucide-react";
import { ContactProfile } from "./components/ContactProfile";
import { NAMES } from "../../lib/names";

/** The title of the archived contacts page in Settings. */
const ARCHIVED_LABEL = "Archived contacts";

export const ContactDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const isMapActive = location.pathname.startsWith("/map");
  const isArchived = location.pathname.startsWith("/settings/archived");
  const isOverlayActive = isMapActive || isArchived;

  // Where Back goes, and the name the button says. The two stay together so
  // the button never names one page and opens another.
  const back = isArchived
    ? { to: "/settings/archived", label: ARCHIVED_LABEL }
    : isMapActive
      ? { to: "/map", label: NAMES.map.label }
      : { to: "/", label: NAMES.network.label };

  const handleClose = () => navigate(back.to);

  return (
    <div className="h-full w-full relative bg-surface md:bg-transparent">
      {isOverlayActive && (
        <button
          onClick={handleClose}
          className="hit-area hidden md:flex absolute top-2 right-2 md:top-4 md:right-4 p-2.5 bg-surface hover:bg-surface-container-high rounded-lg z-[100] shadow-sm transition-colors"
          title="Close Details"
          aria-label="Close contact details"
        >
          <X className="w-5 h-5 text-on-surface-variant" />
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
          No Contact Selected
        </div>
      )}
    </div>
  );
};
