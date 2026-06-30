import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  clearUsage,
  filterByTimeframe,
  loadUsage,
  type Timeframe,
  type UsageEvent,
} from "../lib/usage";
import {
  computeCost,
  formatDuration,
  formatTokens,
  formatUsd,
} from "../lib/pricing";

interface ContainerInfo {
  id?: string;
  status?: string;
  configuration?: {
    image?: { reference?: string };
    resources?: { cpus?: number; memoryInBytes?: number };
    runtimeHandler?: string;
  };
  networks?: Array<{ address?: string; hostname?: string }>;
}
interface SandboxStatsT {
  running: boolean;
  containers: ContainerInfo[];
  properties: string;
}

interface Agg {
  events: number;
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheCreate: number;
  totalDurationMs: number;
  totalCostUsd: number;
  firstAt?: number;
  lastAt?: number;
  perModel: Record<string, Agg>;
}

function emptyAgg(): Agg {
  return {
    events: 0,
    totalInput: 0,
    totalOutput: 0,
    totalCacheRead: 0,
    totalCacheCreate: 0,
    totalDurationMs: 0,
    totalCostUsd: 0,
    perModel: {},
  };
}

function aggregate(events: UsageEvent[]): Agg {
  const a = emptyAgg();
  for (const e of events) {
    a.events += 1;
    a.totalInput += e.input_tokens;
    a.totalOutput += e.output_tokens;
    a.totalCacheRead += e.cache_read_input_tokens;
    a.totalCacheCreate += e.cache_creation_input_tokens;
    a.totalDurationMs += e.durationMs;
    a.totalCostUsd += computeCost(e.model, {
      input_tokens: e.input_tokens,
      output_tokens: e.output_tokens,
      cache_read_input_tokens: e.cache_read_input_tokens,
      cache_creation_input_tokens: e.cache_creation_input_tokens,
    });
    if (a.firstAt === undefined || e.ts < a.firstAt) a.firstAt = e.ts;
    if (a.lastAt === undefined || e.ts > a.lastAt) a.lastAt = e.ts;

    if (!a.perModel[e.model]) a.perModel[e.model] = emptyAgg();
    const per = a.perModel[e.model];
    per.events += 1;
    per.totalInput += e.input_tokens;
    per.totalOutput += e.output_tokens;
    per.totalCacheRead += e.cache_read_input_tokens;
    per.totalCacheCreate += e.cache_creation_input_tokens;
    per.totalDurationMs += e.durationMs;
    per.totalCostUsd += computeCost(e.model, {
      input_tokens: e.input_tokens,
      output_tokens: e.output_tokens,
      cache_read_input_tokens: e.cache_read_input_tokens,
      cache_creation_input_tokens: e.cache_creation_input_tokens,
    });
  }
  return a;
}

const TF_OPTIONS: { id: Timeframe; label: string }[] = [
  { id: "day",   label: "1d" },
  { id: "week",  label: "1w" },
  { id: "month", label: "1m" },
  { id: "all",   label: "All" },
];

