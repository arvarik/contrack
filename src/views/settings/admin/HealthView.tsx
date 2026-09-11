/**
 * HealthView — one instance, at a glance.
 *
 * `/healthz` answers "ok" or nothing, which is the right answer for a probe
 * anybody who can reach the port may ask. This page is the other half: the
 * questions somebody has when four people share an instance and one of them
 * says it is slow.
 *
 * Every card answers one of those questions and says what the answer means.
 * A number with no sense of what it should be is not an answer: 18 MB of
 * write-ahead log means nothing until you know the sweep truncates at 64, and
 * "0 embedded" means nothing until you can see it is 0 of 431.
 *
 * The page refetches every fifteen seconds. The numbers worth opening it for
 * are the ones that move.
 */
import {
  Activity,
  AlertTriangle,
  Check,
  Clock,
  Copy,
  Database,
  HardDriveDownload,
  Layers,
  Search,
  Sparkles,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  useInstanceHealth,
  type HealthAccount,
  type InstanceHealth,
} from "../../../api/admin";
import { Badge } from "../../../components/ui/Badge";
import { formatBytes, formatRelative, formatWhen } from "../../../lib/datetime";
import { cn } from "../../../lib/utils";
import { AdminPage } from "./AdminShell";

// ---------------------------------------------------------------------------
// The card, and the one row inside it
// ---------------------------------------------------------------------------

const Card = ({
  title,
  icon,
  badge,
  children,
}: {
  title: string;
  icon: ReactNode;
  badge?: ReactNode;
  children: ReactNode;
}) => (
  <section className="bg-surface-container-lowest rounded-2xl shadow-sm p-5 space-y-3">
    <header className="flex items-center gap-2.5">
      <span className="shrink-0 w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
        {icon}
      </span>
      <h2 className="text-sm font-bold text-on-surface flex-1 min-w-0 truncate">
        {title}
      </h2>
      {badge}
    </header>
    <dl className="space-y-2">{children}</dl>
  </section>
);

/**
 * A label and a value.
 *
 * `dt`/`dd` rather than two spans: this is a list of terms and their
 * definitions, which is what a screen reader should be told it is reading.
 */
const Row = ({
  label,
  children,
  tone,
}: {
  label: string;
  children: ReactNode;
  tone?: "normal" | "warning" | "error";
}) => (
  <div className="flex items-baseline justify-between gap-4 text-xs">
    <dt className="text-on-surface-variant shrink-0">{label}</dt>
    <dd
      className={cn(
        "text-right tabular-nums font-medium min-w-0 truncate",
        tone === "error" && "text-error",
        tone === "warning" && "text-warning",
        (!tone || tone === "normal") && "text-on-surface",
      )}
    >
      {children}
    </dd>
  </div>
);

/** Seconds, as something a person reads without counting zeros. */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

const account = (who: HealthAccount | null): string =>
  who?.username ?? "Nobody";

// ---------------------------------------------------------------------------
// The cards
// ---------------------------------------------------------------------------

const SchemaCard = ({ health }: { health: InstanceHealth }) => {
  const { schema } = health;
  return (
    <Card
      title="Schema"
      icon={<Layers className="w-4 h-4" />}
      badge={
        schema.upToDate ? (
          <Badge tone="success" icon={<Check className="w-3 h-3" />}>
            Migrated
          </Badge>
        ) : (
          <Badge tone="warning" icon={<AlertTriangle className="w-3 h-3" />}>
            Behind
          </Badge>
        )
      }
    >
      <Row
        label="Tenancy"
        tone={schema.tenancy < schema.tenancyExpected ? "warning" : "normal"}
      >
        v{schema.tenancy}
        {schema.tenancy < schema.tenancyExpected &&
          ` of v${schema.tenancyExpected}`}
      </Row>
      <Row
        label="Search index"
        tone={schema.fts < schema.ftsExpected ? "warning" : "normal"}
      >
        v{schema.fts}
        {schema.fts < schema.ftsExpected && ` of v${schema.ftsExpected}`}
      </Row>
      <Row label="sqlite-vec">{schema.vec}</Row>
      <Row label="Uptime">{formatUptime(health.uptimeSeconds)}</Row>
    </Card>
  );
};

