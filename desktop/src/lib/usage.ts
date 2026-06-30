/**
 * Persistent usage log — survives session deletion. Stats are derived from
 * here, not from individual sessions, so the lifetime cost view is stable
 * even if the user wipes their chat history.
 */
import { LazyStore } from "@tauri-apps/plugin-store";

export interface UsageEvent {
  /** ms epoch when the turn finished */
  ts: number;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  durationMs: number;
  toolCalls: number;
  toolErrors: number;
  /** Optional session id for cross-reference */
  sessionId?: string;
}

const STORE_PATH = "usage.json";
const EVENTS_KEY = "events";

let store: LazyStore | null = null;
function getStore(): LazyStore {
  if (!store) store = new LazyStore(STORE_PATH);
  return store;
}

export async function appendUsage(ev: UsageEvent): Promise<void> {
  const s = getStore();
  const cur = ((await s.get(EVENTS_KEY)) as UsageEvent[]) ?? [];
  cur.push(ev);
  await s.set(EVENTS_KEY, cur);
  await s.save();
}

export async function loadUsage(): Promise<UsageEvent[]> {
  const s = getStore();
  const events = ((await s.get(EVENTS_KEY)) as UsageEvent[]) ?? [];
  return events.slice().sort((a, b) => a.ts - b.ts);
}

export async function clearUsage(): Promise<void> {
  const s = getStore();
  await s.set(EVENTS_KEY, []);
  await s.save();
}

export type Timeframe = "day" | "week" | "month" | "all";

export function filterByTimeframe(
  events: UsageEvent[],
  tf: Timeframe,
  now = Date.now(),
): UsageEvent[] {
  if (tf === "all") return events;
  const ms = {
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
  }[tf];
  const cutoff = now - ms;
  return events.filter((e) => e.ts >= cutoff);
}
