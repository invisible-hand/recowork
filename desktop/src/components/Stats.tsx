import { useEffect, useState } from "react";
import { listSessions, loadSession, type SessionSummary } from "../lib/sessions";
import {
  computeCost,
  formatDuration,
  formatTokens,
  formatUsd,
  type Usage,
} from "../lib/pricing";
import type { ChatTurn } from "./Chat";

interface Agg {
  sessions: number;
  totalTurns: number;
  totalToolCalls: number;
  totalToolErrors: number;
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
    sessions: 0,
    totalTurns: 0,
    totalToolCalls: 0,
    totalToolErrors: 0,
    totalInput: 0,
    totalOutput: 0,
    totalCacheRead: 0,
    totalCacheCreate: 0,
    totalDurationMs: 0,
    totalCostUsd: 0,
    perModel: {},
  };
}

function aggregateTurn(agg: Agg, t: ChatTurn): void {
  agg.totalTurns += 1;
  const u: Usage = t.usage ?? {};
  agg.totalInput += u.input_tokens ?? 0;
  agg.totalOutput += u.output_tokens ?? 0;
  agg.totalCacheRead += u.cache_read_input_tokens ?? 0;
  agg.totalCacheCreate += u.cache_creation_input_tokens ?? 0;
  agg.totalDurationMs += t.durationMs ?? 0;
  for (const b of t.blocks) {
    if (b.kind === "tool_use") agg.totalToolCalls += 1;
    if (b.kind === "result") agg.totalToolErrors += b.toolErrors;
  }
  const model = t.model ?? "zai-org/GLM-5.2";
  agg.totalCostUsd += computeCost(model, u);
  if (!agg.perModel[model]) agg.perModel[model] = emptyAgg();
  const per = agg.perModel[model];
  per.totalTurns += 1;
  per.totalInput += u.input_tokens ?? 0;
  per.totalOutput += u.output_tokens ?? 0;
  per.totalCacheRead += u.cache_read_input_tokens ?? 0;
  per.totalCacheCreate += u.cache_creation_input_tokens ?? 0;
  per.totalDurationMs += t.durationMs ?? 0;
  per.totalCostUsd += computeCost(model, u);
}

export function Stats() {
  const [agg, setAgg] = useState<Agg | null>(null);
  const [summaries, setSummaries] = useState<SessionSummary[]>([]);

  useEffect(() => {
    void (async () => {
      const sums = await listSessions();
      const a = emptyAgg();
      a.sessions = sums.length;
      for (const s of sums) {
        if (a.firstAt === undefined || s.createdAt < a.firstAt) a.firstAt = s.createdAt;
        if (a.lastAt === undefined || s.updatedAt > a.lastAt) a.lastAt = s.updatedAt;
        const sess = await loadSession(s.id);
        if (!sess) continue;
        for (const t of sess.turns) aggregateTurn(a, t);
      }
      setAgg(a);
      setSummaries(sums);
    })();
  }, []);

  if (!agg) {
    return <div className="stats-pane"><div className="stats-loading">Loading…</div></div>;
  }

  const cachedShare =
    agg.totalInput > 0
      ? Math.round(((agg.totalCacheRead) / agg.totalInput) * 100)
      : 0;
  const successRate =
    agg.totalToolCalls > 0
      ? Math.round(((agg.totalToolCalls - agg.totalToolErrors) / agg.totalToolCalls) * 100)
      : 100;

  return (
    <div className="stats-pane">
      <h1 className="stats-title">Usage</h1>
      <div className="stats-subtitle">
        {agg.sessions} session{agg.sessions === 1 ? "" : "s"}
        {agg.firstAt && agg.lastAt
          ? `, ${new Date(agg.firstAt).toLocaleDateString()} — ${new Date(agg.lastAt).toLocaleDateString()}`
          : ""}
      </div>

      <div className="stats-grid">
        <StatCard label="Estimated spend" value={formatUsd(agg.totalCostUsd)} sub="Baseten GLM-5.2 pricing" highlight />
        <StatCard label="Total tokens"   value={formatTokens(agg.totalInput + agg.totalOutput)} sub={`${formatTokens(agg.totalInput)} in / ${formatTokens(agg.totalOutput)} out`} />
        <StatCard label="Turns"          value={agg.totalTurns.toString()} sub={`across ${agg.sessions} session${agg.sessions === 1 ? "" : "s"}`} />
        <StatCard label="Tool calls"     value={agg.totalToolCalls.toString()} sub={`${successRate}% succeeded`} />
        <StatCard label="Cache hit"      value={`${cachedShare}%`} sub={`${formatTokens(agg.totalCacheRead)} cached read`} />
        <StatCard label="Agent time"     value={formatDuration(agg.totalDurationMs)} sub="across all turns" />
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
              <tr><th>Model</th><th>Turns</th><th>Tokens</th><th>Cost</th></tr>
            </thead>
            <tbody>
              {Object.entries(agg.perModel).map(([m, a]) => (
                <tr key={m}>
                  <td><code>{m}</code></td>
                  <td>{a.totalTurns}</td>
                  <td>{formatTokens(a.totalInput + a.totalOutput)}</td>
                  <td>{formatUsd(a.totalCostUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2>Recent sessions</h2>
      <table className="stats-table">
        <thead>
          <tr><th>Title</th><th>When</th></tr>
        </thead>
        <tbody>
          {summaries.slice(0, 12).map((s) => (
            <tr key={s.id}>
              <td>{s.title}</td>
              <td>{new Date(s.updatedAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="stats-foot">
        Estimates use Baseten's published GLM-5.2 rate ($1.40/M input, $0.26/M cached, $4.40/M output).
        Actual billing on your Baseten dashboard is authoritative.
      </div>
    </div>
  );
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
