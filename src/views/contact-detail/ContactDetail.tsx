import React from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { X } from "lucide-react";
import { ContactProfile } from "./components/ContactProfile";

export const ContactDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  
  const isMapActive = location.pathname.startsWith('/map');
  const isOverlayActive = isMapActive || location.pathname.startsWith('/settings/archived');
  
  const handleClose = () => {
    if (location.pathname.startsWith('/settings/archived')) navigate('/settings/archived');
    else if (isMapActive) navigate('/map');
    else navigate('/');
  };

  return (
    <div className="h-full w-full relative bg-surface md:bg-transparent">
      {isOverlayActive && (
        <button onClick={handleClose} className="hidden md:flex absolute top-2 right-2 md:top-4 md:right-4 p-2.5 bg-surface hover:bg-surface-container-high rounded-full z-[100] shadow-sm transition-colors" title="Close Details" aria-label="Close contact details">
          <X className="w-5 h-5 text-on-surface-variant" />
        </button>
      )}

      {id ? (
        <ContactProfile contactId={id} onClose={handleClose} />
      ) : (
        <div className="p-12 text-center text-on-surface-variant">No Contact Selected</div>
      )}
    </div>
  );
};
