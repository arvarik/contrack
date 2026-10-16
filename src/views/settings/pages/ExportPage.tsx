/**
 * ExportPage: vCard, CSV and JSON exports. An admin also gets the way to a
 * copy of the whole database.
 */
import { Link } from "react-router-dom";
import { ExportCard } from "../ExportCard";
import { SETTINGS_PAGE } from "../layout";
import { useHashTarget } from "../SettingRow";
import { useAuth } from "../../../components/auth/AuthGate";
import { TEXT_LINK } from "../../../lib/styles";
import { cn } from "../../../lib/utils";

export const ExportPage = () => {
  const { isAdmin } = useAuth();
  const exportTarget = useHashTarget<HTMLDivElement>("export");

  return (
    <div className={cn(SETTINGS_PAGE, "space-y-4")}>
      <div
        id="export"
        ref={exportTarget.ref}
        tabIndex={-1}
        className={cn(
          "scroll-mt-20 outline-none rounded-2xl transition-colors duration-(--dur-slow)",
          exportTarget.flashing && "flash bg-primary/10",
        )}
      >
        <ExportCard />
      </div>

      {isAdmin && (
        <p className="text-xs sm:text-sm text-on-surface-variant px-1 text-pretty">
          For a full instance snapshot across all accounts, open the{" "}
          <Link to="/settings/admin/backups" className={TEXT_LINK}>
            Backups page
          </Link>
        </p>
      )}
    </div>
  );
};

export default ExportPage;
