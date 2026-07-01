/**
 * User-defined MCP servers.
 *
 * We store each server as its own object in a Tauri store so add/edit/delete
 * are cheap. On the wire (to the Claude Agent SDK) we render enabled entries
 * into the RunSpec.mcpServers map keyed by `name`.
 *
 * Two transports are supported:
 *   - stdio: the SDK spawns `command args...` with `env` and talks over
 *     stdio (the standard MCP transport).
 *   - http:  the SDK opens an HTTP/SSE connection to `url` with `headers`.
 *
 * OAuth flows are intentionally out of scope; users must paste tokens
 * directly. Entries marked as secret are masked in the UI but stored
 * plaintext in the local store — the same trust model as the Baseten key.
 */
import { LazyStore } from "@tauri-apps/plugin-store";

export type McpTransport = "stdio" | "http";

interface McpServerBase {
  id: string;
  /** Display name and the key used in the SDK's mcpServers map. */
  name: string;
  enabled: boolean;
  createdAt: number;
  transport: McpTransport;
}

export interface McpStdioServer extends McpServerBase {
  transport: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
  /** Which env keys should be masked in the UI. */
  secretEnvKeys: string[];
}

export interface McpHttpServer extends McpServerBase {
  transport: "http";
  url: string;
  headers: Record<string, string>;
  secretHeaderKeys: string[];
}

export type McpServer = McpStdioServer | McpHttpServer;

const STORE_PATH = "mcps.json";
const INDEX_KEY = "mcps";

let store: LazyStore | null = null;
function getStore(): LazyStore {
  if (!store) store = new LazyStore(STORE_PATH);
  return store;
}

export async function listMcps(): Promise<McpServer[]> {
  const s = getStore();
  const raw = (await s.get(INDEX_KEY)) as McpServer[] | undefined;
  const list = raw ?? [];
  // Newest first — matches how the user just added it.
  return [...list].sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveMcp(server: McpServer): Promise<void> {
  const s = getStore();
  const list = ((await s.get(INDEX_KEY)) as McpServer[] | undefined) ?? [];
  const without = list.filter((m) => m.id !== server.id);
  await s.set(INDEX_KEY, [...without, server]);
  await s.save();
}

export async function deleteMcp(id: string): Promise<void> {
  const s = getStore();
  const list = ((await s.get(INDEX_KEY)) as McpServer[] | undefined) ?? [];
  await s.set(
    INDEX_KEY,
    list.filter((m) => m.id !== id),
  );
  await s.save();
}

export function newStdioServer(): McpStdioServer {
  return {
    id: crypto.randomUUID(),
    name: "",
    enabled: true,
    createdAt: Date.now(),
    transport: "stdio",
    command: "npx",
    args: [],
    env: {},
    secretEnvKeys: [],
  };
}

export function newHttpServer(): McpHttpServer {
  return {
    id: crypto.randomUUID(),
    name: "",
    enabled: true,
    createdAt: Date.now(),
    transport: "http",
    url: "",
    headers: {},
    secretHeaderKeys: [],
  };
}

/**
 * Render enabled servers into the SDK-shaped map that RunSpec.mcpServers
 * expects. Reserved names (`filesystem`) shouldn't be picked by the user
 * but if they are, the built-in gets last-write-wins because we spread
 * the user map first.
 */
export function toRunSpecMcpServers(
  servers: McpServer[],
): Record<string, StdioWire | HttpWire> {
  const out: Record<string, StdioWire | HttpWire> = {};
  for (const s of servers) {
    if (!s.enabled) continue;
    const name = s.name.trim();
    if (!name) continue;
    if (s.transport === "stdio") {
      out[name] = {
        command: s.command,
        args: s.args,
        env: Object.keys(s.env).length ? s.env : undefined,
      };
    } else {
      out[name] = {
        type: "http",
        url: s.url,
        headers: Object.keys(s.headers).length ? s.headers : undefined,
      };
    }
  }
  return out;
}

export type StdioWire = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
};
export type HttpWire = {
  type: "http";
  url: string;
  headers?: Record<string, string>;
};

/** Basic name validation — must be non-empty and safe as a map key. */
export function validateName(name: string): string | null {
  const n = name.trim();
  if (!n) return "Name is required.";
  if (!/^[a-zA-Z0-9_-]+$/.test(n))
    return "Only letters, numbers, dashes, underscores.";
  if (n === "filesystem") return "'filesystem' is reserved for the built-in server.";
  return null;
}
