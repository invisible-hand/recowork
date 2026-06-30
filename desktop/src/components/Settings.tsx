import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { AppSettings } from "../lib/store";

interface Props {
  initial: AppSettings;
  onSave: (s: AppSettings) => void | Promise<void>;
  firstRun: boolean;
}

export function Settings({ initial, onSave, firstRun }: Props) {
  const [s, setS] = useState<AppSettings>(initial);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof AppSettings>(k: K, v: AppSettings[K]) {
    setS((prev) => ({ ...prev, [k]: v }));
  }

  async function pickWorkspace() {
    const sel = await open({ directory: true, multiple: false });
    if (typeof sel === "string") set("workspaceDir", sel);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(s);
    } finally {
      setSaving(false);
    }
  }

  const ready = s.apiKey.trim() !== "" && s.workspaceDir.trim() !== "";

  return (
    <div className="settings-pane">
      {firstRun && (
        <div className="settings-welcome">
          <h1>Welcome to Recowork</h1>
          <p>
            Enter your Baseten API key and pick a workspace directory to begin.
            Everything else has working defaults.
          </p>
        </div>
      )}
      <h2>Inference</h2>
      <div className="form-row">
        <label>Baseten API key</label>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={s.apiKey}
          placeholder="paste your Baseten key"
          onChange={(e) => set("apiKey", e.target.value)}
        />
      </div>
      <div className="form-row">
        <label>Model ID</label>
        <input
          value={s.model}
          onChange={(e) => set("model", e.target.value)}
        />
        <div className="form-hint">
          The model identifier sent to Baseten's inference API. Default is{" "}
          <code>zai-org/GLM-5.2</code> — change only if you've deployed a
          different model on your account.
        </div>
      </div>
      <div className="form-row">
        <label>Max output tokens</label>
        <input
          type="number"
          min={256}
          max={64000}
          value={s.maxOutputTokens}
          onChange={(e) => set("maxOutputTokens", Number(e.target.value))}
        />
      </div>

      <h2>Workspace</h2>
      <div className="form-row">
        <label>Directory</label>
        <div className="form-pickrow">
          <input
            value={s.workspaceDir}
            readOnly
            placeholder="no folder selected"
          />
          <button onClick={() => void pickWorkspace()}>Choose…</button>
        </div>
      </div>
      <label className="check-row">
        <input
          type="checkbox"
          className="check-input"
          checked={s.mcpFilesystemEnabled}
          onChange={(e) => set("mcpFilesystemEnabled", e.target.checked)}
        />
        <span className="check-label">
          <span className="check-title">Filesystem MCP server</span>
          <span className="check-sub">
            Expose <code>@modelcontextprotocol/server-filesystem</code> scoped
            to the workspace.
          </span>
        </span>
      </label>

      <h2>Safety</h2>
      <div className="form-row">
        <label>Approval mode</label>
        <select
          value={s.approvalMode}
          onChange={(e) =>
            set("approvalMode", e.target.value as AppSettings["approvalMode"])
          }
        >
          <option value="always">Always ask before any tool call</option>
          <option value="writes_only">
            Ask only for writes (Bash, Edit, Write, NotebookEdit) — recommended
          </option>
          <option value="auto">
            Auto-approve everything — fastest, least safe
          </option>
        </select>
      </div>
      <label className="check-row">
        <input
          type="checkbox"
          className="check-input"
          checked={s.sandboxEnabled}
          onChange={(e) => set("sandboxEnabled", e.target.checked)}
        />
        <span className="check-label">
          <span className="check-title">Sandbox</span>
          <span className="check-sub">
            Run the agent inside Apple Container (Linux VM). Workspace
            bind-mounted, all Linux capabilities dropped, non-root user.
          </span>
        </span>
      </label>

      <div className="settings-actions">
        <button
          className="btn-primary"
          onClick={() => void handleSave()}
          disabled={!ready || saving}
        >
          {saving ? "Saving…" : firstRun ? "Get started" : "Save"}
        </button>
      </div>
      {!ready && (
        <div className="settings-hint">
          API key and workspace folder are required.
        </div>
      )}
    </div>
  );
}