export function Stats() {
  const [events, setEvents] = useState<UsageEvent[] | null>(null);
  const [tf, setTf] = useState<Timeframe>("all");
  const [sandbox, setSandbox] = useState<SandboxStatsT | null>(null);

  async function refresh() {
    const e = await loadUsage();
    setEvents(e);
    try {
      const s = await invoke<SandboxStatsT>("sandbox_stats");
      setSandbox(s);
    } catch {
      setSandbox(null);
    }
  }

  useEffect(() => {
    void refresh();
    // Refresh sandbox snapshot every 5s while the tab is open.
    const id = setInterval(() => {
      void (async () => {
        try {
          const s = await invoke<SandboxStatsT>("sandbox_stats");
          setSandbox(s);
        } catch {/* ignore */}
      })();
    }, 5000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(
    () => (events ? filterByTimeframe(events, tf) : []),
    [events, tf],
  );
  const agg = useMemo(() => aggregate(filtered), [filtered]);

  async function handleClear() {
    if (!confirm("Wipe all usage history? Sessions and chats are not touched — only the cost/tokens log.")) return;
    await clearUsage();
    await refresh();
  }

  if (events === null) {
    return <div className="stats-pane"><div className="stats-loading">Loading…</div></div>;
  }

  const cachedShare =
    agg.totalInput > 0
      ? Math.round((agg.totalCacheRead / agg.totalInput) * 100)
      : 0;

  return (
    <div className="stats-pane">
      <div className="stats-header">
        <div>
          <h1 className="stats-title">Usage</h1>
          <div className="stats-subtitle">
            {agg.events === 0
              ? "No agent runs yet."
              : `${agg.events} run${agg.events === 1 ? "" : "s"}` +
                (agg.firstAt && agg.lastAt
                  ? ` · ${new Date(agg.firstAt).toLocaleDateString()} – ${new Date(agg.lastAt).toLocaleDateString()}`
                  : "")}
          </div>
        </div>
        <div className="stats-controls">
          <div className="tf-group" role="tablist">
            {TF_OPTIONS.map((o) => (
              <button
                key={o.id}
                className={`tf-pill ${tf === o.id ? "active" : ""}`}
                onClick={() => setTf(o.id)}
              >
                {o.label}
              </button>
            ))}
          </div>
          <button className="btn-deny stats-clear" onClick={() => void handleClear()}>
            Clear
          </button>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard label="Spend" value={formatUsd(agg.totalCostUsd)} sub="Baseten GLM-5.2 pricing" highlight />
        <StatCard label="Tokens" value={formatTokens(agg.totalInput + agg.totalOutput)} sub={`${formatTokens(agg.totalInput)} in / ${formatTokens(agg.totalOutput)} out`} />
        <StatCard label="Runs" value={agg.events.toString()} sub="logged turns" />
        <StatCard label="Cache hit" value={`${cachedShare}%`} sub={`${formatTokens(agg.totalCacheRead)} cached`} />
        <StatCard label="Agent time" value={formatDuration(agg.totalDurationMs)} sub="wall clock" />
      </div>

      <h2>Token breakdown</h2>
      <table className="stats-table">
        <tbody>
          <TokenRow label="Fresh input (full price)" tokens={Math.max(0, agg.totalInput - agg.totalCacheRead)} pricePer1m={1.40} />
          <TokenRow label="Cache write" tokens={agg.totalCacheCreate} pricePer1m={1.40} />
          <TokenRow label="Cache read (discounted)" tokens={agg.totalCacheRead} pricePer1m={0.26} />
          <TokenRow label="Output" tokens={agg.totalOutput} pricePer1m={4.40} />
        </tbody>
      </table>

      {Object.keys(agg.perModel).length > 1 && (
        <>
          <h2>By model</h2>
          <table className="stats-table">
            <thead>
              <tr><th>Model</th><th>Runs</th><th>Tokens</th><th>Cost</th></tr>
            </thead>
            <tbody>
              {Object.entries(agg.perModel).map(([m, a]) => (
                <tr key={m}>
                  <td><code>{m}</code></td>
                  <td>{a.events}</td>
                  <td>{formatTokens(a.totalInput + a.totalOutput)}</td>
                  <td>{formatUsd(a.totalCostUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2>Sandbox</h2>
      {sandbox === null ? (
        <div className="stats-foot">Checking Apple Container…</div>
      ) : !sandbox.running ? (
        <div className="stats-foot">
          Apple Container daemon is not running. Start it with{" "}
          <code>container system start</code>.
        </div>
      ) : (
        <SandboxView sandbox={sandbox} />
      )}

      <div className="stats-foot">
        Estimates use Baseten's published GLM-5.2 rate ($1.40/M input,
        $0.26/M cached read, $4.40/M output). Your Baseten dashboard is the
        source of truth for actual billing. This log is local-only; nothing
        is sent anywhere.
      </div>
    </div>
  );
}

function SandboxView({ sandbox }: { sandbox: SandboxStatsT }) {
  const running = sandbox.containers.filter((c) => c.status === "running");
  const totalCpu = running.reduce(
    (a, c) => a + (c.configuration?.resources?.cpus ?? 0),
    0,
  );
  const totalMem = running.reduce(
    (a, c) => a + (c.configuration?.resources?.memoryInBytes ?? 0),
    0,
  );
  return (
    <>
      <div className="stats-grid">
        <StatCard label="Running containers" value={running.length.toString()} sub="active VMs" />
        <StatCard label="Allocated CPUs" value={totalCpu.toString()} sub="across containers" />
        <StatCard label="Allocated memory" value={formatBytes(totalMem)} sub="VM limits, not live usage" />
      </div>
      {running.length > 0 && (
        <table className="stats-table" style={{ marginTop: 12 }}>
          <thead>
            <tr><th>Container</th><th>Image</th><th>CPUs</th><th>Memory</th><th>IP</th></tr>
          </thead>
          <tbody>
            {running.map((c) => {
              const id = c.id ?? "—";
              const img = c.configuration?.image?.reference ?? "—";
              const cpus = c.configuration?.resources?.cpus ?? 0;
              const mem = c.configuration?.resources?.memoryInBytes ?? 0;
              const ip = c.networks?.[0]?.address ?? "—";
              return (
                <tr key={id}>
                  <td><code>{shortId(id)}</code></td>
                  <td><code>{shortImage(img)}</code></td>
                  <td>{cpus}</td>
                  <td>{formatBytes(mem)}</td>
                  <td><code>{ip}</code></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

function shortId(id: string): string {
  return id.length > 28 ? id.slice(0, 28) + "…" : id;
}
function shortImage(img: string): string {
  if (img.length <= 36) return img;
  return "…" + img.slice(-34);
}
function formatBytes(n: number): string {
  if (!n) return "0";
  const g = n / 1024 ** 3;
  if (g >= 1) return g.toFixed(1) + " GB";
  const m = n / 1024 ** 2;
  return Math.round(m) + " MB";
}

function StatCard({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`stat-card ${highlight ? "highlight" : ""}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function TokenRow({ label, tokens, pricePer1m }: { label: string; tokens: number; pricePer1m: number }) {
  const cost = (tokens / 1_000_000) * pricePer1m;
  return (
    <tr>
      <td>{label}</td>
      <td style={{ textAlign: "right" }}>{formatTokens(tokens)}</td>
      <td style={{ textAlign: "right", color: "var(--fg-dim)" }}>${pricePer1m.toFixed(2)}/M</td>
      <td style={{ textAlign: "right", fontWeight: 600 }}>{formatUsd(cost)}</td>
    </tr>
  );
}