const DatabaseCard = ({ health }: { health: InstanceHealth }) => {
  const { database } = health;
  const walIsLarge = database.walBytes > database.truncateAtBytes;
  const contacts = database.rows.contacts ?? 0;
  return (
    <Card
      title="Database"
      icon={<Database className="w-4 h-4" />}
      badge={
        database.busyErrors > 0 ? (
          <Badge tone="warning" icon={<AlertTriangle className="w-3 h-3" />}>
            {database.busyErrors} busy
          </Badge>
        ) : undefined
      }
    >
      <Row label="File">{formatBytes(database.bytes)}</Row>
      <Row label="Write-ahead log" tone={walIsLarge ? "warning" : "normal"}>
        {formatBytes(database.walBytes)}
      </Row>
      <Row label="Last checkpoint">
        {database.lastCheckpoint ? (
          <span title={formatWhen(database.lastCheckpoint.at)}>
            {database.lastCheckpoint.mode},{" "}
            {database.lastCheckpoint.checkpointedPages} pages
          </span>
        ) : (
          "None since boot"
        )}
      </Row>
      <Row
        label="Writes refused"
        tone={database.busyErrors > 0 ? "warning" : "normal"}
      >
        {database.busyErrors}
        {database.lastBusyErrorAt &&
          `, last ${formatRelative(database.lastBusyErrorAt, "unknown")}`}
      </Row>
      <Row label="Contacts">{contacts.toLocaleString()}</Row>
    </Card>
  );
};

const BackupCard = ({ health }: { health: InstanceHealth }) => {
  const { backup } = health;
  const verification = backup?.verification ?? null;
  return (
    <Card
      title="Last backup"
      icon={<HardDriveDownload className="w-4 h-4" />}
      badge={
        !backup ? (
          <Badge tone="warning" icon={<AlertTriangle className="w-3 h-3" />}>
            None
          </Badge>
        ) : verification?.ok ? (
          <Badge tone="success" icon={<Check className="w-3 h-3" />}>
            Verified
          </Badge>
        ) : verification ? (
          <Badge tone="danger" icon={<AlertTriangle className="w-3 h-3" />}>
            Failed
          </Badge>
        ) : (
          <Badge>Not checked</Badge>
        )
      }
    >
      {backup ? (
        <>
          <Row label="Taken">
            <span title={formatWhen(backup.createdAt)}>
              {formatRelative(backup.createdAt, "Unknown")}
            </span>
          </Row>
          <Row label="Size">{formatBytes(backup.sizeBytes)}</Row>
          <Row label="Checked">
            {verification
              ? formatRelative(verification.checkedAt, "Unknown")
              : "Never"}
          </Row>
          {verification?.problem && (
            <p className="text-xs text-error text-pretty pt-1">
              {verification.problem}
            </p>
          )}
        </>
      ) : (
        <p className="text-xs text-on-surface-variant text-pretty">
          No snapshot has been taken. Check that scheduled backups are switched
          on, or take one from the Backups page.
        </p>
      )}
    </Card>
  );
};

const QueuesCard = ({ health }: { health: InstanceHealth }) => {
  const { dedupe, aiSearch } = health.queues;
  return (
    <Card title="Queues" icon={<Copy className="w-4 h-4" />}>
      <Row label="Dedupe scan" tone={dedupe.running ? "warning" : "normal"}>
        {account(dedupe.running)}
      </Row>
      <Row label="Waiting behind it">
        {dedupe.pending.length > 0
          ? dedupe.pending.map((who) => who.username).join(", ")
          : "Nobody"}
      </Row>
      <Row label="Enrichment" tone={aiSearch.running ? "warning" : "normal"}>
        {account(aiSearch.running)}
      </Row>
      <Row label="Contacts left">{aiSearch.contactsRemaining}</Row>
    </Card>
  );
};

