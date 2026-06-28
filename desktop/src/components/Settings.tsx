import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { AppSettings, ThemeName } from "../lib/store";

interface ThemeOption {
  id: ThemeName;
  name: string;
  swatches: [string, string, string, string]; // bg, card, accent, accent-2
}

const THEMES: ThemeOption[] = [
  { id: "linen",    name: "Linen",    swatches: ["#faf6f1", "#ffffff", "#8a6f47", "#a98863"] },
  { id: "sage",     name: "Sage",     swatches: ["#f1f5ef", "#ffffff", "#4d7a5a", "#74a07f"] },
  { id: "lavender", name: "Lavender", swatches: ["#f5f1f8", "#ffffff", "#7b5fa3", "#9a83bf"] },
  { id: "coral",    name: "Coral",    swatches: ["#fdf4ee", "#ffffff", "#c97048", "#e08d6b"] },
  { id: "slate",    name: "Slate",    swatches: ["#f6f7f9", "#ffffff", "#4361c2", "#6985d1"] },
  { id: "blossom",  name: "Blossom",  swatches: ["#fbeff2", "#ffffff", "#e85d8a", "#f08bb0"] },
  { id: "midnight", name: "Midnight", swatches: ["#14131b", "#1d1c26", "#8b7cff", "#a89bff"] },
];

interface Props {
  initial: AppSettings;
  onSave: (s: AppSettings) => void | Promise<void>;
  onPreviewTheme?: (t: ThemeName) => void;
  firstRun: boolean;
}

export function Settings({ initial, onSave, onPreviewTheme, firstRun }: Props) {
  const [s, setS] = useState<AppSettings>(initial);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof AppSettings>(k: K, v: AppSettings[K]) {
    setS((prev) => ({ ...prev, [k]: v }));
    if (k === "theme") onPreviewTheme?.(v as ThemeName);
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
      <h2>Theme</h2>
      <div className="theme-grid">
        {THEMES.map((t) => (
          <div
            key={t.id}
            className={`theme-tile ${s.theme === t.id ? "active" : ""}`}
            onClick={() => set("theme", t.id)}
          >
            <div className="theme-swatches">
              {t.swatches.map((c, i) => (
                <div
                  key={i}
                  className="theme-swatch"
                  style={{ background: c }}
                />
              ))}
            </div>
            <div className="theme-tile-name">{t.name}</div>
          </div>
        ))}
      </div>

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
        <label>Model</label>
        <input
          value={s.model}
          onChange={(e) => set("model", e.target.value)}
        />
      </div>
      <div className="form-row">
        <label>Base URL</label>
        <input
          value={s.baseUrl}
          onChange={(e) => set("baseUrl", e.target.value)}
        />
      </div>
      <div className="form-row">
        <label>Provider</label>
        <select
          value={s.provider}
          onChange={(e) =>
            set("provider", e.target.value as AppSettings["provider"])
          }
        >
          <option value="baseten-anthropic">
            Baseten · Anthropic-compatible (Path A, beta)
          </option>
          <option value="baseten-openai-via-litellm">
            Baseten · OpenAI via LiteLLM proxy (Path B)
          </option>
        </select>
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
      <div className="form-row">
        <label>Filesystem MCP server</label>
        <label className="form-toggle">
          <input
            type="checkbox"
            checked={s.mcpFilesystemEnabled}
            onChange={(e) => set("mcpFilesystemEnabled", e.target.checked)}
          />
          <span>
            Expose <code>@modelcontextprotocol/server-filesystem</code> scoped
            to the workspace
          </span>
        </label>
      </div>

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
      <div className="form-row">
        <label>Sandbox</label>
        <label className="form-toggle">
          <input
            type="checkbox"
            checked={s.sandboxEnabled}
            onChange={(e) => set("sandboxEnabled", e.target.checked)}
          />
          <span>
            Run the agent inside an OrbStack/Docker container — workspace
            bind-mounted, all linux capabilities dropped, non-root user. Build
            the image first with{" "}
            <code>bash sandbox/scripts/build-image.sh</code>.
          </span>
        </label>
      </div>
      {s.sandboxEnabled && (
        <div className="form-row">
          <label>Sandbox image</label>
          <input
            value={s.sandboxImage}
            onChange={(e) => set("sandboxImage", e.target.value)}
          />
        </div>
      )}

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
