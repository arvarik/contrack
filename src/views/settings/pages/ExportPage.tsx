/**
 * ExportPage — Download your contacts in standard formats.
 *
 * vCard, CSV, and JSON exports. An admin also gets the way to a copy of the
 * whole database.
 */
import React from "react";
import { Link } from "react-router-dom";
import { ExportCard } from "../ExportCard";
import { SETTINGS_PAGE } from "../layout";
import { useAuth } from "../../../components/auth/AuthGate";
import { cn } from "../../../lib/utils";

export const ExportPage = () => {
  const { isAdmin } = useAuth();

  return (
    <div className={cn(SETTINGS_PAGE, "space-y-4")}>
      <ExportCard />

      {isAdmin && (
        <p className="text-xs sm:text-sm text-on-surface-variant px-1 text-pretty">
          For a copy of the whole database, every account included, take a
          snapshot on the{" "}
          <Link
            to="/settings/admin/backups"
            className="font-semibold text-primary underline underline-offset-2"
          >
            Backups page
          </Link>
          .
        </p>
      )}
    </div>
  );
};

export default ExportPage;
