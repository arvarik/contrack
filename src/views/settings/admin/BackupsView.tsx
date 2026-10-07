/**
 * The database snapshots, and whether each one is any good. The service opens
 * each snapshot again right after it writes it, and this page shows that
 * check: a file with the right name and size restores nothing if it is empty.
 * A snapshot holds every account's rows, so both routes are admin-only.
 */
import { useState } from "react";
import { toast } from "sonner";
import {
  Camera,
  Database,
  Download,
  HardDriveDownload,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
} from "lucide-react";
import {
  downloadFile,
  useBackups,
  useCreateBackup,
  type BackupVerification,
} from "../../../api/admin";
import { useConnectors } from "../../../api/connectors";
import { Badge } from "../../../components/ui/Badge";
import { IconButton } from "../../../components/ui/IconButton";
import { formatBytes, formatRelative, formatWhen } from "../../../lib/datetime";
import { SELECTED_ROW, TONE_WASH } from "../../../lib/styles";
import { cn } from "../../../lib/utils";
import {
  AdminButton,
  AdminCell,
  AdminList,
  AdminPage,
  AdminRow,
} from "./AdminShell";

const COLUMNS = "sm:grid-cols-[minmax(0,2fr)_140px_minmax(0,1fr)_110px_44px]";

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
 * A snapshot has three states, not two. An older snapshot has no recorded
 * check, and it does not show as a failure, because nothing says it is broken.
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
  const { data: connectors } = useConnectors();
  const create = useCreateBackup();
  const [latest, setLatest] = useState<string | null>(null);

  return (
    <AdminPage
      actions={
        <AdminButton
          busy={create.isPending}
          icon={<Camera className="w-4 h-4" />}
          // Not `disabled`: a disabled button drops focus to the page.
          aria-disabled={create.isPending}
          onClick={() =>
            !create.isPending &&
            create.mutate(undefined, {
              onSuccess: (backup) => {
                setLatest(backup.filename);
                // A snapshot that failed its check gets an error, not a
                // success toast with a footnote.
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
        empty={{
          icon: Database,
          title: "No snapshots yet",
          body: "Take one now, or turn on scheduled snapshots in Settings → General",
        }}
        header={
          <div className={cn("grid gap-4", COLUMNS)}>
            <span>File</span>
            <span>Checked</span>
            <span>Taken</span>
            <span className="text-right">Size</span>
            <span className="sr-only">Download</span>
          </div>
        }
        footer={
          <div className="space-y-2">
            <p className="text-xs text-on-surface-variant text-pretty">
              A snapshot holds the whole database, every account&rsquo;s
              contacts included, and the oldest go on a schedule. Verified means
              it opened, passed SQLite&rsquo;s integrity check, and has rows in
              every table. A snapshot on the server&rsquo;s own disk is not a
              backup yet: download it and keep the copy somewhere else
            </p>
            {connectors && connectors.length > 0 && (
              <p className="text-xs text-on-surface-variant text-pretty">
                Connector credentials are sealed with{" "}
                <code className="font-mono text-on-surface">
                  DATA_DIR/secret.key
                </code>
                . Keep it with your backups
              </p>
            )}
          </div>
        }
      >
        {backups?.map((backup) => (
          <AdminRow
            key={backup.filename}
            columns={COLUMNS}
            // The one just taken wears the selected tint, not a ring: a ring
            // is the focus ring's look.
            className={cn(backup.filename === latest && SELECTED_ROW)}
          >
            <div className="flex items-center gap-3 min-w-0">
              <span
                className={cn(
                  "shrink-0 w-9 h-9 rounded-xl flex items-center justify-center",
                  TONE_WASH.primary,
                )}
              >
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

            <IconButton
              aria-label={`Download ${backup.filename}`}
              title="Download"
              tone="subtle"
              className="self-end sm:self-auto"
              onClick={() =>
                downloadFile(
                  `/admin/backups/${encodeURIComponent(backup.filename)}`,
                  backup.filename,
                ).catch((error: Error) => toast.error(error.message))
              }
            >
              <Download className="w-4 h-4" />
            </IconButton>

            {/* The reason shows in the row, not in a tooltip, because a phone
                has no hover. `col-span-full` puts it under the grid. */}
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
