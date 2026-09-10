/**
 * BackupsView — snapshots of the database.
 *
 * The backup service has existed since long before 2.0 and nothing in the app
 * has ever shown it. It ran on a schedule, rotated old files, and the only
 * way to know whether any of that was working was to look in the data
 * directory over somebody's shoulder. A backup nobody can see is a backup
 * nobody trusts.
 *
 * A snapshot is the whole database, so it holds every account's rows. That is
 * why both routes are administration and why this page says so rather than
 * leaving an admin to infer it.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Camera, Database, HardDriveDownload } from "lucide-react";
import { useBackups, useCreateBackup } from "../../../api/admin";
import { formatBytes, formatRelative, formatWhen } from "../../../lib/datetime";
import { cn } from "../../../lib/utils";
import {
  AdminButton,
  AdminCell,
  AdminList,
  AdminPage,
  AdminRow,
} from "./AdminShell";

const COLUMNS = "sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_120px]";

export const BackupsView = () => {
  const { data: backups, isLoading, isError, refetch } = useBackups();
  const create = useCreateBackup();
  const [latest, setLatest] = useState<string | null>(null);

  return (
    <AdminPage
      lead="A snapshot copies the whole database, so it holds every account's contacts. Older snapshots are rotated out automatically."
      actions={
        <AdminButton
          busy={create.isPending}
          icon={<Camera className="w-4 h-4" />}
          disabled={create.isPending}
          onClick={() =>
            create.mutate(undefined, {
              onSuccess: (backup) => {
                setLatest(backup.filename);
                toast.success(
                  `Snapshot taken (${formatBytes(backup.sizeBytes)})`,
                );
              },
              onError: (error: Error) => toast.error(error.message),
            })
          }
        >
          Snapshot now
        </AdminButton>
      }
    >
      <AdminList
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        isEmpty={!isLoading && !isError && (backups?.length ?? 0) === 0}
        empty={
          <span className="flex items-start gap-2">
            <Database className="w-4 h-4 shrink-0 mt-0.5" />
            No snapshots yet. Take one now, or check that the scheduled backup
            is switched on in the server configuration.
          </span>
        }
        header={
          <div className={cn("grid gap-4", COLUMNS)}>
            <span>File</span>
            <span>Taken</span>
            <span className="text-right">Size</span>
          </div>
        }
        footer={
          <p className="text-xs text-on-surface-variant text-pretty">
            Snapshots live in the server&rsquo;s data directory. Copying them
            somewhere else is what makes them a backup, and Contrack cannot do
            that for you.
          </p>
        }
      >
        {backups?.map((backup) => (
          <AdminRow
            key={backup.filename}
            columns={COLUMNS}
            className={cn(
              backup.filename === latest && "ring-2 ring-inset ring-primary/40",
            )}
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="shrink-0 w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                <HardDriveDownload className="w-[18px] h-[18px]" />
              </span>
              <span className="font-mono text-xs text-on-surface truncate">
                {backup.filename}
              </span>
            </div>

            <AdminCell label="Taken">
              <span
                className="text-xs text-on-surface-variant"
                title={formatWhen(backup.createdAt)}
              >
                {formatRelative(backup.createdAt, "Unknown")}
              </span>
            </AdminCell>

            <AdminCell label="Size" className="sm:text-right">
              <span className="text-xs tabular-nums text-on-surface-variant">
                {formatBytes(backup.sizeBytes)}
              </span>
            </AdminCell>
          </AdminRow>
        ))}
      </AdminList>
    </AdminPage>
  );
};
