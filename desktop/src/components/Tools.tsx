/**
 * Tools & connectors view — read-only inventory of what the agent can call.
 * Two sections:
 *   1. Built-in tools that ship with the Claude Agent SDK harness.
 *   2. External MCP connectors the user has wired up.
 *
 * Approval-mode mapping is informational: it shows which tools require
 * the user's nod under the default "writes_only" policy.
 */
import type { AppSettings } from "../lib/store";

interface ToolDef {
  name: string;
  category: "read" | "write" | "shell" | "search" | "net" | "agent";
  blurb: string;
  /** Whether this tool changes state on the host (Bash/Write/etc.). */
  writes: boolean;
}

const BUILTIN_TOOLS: ToolDef[] = [
  { name: "Read",        category: "read",   blurb: "Read a file from the workspace.",                  writes: false },
  { name: "Write",       category: "write",  blurb: "Create or overwrite a file.",                       writes: true  },
  { name: "Edit",        category: "write",  blurb: "Replace a string in an existing file.",             writes: true  },
  { name: "MultiEdit",   category: "write",  blurb: "Apply multiple edits to a single file atomically.", writes: true  },
  { name: "NotebookEdit",category: "write",  blurb: "Modify cells in a Jupyter notebook.",               writes: true  },
  { name: "Glob",        category: "search", blurb: "Find files by pattern (e.g. `**/*.ts`).",           writes: false },
  { name: "Grep",        category: "search", blurb: "Search file contents (ripgrep-powered).",           writes: false },
  { name: "Bash",        category: "shell",  blurb: "Run a shell command.",                              writes: true  },
  { name: "WebFetch",    category: "net",    blurb: "Download a URL and return its content.",            writes: false },
  { name: "Task",        category: "agent",  blurb: "Spawn a subagent for a self-contained task.",       writes: false },
];

interface Props {
  settings: AppSettings;
}

export function Tools({ settings }: Props) {
  const sandboxOn = settings.sandboxEnabled;
  const filesystemOn = settings.mcpFilesystemEnabled;
  const wsPath = sandboxOn ? "/workspace" : settings.workspaceDir || "—";

  return (
    <div className="tools-pane">
      <header className="tools-header">
        <h1 className="tools-title">Tools & connectors</h1>
        <div className="tools-subtitle">
          {BUILTIN_TOOLS.length} built-in tools
          {filesystemOn && wsPath !== "—" ? " · 1 MCP server connected" : ""}
        </div>
      </header>

      <h2>Built-in</h2>
      <div className="tools-grid">
        {BUILTIN_TOOLS.map((t) => (
          <div key={t.name} className="tool-card">
            <div className="tool-row">
              <span className={`tool-cat tool-cat-${t.category}`}>{t.category}</span>
              <span className="tool-card-name">{t.name}</span>
              {t.writes && (
                <span className="tool-badge tool-badge-warn" title="Requires approval in default mode">
                  approval
                </span>
              )}
            </div>
            <div className="tool-card-blurb">{t.blurb}</div>
          </div>
        ))}
      </div>

      <h2>MCP connectors</h2>
      {filesystemOn ? (
        <div className="tools-grid">
          <div className="tool-card">
            <div className="tool-row">
              <span className="tool-cat tool-cat-mcp">mcp</span>
              <span className="tool-card-name">filesystem</span>
              <span className="tool-badge tool-badge-ok">connected</span>
            </div>
            <div className="tool-card-blurb">
              <code>@modelcontextprotocol/server-filesystem</code> scoped to{" "}
              <code>{wsPath}</code>. Exposes list/read/write/search file tools
              prefixed with <code>mcp__filesystem__</code>.
            </div>
          </div>
        </div>
      ) : (
        <div className="tools-empty">
          Filesystem MCP server is disabled. Re-enable in Settings → Workspace.
        </div>
      )}

      <h2>Safety summary</h2>
      <table className="stats-table">
        <tbody>
          <tr>
            <td>Approval mode</td>
            <td style={{ textAlign: "right" }}>
              <strong>{labelForMode(settings.approvalMode)}</strong>
            </td>
          </tr>
          <tr>
            <td>Sandbox</td>
            <td style={{ textAlign: "right" }}>
              <strong>{sandboxOn ? "On — Apple Container (lightweight Linux VM), workspace bind-mounted, --cap-drop=ALL" : "Off — host filesystem (path-restricted)"}</strong>
            </td>
          </tr>
          <tr>
            <td>Workspace path</td>
            <td style={{ textAlign: "right", fontFamily: "var(--mono)", fontSize: 12 }}>
              {settings.workspaceDir || "(not set)"}
            </td>
          </tr>
        </tbody>
      </table>

      <div className="tools-foot">
        Tools marked "approval" require your explicit nod before running under the
        default <code>writes_only</code> mode. Switch the mode in Settings → Safety.
      </div>
    </div>
  );
}

function labelForMode(m: AppSettings["approvalMode"]): string {
  switch (m) {
    case "always": return "Always ask";
    case "auto":   return "Auto-approve everything";
    case "writes_only": return "Ask for writes only";
  }
}
