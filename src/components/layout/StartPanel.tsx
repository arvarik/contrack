/**
 * The desktop pane beside the list when no contact is open. Empty on
 * purpose, so the eye stays on the list (Pulse is the dashboard): the mark
 * and "No contact selected", an h2 under the list's h1.
 */
import React from "react";
import { useNavigate } from "react-router-dom";
import { Compass } from "lucide-react";
import { CorvidMark } from "../brand/CorvidMark";
import { EmptyState } from "../ui/EmptyState";
import { useContacts } from "../../api";
import { usePageTitle } from "../../hooks/usePageTitle";
import { NAMES } from "../../lib/names";

export const StartPanel: React.FC = () => {
  // An empty network says so in the list, with its own bird.
  const { data: contacts } = useContacts();
  if (contacts?.length === 0)
    return <div className="flex-1 h-full bg-surface" />;
  return (
    <div className="flex-1 flex flex-col items-center justify-center h-full bg-surface p-8 text-center select-none">
      {/* Calm: the bird blinks and looks about, and does nothing bigger. */}
      <CorvidMark
        size={144}
        alive
        temperament="calm"
        className="text-primary/35"
      />
      <h2 className="mt-6 text-lg font-headline font-semibold text-on-surface">
        No contact selected
      </h2>
    </div>
  );
};

/** The pane for an address that names no page, with the way back. */
export const NotFoundPanel: React.FC = () => {
  const navigate = useNavigate();
  usePageTitle("Page not found");
  return (
    <div className="flex-1 flex items-center justify-center h-full bg-surface">
      <EmptyState
        icon={Compass}
        title="Page not found"
        body="This address names no page in Contrack"
        action={{
          label: `Go to ${NAMES.network.label}`,
          onClick: () => navigate("/"),
        }}
      />
    </div>
  );
};
