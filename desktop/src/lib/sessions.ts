/**
 * Chat session persistence.
 *
 * Sessions are stored in `sessions.json` via tauri-plugin-store. Layout:
 *   { "index": [ { id, title, createdAt, updatedAt }, ... ],
 *     "session:<id>": ChatSession }
 *
 * We keep an index separately so we can list summaries without loading every
 * session body.
 */
import { LazyStore } from "@tauri-apps/plugin-store";
import type { ChatTurn } from "../components/Chat";

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChatSession extends SessionSummary {
  turns: ChatTurn[];
}

const STORE_PATH = "sessions.json";
const INDEX_KEY = "index";
const sessionKey = (id: string) => `session:${id}`;

let store: LazyStore | null = null;
function getStore(): LazyStore {
  if (!store) store = new LazyStore(STORE_PATH);
  return store;
}

export async function listSessions(): Promise<SessionSummary[]> {
  const s = getStore();
  const idx = ((await s.get(INDEX_KEY)) as SessionSummary[]) ?? [];
  // Newest first.
  return [...idx].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadSession(id: string): Promise<ChatSession | null> {
  const s = getStore();
  const raw = await s.get(sessionKey(id));
  return raw ? (raw as ChatSession) : null;
}

export async function saveSession(sess: ChatSession): Promise<void> {
  const s = getStore();
  await s.set(sessionKey(sess.id), sess);

  const idx = ((await s.get(INDEX_KEY)) as SessionSummary[]) ?? [];
  const summary: SessionSummary = {
    id: sess.id,
    title: sess.title,
    createdAt: sess.createdAt,
    updatedAt: sess.updatedAt,
  };
  const without = idx.filter((e) => e.id !== sess.id);
  await s.set(INDEX_KEY, [...without, summary]);
  await s.save();
}

export async function deleteSession(id: string): Promise<void> {
  const s = getStore();
  await s.delete(sessionKey(id));
  const idx = ((await s.get(INDEX_KEY)) as SessionSummary[]) ?? [];
  await s.set(
    INDEX_KEY,
    idx.filter((e) => e.id !== id),
  );
  await s.save();
}

export function newSession(): ChatSession {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: "New chat",
    createdAt: now,
    updatedAt: now,
    turns: [],
  };
}

export function deriveTitle(turns: ChatTurn[]): string {
  const first = turns[0]?.userGoal?.trim();
  if (!first) return "New chat";
  if (first.length <= 48) return first;
  return first.slice(0, 45) + "…";
}