const EmbeddingsCard = ({ health }: { health: InstanceHealth }) => {
  const { byUser } = health.embeddings;
  const behind = byUser.filter((row) => row.embedded < row.contacts);
  return (
    <Card
      title="Search index"
      icon={<Search className="w-4 h-4" />}
      badge={
        behind.length > 0 ? (
          <Badge tone="warning">{behind.length} behind</Badge>
        ) : (
          <Badge tone="success" icon={<Check className="w-3 h-3" />}>
            Complete
          </Badge>
        )
      }
    >
      {byUser.length === 0 && (
        <p className="text-xs text-on-surface-variant">
          No account owns a contact yet.
        </p>
      )}
      {byUser.map((row) => (
        <Row
          key={row.user.id}
          label={row.user.username}
          tone={row.embedded < row.contacts ? "warning" : "normal"}
        >
          {row.embedded.toLocaleString()} of {row.contacts.toLocaleString()}
        </Row>
      ))}
    </Card>
  );
};

const ProviderCard = ({ health }: { health: InstanceHealth }) => {
  const { provider } = health;
  const { grounding } = provider;
  return (
    <Card
      title="AI provider"
      icon={<Sparkles className="w-4 h-4" />}
      badge={
        provider.circuitBreakers.length > 0 ? (
          <Badge tone="danger" icon={<AlertTriangle className="w-3 h-3" />}>
            {provider.circuitBreakers.length} paused
          </Badge>
        ) : undefined
      }
    >
      <Row label="Tier">{provider.aiTier}</Row>
      <Row label="Grounding today">
        {grounding.rpd} of {grounding.limit}
      </Row>
      <Row
        label="Models paused"
        tone={provider.circuitBreakers.length > 0 ? "error" : "normal"}
      >
        {provider.circuitBreakers.length > 0
          ? provider.circuitBreakers.join(", ")
          : "None"}
      </Row>
    </Card>
  );
};

const CacheCard = ({ health }: { health: InstanceHealth }) => {
  const tiers = Object.entries(health.aiCache).filter(
    ([, stats]) => stats.hits + stats.misses > 0,
  );
  return (
    <Card title="AI cache" icon={<Activity className="w-4 h-4" />}>
      {tiers.length === 0 && (
        <p className="text-xs text-on-surface-variant">
          Nothing has been cached since this process started.
        </p>
      )}
      {tiers.map(([tier, stats]) => (
        <Row key={tier} label={tier}>
          {Math.round(stats.hitRate * 100)}% of {stats.hits + stats.misses}
        </Row>
      ))}
    </Card>
  );
};

// ---------------------------------------------------------------------------

export const HealthView = () => {
  const { data: health, isLoading, isError, refetch } = useInstanceHealth();

  return (
    <AdminPage lead="Everything this instance can tell you about itself. Nothing here is written and nothing here is secret, so it is safe to leave open. It refreshes every fifteen seconds.">
      {isLoading && (
        <p className="text-sm text-on-surface-variant">Reading the instance…</p>
      )}

      {isError && (
        <div className="bg-surface-container-lowest rounded-2xl shadow-sm p-5 space-y-3">
          <p className="text-sm text-error">
            The instance could not be read. That is itself worth knowing.
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="text-sm font-bold text-primary min-h-[44px]"
          >
            Try again
          </button>
        </div>
      )}

      {health && (
        <>
          <div className="flex items-center gap-2 text-xs text-on-surface-variant">
            <Clock className="w-3.5 h-3.5" />
            Started {formatRelative(health.startedAt, "unknown")}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <SchemaCard health={health} />
            <DatabaseCard health={health} />
            <BackupCard health={health} />
            <QueuesCard health={health} />
            <EmbeddingsCard health={health} />
            <ProviderCard health={health} />
            <CacheCard health={health} />
          </div>
        </>
      )}
    </AdminPage>
  );
};
