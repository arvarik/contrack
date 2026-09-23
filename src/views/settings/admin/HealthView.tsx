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
  Loader2,
  Search,
  Sparkles,
} from "lucide-react";
import { Children, type ReactNode } from "react";
import {
  useInstanceHealth,
  type HealthAccount,
  type InstanceHealth,
} from "../../../api/admin";
import { Badge } from "../../../components/ui/Badge";
import { EmptyState } from "../../../components/ui/EmptyState";
import { formatBytes, formatRelative, formatWhen } from "../../../lib/datetime";
import { CARD, TONE_WASH } from "../../../lib/styles";
import { cn } from "../../../lib/utils";
import { AdminPage } from "./AdminShell";

// ---------------------------------------------------------------------------
// The card, and the one row inside it
// ---------------------------------------------------------------------------

/**
 * A card with a list of rows and an optional line of text under them.
 *
 * `children` is rows and nothing else, because it goes inside the `dl`. A
 * `dl` may hold only `dt` and `dd` pairs, bare or wrapped in a `div`, and a
 * `p` in there made axe report the list as broken to a screen reader. Text
 * that is not a row, such as an empty state or a problem, goes in `note`,
 * which renders after the list. A card with no rows renders no list.
 */
const Card = ({
  title,
  icon,
  badge,
  note,
  children,
}: {
  title: string;
  icon: ReactNode;
  badge?: ReactNode;
  note?: ReactNode;
  children?: ReactNode;
}) => (
  <section className={cn(CARD, "p-4 sm:p-5 space-y-3")}>
    <header className="flex items-center gap-2.5">
      <span
        className={cn(
          "shrink-0 w-8 h-8 rounded-xl flex items-center justify-center",
          TONE_WASH.primary,
        )}
      >
        {icon}
      </span>
      <h2 className="text-sm font-bold text-on-surface flex-1 min-w-0 break-words">
        {title}
      </h2>
      {badge && <span className="shrink-0">{badge}</span>}
    </header>
    {Children.toArray(children).length > 0 && (
      <dl className="space-y-2">{children}</dl>
    )}
    {note}
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

/** The AI cache's tiers, in words. A tier added later reads from its key. */
const CACHE_TIER_NAMES: Record<string, string> = {
  rerank: "Reranking results",
  dailyInsight: "Daily insight",
  queryParse: "Reading a question",
};

/** "dailyInsight" as "Daily insight", "FREE" as "Free". */
/**
 * The provider's tier, as the server names it. "N/A" is the answer with no
 * provider, and `words` would have made it "N/a".
 */
const AI_TIER_NAMES: Record<string, string> = {
  FREE: "Free",
  PAID: "Paid",
  "N/A": "No provider",
};

function words(key: string): string {
  const spaced = key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

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
      note={
        !backup ? (
          <p className="text-xs text-on-surface-variant text-pretty">
            No snapshot has been taken. Check that scheduled backups are
            switched on, or take one from the Backups page.
          </p>
        ) : verification?.problem ? (
          <p className="text-xs text-error text-pretty">
            {verification.problem}
          </p>
        ) : undefined
      }
    >
      {backup && (
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
        </>
      )}
    </Card>
  );
};

const QueuesCard = ({ health }: { health: InstanceHealth }) => {
  const { dedupe, aiSearch } = health.queues;
  return (
    <Card title="Queues" icon={<Copy className="w-4 h-4" />}>
      <Row label="Duplicate scan" tone={dedupe.running ? "warning" : "normal"}>
        {account(dedupe.running)}
      </Row>
      <Row label="Waiting for it">
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
      note={
        byUser.length === 0 ? (
          <p className="text-xs text-on-surface-variant">
            No account owns a contact yet.
          </p>
        ) : undefined
      }
    >
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
      <Row label="Tier">
        {AI_TIER_NAMES[provider.aiTier] ?? provider.aiTier}
      </Row>
      <Row label="Web searches today">
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
    <Card
      title="AI cache"
      icon={<Activity className="w-4 h-4" />}
      note={
        tiers.length === 0 ? (
          <p className="text-xs text-on-surface-variant">
            Nothing has been cached since this process started.
          </p>
        ) : undefined
      }
    >
      {tiers.map(([tier, stats]) => (
        <Row key={tier} label={CACHE_TIER_NAMES[tier] ?? words(tier)}>
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
    <AdminPage>
      {isLoading && (
        <p className="flex items-center gap-2 text-sm text-on-surface-variant">
          <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" />
          Reading the instance…
        </p>
      )}

      {isError && (
        <EmptyState
          icon={AlertTriangle}
          tone="error"
          title="The instance could not be read"
          body="That is itself worth knowing. Nothing here has changed."
          action={{ label: "Try again", onClick: () => void refetch() }}
        />
      )}

      {health && (
        <>
          <p className="flex items-center gap-2 text-xs text-on-surface-variant">
            <Clock aria-hidden="true" className="w-3.5 h-3.5" />
            Started {formatRelative(health.startedAt, "unknown")}. Nothing here
            is secret, so the page is safe to leave open.
          </p>
          {/* Two columns in the settings box: three left a card too narrow
              for its title beside its badge. */}
          <div className="grid gap-4 sm:grid-cols-2">
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
