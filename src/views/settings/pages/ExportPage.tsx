/**
 * ExportPage — Download your contacts in standard formats.
 *
 * vCard, CSV, and JSON exports.
 */
import React from "react";
import { Link } from "react-router-dom";
import { ExportCard } from "../ExportCard";
import { useAuth } from "../../../components/auth/AuthGate";

export const ExportPage = () => {
  const { isAdmin } = useAuth();

  return (
    <div className="p-4 sm:p-6 md:p-10 max-w-4xl mx-auto space-y-6 pb-28 md:pb-10">
      <div className="space-y-1">
        <p className="text-sm text-on-surface-variant">
          Take your contacts and interactions with you.
        </p>
      </div>

      <ExportCard />

      {isAdmin && (
        <p className="text-xs text-on-surface-variant px-1">
          Looking for full database snapshots? Administrators can manage{" "}
          <Link
            to="/settings/admin/backups"
            className="text-primary underline font-medium"
          >
            database backups
          </Link>
          .
        </p>
      )}
    </div>
  );
};

export default ExportPage;
