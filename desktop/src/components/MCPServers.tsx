/**
 * MCPs tab — user-defined external MCP servers.
 *
 * List view on the left, inline editor on the right (or below on narrow
 * widths). Add, edit, enable/disable, delete. Two transports: stdio (spawn
 * a command) and http (open an HTTP/SSE connection).
 */
import { useEffect, useState } from "react";
import {
  deleteMcp,
  listMcps,
  newHttpServer,
  newStdioServer,
  saveMcp,
  validateName,
  type McpHttpServer,
  type McpServer,
  type McpStdioServer,
} from "../lib/mcps";

interface Props {
  onChanged: () => void;
}

export function MCPServers({ onChanged }: Props) {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [editing, setEditing] = useState<McpServer | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const list = await listMcps();
    setServers(list);
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleSave(s: McpServer) {
    await saveMcp(s);
    await refresh();
    onChanged();
    setEditing(null);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this MCP server?")) return;
    await deleteMcp(id);
    await refresh();
    onChanged();
    if (editing?.id === id) setEditing(null);
  }

  async function handleToggle(s: McpServer) {
    await saveMcp({ ...s, enabled: !s.enabled });
    await refresh();
    onChanged();
  }

  if (loading) {
    return <div className="mcps-pane"><div className="stats-loading">Loading…</div></div>;
  }

  return (
    <div className="mcps-pane">
      <header className="tools-header">
        <h1 className="tools-title">MCP servers</h1>
        <div className="tools-subtitle">
          {servers.length === 0
            ? "No user servers yet. The built-in filesystem MCP is configured in Settings."
            : `${servers.length} configured · ${servers.filter((s) => s.enabled).length} enabled`}
        </div>
      </header>

      <div className="mcps-actions">
        <button onClick={() => setEditing(newStdioServer())}>+ Add stdio server</button>
        <button onClick={() => setEditing(newHttpServer())}>+ Add HTTP server</button>
      </div>

      {servers.length > 0 && (
        <div className="mcps-list">
          {servers.map((s) => (
            <div
              key={s.id}
              className={`mcp-row${editing?.id === s.id ? " active" : ""}`}
            >
              <input
                type="checkbox"
                className="check-input mcp-toggle"
                checked={s.enabled}
                onChange={() => void handleToggle(s)}
                title={s.enabled ? "Enabled" : "Disabled"}
                onClick={(e) => e.stopPropagation()}
              />
              <div
                className="mcp-row-body"
                onClick={() => setEditing(s)}
              >
                <div className="mcp-row-name">{s.name || <em>(unnamed)</em>}</div>
                <div className="mcp-row-meta">
                  <span className={`tool-cat tool-cat-${s.transport === "stdio" ? "shell" : "net"}`}>
                    {s.transport}
                  </span>
                  <span className="mcp-row-detail">
                    {s.transport === "stdio"
                      ? `${s.command}${s.args.length ? " " + s.args.join(" ") : ""}`
                      : s.url}
                  </span>
                </div>
              </div>
              <button
                className="mcp-row-del"
                title="Delete"
                onClick={(e) => {
                  e.stopPropagation();
                  void handleDelete(s.id);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <McpEditor
          key={editing.id}
          server={editing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      )}

      <div className="tools-foot">
        User servers run under the same sandbox as the agent. Stdio commands
        that need to download packages (e.g. <code>npx …</code>) will hit
        the network from inside the container.
      </div>
    </div>
  );
}

function McpEditor({
  server,
  onSave,
  onCancel,
}: {
  server: McpServer;
  onSave: (s: McpServer) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<McpServer>(server);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof McpServer>(k: K, v: McpServer[K]) {
    setDraft((d) => ({ ...d, [k]: v } as McpServer));
  }

  async function handleSubmit() {
    const nameErr = validateName(draft.name);
    if (nameErr) {
      setError(nameErr);
      return;
    }
    if (draft.transport === "stdio" && !draft.command.trim()) {
      setError("Command is required.");
      return;
    }
    if (draft.transport === "http" && !draft.url.trim()) {
      setError("URL is required.");
      return;
    }
    setError(null);
    await onSave(draft);
  }

  return (
    <div className="mcp-editor">
      <div className="mcp-editor-head">
        <h2 style={{ margin: 0 }}>{server.name ? `Edit ${server.name}` : "New MCP server"}</h2>
        <span className={`tool-cat tool-cat-${draft.transport === "stdio" ? "shell" : "net"}`}>
          {draft.transport}
        </span>
      </div>

      <div className="form-row">
        <label>Name</label>
        <input
          value={draft.name}
          placeholder="github, notion, my-server"
          onChange={(e) => set("name", e.target.value)}
        />
        <div className="form-hint">
          Becomes the connector key: tools appear as <code>mcp__{draft.name || "name"}__…</code>.
        </div>
      </div>

      {draft.transport === "stdio" ? (
        <StdioFields draft={draft as McpStdioServer} setDraft={setDraft} />
      ) : (
        <HttpFields draft={draft as McpHttpServer} setDraft={setDraft} />
      )}

      {error && <div className="mcp-error">{error}</div>}

      <div className="settings-actions">
        <button className="btn-primary" onClick={() => void handleSubmit()}>
          Save
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function StdioFields({
  draft,
  setDraft,
}: {
  draft: McpStdioServer;
  setDraft: React.Dispatch<React.SetStateAction<McpServer>>;
}) {
  function update(patch: Partial<McpStdioServer>): void {
    setDraft((d) => ({ ...d, ...patch }) as McpStdioServer);
  }
  return (
    <>
      <div className="form-row">
        <label>Command</label>
        <input
          value={draft.command}
          placeholder="npx"
          onChange={(e) => update({ command: e.target.value })}
        />
      </div>
      <div className="form-row">
        <label>Arguments (one per line)</label>
        <textarea
          rows={3}
          value={draft.args.join("\n")}
          placeholder={"-y\n@modelcontextprotocol/server-github"}
          onChange={(e) =>
            update({
              args: e.target.value
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        />
      </div>
      <KVEditor
        label="Environment variables"
        entries={draft.env}
        secretKeys={draft.secretEnvKeys}
        placeholderK="GITHUB_TOKEN"
        placeholderV="ghp_…"
        onChange={(env, secretEnvKeys) => update({ env, secretEnvKeys })}
      />
    </>
  );
}

function HttpFields({
  draft,
  setDraft,
}: {
  draft: McpHttpServer;
  setDraft: React.Dispatch<React.SetStateAction<McpServer>>;
}) {
  function update(patch: Partial<McpHttpServer>): void {
    setDraft((d) => ({ ...d, ...patch }) as McpHttpServer);
  }
  return (
    <>
      <div className="form-row">
        <label>URL</label>
        <input
          value={draft.url}
          placeholder="https://mcp.example.com/sse"
          onChange={(e) => update({ url: e.target.value })}
        />
      </div>
      <KVEditor
        label="Headers"
        entries={draft.headers}
        secretKeys={draft.secretHeaderKeys}
        placeholderK="Authorization"
        placeholderV="Bearer …"
        onChange={(headers, secretHeaderKeys) =>
          update({ headers, secretHeaderKeys })
        }
      />
    </>
  );
}

/**
 * Small key/value editor used for env vars + headers. A row per pair,
 * plus an "add" button. Each row has a "secret" checkbox that flips the
 * value input between text and password.
 */
function KVEditor({
  label,
  entries,
  secretKeys,
  placeholderK,
  placeholderV,
  onChange,
}: {
  label: string;
  entries: Record<string, string>;
  secretKeys: string[];
  placeholderK: string;
  placeholderV: string;
  onChange: (entries: Record<string, string>, secretKeys: string[]) => void;
}) {
  // Local editable copy — keys + values as arrays so we can rename keys
  // without corrupting the map mid-edit.
  const initial = Object.entries(entries).map(([k, v]) => ({
    k,
    v,
    secret: secretKeys.includes(k),
  }));
  const [rows, setRows] = useState<{ k: string; v: string; secret: boolean }[]>(
    initial,
  );

  function commit(next: typeof rows) {
    setRows(next);
    const map: Record<string, string> = {};
    const secrets: string[] = [];
    for (const r of next) {
      const k = r.k.trim();
      if (!k) continue;
      map[k] = r.v;
      if (r.secret) secrets.push(k);
    }
    onChange(map, secrets);
  }

  return (
    <div className="form-row">
      <label>{label}</label>
      <div className="kv-list">
        {rows.map((row, i) => (
          <div key={i} className="kv-row">
            <input
              className="kv-k"
              value={row.k}
              placeholder={placeholderK}
              onChange={(e) => {
                const next = [...rows];
                next[i] = { ...row, k: e.target.value };
                commit(next);
              }}
            />
            <input
              className="kv-v"
              type={row.secret ? "password" : "text"}
              autoComplete="off"
              spellCheck={false}
              value={row.v}
              placeholder={placeholderV}
              onChange={(e) => {
                const next = [...rows];
                next[i] = { ...row, v: e.target.value };
                commit(next);
              }}
            />
            <label className="kv-secret" title="Mask value">
              <input
                type="checkbox"
                checked={row.secret}
                onChange={(e) => {
                  const next = [...rows];
                  next[i] = { ...row, secret: e.target.checked };
                  commit(next);
                }}
              />
              secret
            </label>
            <button
              className="kv-del"
              onClick={() => {
                const next = rows.filter((_, j) => j !== i);
                commit(next);
              }}
            >
              ×
            </button>
          </div>
        ))}
        <button
          className="kv-add"
          onClick={() =>
            commit([...rows, { k: "", v: "", secret: false }])
          }
        >
          + Add
        </button>
      </div>
    </div>
  );
}
