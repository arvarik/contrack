/**
 * StartPanel: the desktop pane beside the contact list when no contact is
 * open.
 *
 * It is empty on purpose. A version of this pane carried three cards (what
 * is due, recent people, ways to add people), and the page read as a second
 * dashboard beside the list. Pulse is the dashboard. This pane's one job is
 * to say that nothing is selected and to leave the eye on the list, so it
 * holds two things and nothing else: the mark, large and quiet, and the
 * words "No contact selected". The mark lives, calmly. A line under them telling a reader to pick
 * somebody was saying what the empty pane already says.
 *
 * The heading is an h2: the list's title is the page's h1.
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
  // An empty network says so in the list, with its own bird. A second one
  // here said "No contact selected" where there is nobody to select.
  const { data: contacts } = useContacts();
  if (contacts?.length === 0)
    return <div className="flex-1 h-full bg-surface" />;
  return (
    <div className="flex-1 flex flex-col items-center justify-center h-full bg-surface p-8 text-center select-none">
      {/*
      Calm: the big bird blinks, looks about and now and then looks back over
      its shoulder, and does nothing bigger. It keeps the pane company
      without pulling the eye off the list.
    */}
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
