/**
 * BackupsView — snapshots of the database, and whether they are any good.
 *
 * The backup service has existed since long before 2.0 and nothing in the app
 * has ever shown it. It ran on a schedule, rotated old files, and the only
 * way to know whether any of that was working was to look in the data
 * directory over somebody's shoulder. A backup nobody can see is a backup
 * nobody trusts.
 *
 * Each snapshot is opened again as soon as it is written, and this page shows
 * the answer. That is the difference between a list of filenames and a list
 * of backups: a file of the right size with the right name restores nothing
 * if it is empty, and until 2.0 nothing ever looked.
 *
 * A snapshot is the whole database, so it holds every account's rows. That is
 * why both routes are administration and why this page says so rather than
 * leaving an admin to infer it.
 */
import { useState } from "react";
import { toast } from "sonner";
import {
  Camera,
  Database,
  HardDriveDownload,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
} from "lucide-react";
import {
  useBackups,
  useCreateBackup,
  type BackupVerification,
} from "../../../api/admin";
import { Badge } from "../../../components/ui/Badge";
import { formatBytes, formatRelative, formatWhen } from "../../../lib/datetime";
import { cn } from "../../../lib/utils";
import {
  AdminButton,
  AdminCell,
  AdminList,
  AdminPage,
  AdminRow,
} from "./AdminShell";

const COLUMNS = "sm:grid-cols-[minmax(0,2fr)_140px_minmax(0,1fr)_110px]";

/** Every row of a snapshot's verification, as one hoverable string. */
function verificationDetail(v: BackupVerification): string {
  const counted = Object.entries(v.rows)
    .map(([table, n]) => {
      const live = v.liveRows[table];
      return live === n ? `${table} ${n}` : `${table} ${n} (${live} live)`;
    })
    .join(", ");
  const when = `Checked ${formatWhen(v.checkedAt)}`;
  const integrity = `Integrity ${v.integrity}`;
  return v.problem
    ? `${when}. ${v.problem}. ${integrity}. ${counted}`
    : `${when}. ${integrity}. ${counted}`;
}

/**
 * The three states a snapshot can be in, and they are three, not two.
 *
 * A snapshot taken before 2.0 has no recorded check. Showing that as a
 * failure would tell an operator their old backups are broken, which is not
 * something this knows.
 */
const VerificationBadge = ({
  verification,
}: {
  verification: BackupVerification | null;
}) => {
  if (!verification) {
    return (
      <Badge icon={<ShieldQuestion className="w-3 h-3" />} tone="neutral">
        Not checked
      </Badge>
    );
  }
  if (!verification.ok) {
    return (
      <span title={verificationDetail(verification)}>
        <Badge icon={<ShieldAlert className="w-3 h-3" />} tone="danger">
          Failed
        </Badge>
      </span>
    );
  }

  return (
    <span title={verificationDetail(verification)}>
      <Badge icon={<ShieldCheck className="w-3 h-3" />} tone="success">
        Verified
      </Badge>
    </span>
  );
};

export const BackupsView = () => {
  const { data: backups, isLoading, isError, refetch } = useBackups();
  const create = useCreateBackup();
  const [latest, setLatest] = useState<string | null>(null);

  return (
    <AdminPage
      lead="A snapshot copies the whole database, so it holds every account's contacts. Each one is opened again and checked as soon as it is written. Older snapshots are rotated out automatically."
      actions={
        <AdminButton
          busy={create.isPending}
          icon={<Camera className="w-4 h-4" />}
          disabled={create.isPending}
          onClick={() =>
            create.mutate(undefined, {
              onSuccess: (backup) => {
                setLatest(backup.filename);
                // A snapshot that failed its check is not a success with a
                // footnote. The toast that says "done" for a backup nobody
                // can read is the thing this whole story is against.
                if (backup.verification && !backup.verification.ok) {
                  toast.error(
                    `Snapshot taken but it did not verify: ${backup.verification.problem}`,
                    { duration: 12_000 },
                  );
                  return;
                }
                toast.success(
                  `Snapshot taken and verified (${formatBytes(backup.sizeBytes)})`,
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
            <span>Checked</span>
            <span>Taken</span>
            <span className="text-right">Size</span>
          </div>
        }
        footer={
          <p className="text-xs text-on-surface-variant text-pretty">
            A verified snapshot opened cleanly, passed SQLite&rsquo;s integrity
            check, and holds rows in every table this database does. Snapshots
            live in the server&rsquo;s data directory, and copying them
            somewhere else is what makes them a backup, which Contrack cannot do
            for you.
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

            <AdminCell label="Checked">
              <VerificationBadge verification={backup.verification} />
            </AdminCell>

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

            {/*
              The reason, in the row rather than in a tooltip. A hover is the
              one affordance a phone does not have, and the snapshot that
              failed is the one somebody most needs told about. `col-span-full`
              puts it under the grid on a desktop; below `sm` the row is a
              stack and it is simply the last line.
            */}
            {backup.verification && !backup.verification.ok && (
              <p className="sm:col-span-full text-xs text-error text-pretty">
                {backup.verification.problem}
              </p>
            )}
          </AdminRow>
        ))}
      </AdminList>
    </AdminPage>
  );
};
