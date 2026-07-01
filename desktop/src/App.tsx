import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * Embedded at build time from package.json. Use the badge in the header to
 * verify which build you're running when behaviour looks stale.
 */
const APP_VERSION = "0.1.17";
import {
  loadSettings,
  saveSettings,
  type AppSettings,
  SANDBOX_IMAGE,
} from "./lib/store";
import {
  Sidecar,
  type AgentEvent,
  type RunSpec,
} from "./lib/sidecar";
import {
  deleteSession,
  deriveTitle,
  listSessions,
  loadSession,
  newSession,
  saveSession,
  togglePinSession,
  type ChatSession,
  type SessionSummary,
} from "./lib/sessions";
import { appendUsage } from "./lib/usage";
import { generateTitle } from "./lib/titles";
import { Chat, type ChatTurn } from "./components/Chat";
import { Settings } from "./components/Settings";
import { ApprovalModal, type PendingApproval } from "./components/ApprovalModal";
import { Composer } from "./components/Composer";
import { Sidebar } from "./components/Sidebar";
import { Stats } from "./components/Stats";
import { Tools } from "./components/Tools";
import { MCPServers } from "./components/MCPServers";
import { listMcps, toRunSpecMcpServers, type McpServer } from "./lib/mcps";

type View = "chat" | "settings" | "setup" | "stats" | "tools" | "mcps";

export default function App() {
  const [view, setView] = useState<View>("chat");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [session, setSession] = useState<ChatSession | null>(null);
  const [summaries, setSummaries] = useState<SessionSummary[]>([]);
  const [approval, setApproval] = useState<PendingApproval | null>(null);
  const [mcps, setMcps] = useState<McpServer[]>([]);
  // Log lines are captured for future debug surfaces, but the UI no longer
  // shows them inline. Drop the read binding to keep typecheck happy.
  const [, setLogLines] = useState<string[]>([]);
  const sidecarRef = useRef<Sidecar | null>(null);
  // Snapshot of what's already on disk for the active session. The auto-save
  // effect compares against this so loading a session doesn't re-write it
  // (which would bump updatedAt and re-rank the sidebar).
  const lastSavedTurnsRef = useRef<unknown>(null);
  const lastSavedSessionIdRef = useRef<string | null>(null);
  // The sidecar's onEvent callback captures whatever `session` / `settings`
  // existed when the sidecar started — usually an empty session. Without a
  // ref, by the time the `result` event arrives, `maybeGenerateTitle` would
  // be reading a stale session that has no record of the just-completed
  // turn, so the title-generation early-returns silently.
  const sessionRef = useRef<ChatSession | null>(null);
  const settingsRef = useRef<AppSettings | null>(null);
  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  const turns = session?.turns ?? [];

  // Sidebar width — persisted across launches via localStorage. Clamped to
  // [160, 480] so the user can't drag it to a useless extreme.
  const [sidebarW, setSidebarW] = useState<number>(() => {
    const raw = localStorage.getItem("recowork.sidebarW");
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n >= 160 && n <= 480 ? n : 220;
  });
  useEffect(() => {
    localStorage.setItem("recowork.sidebarW", String(sidebarW));
  }, [sidebarW]);
  function startSidebarDrag(e: React.MouseEvent<HTMLDivElement>): void {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarW;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    function onMove(ev: MouseEvent): void {
      const next = Math.min(480, Math.max(160, startW + (ev.clientX - startX)));
      setSidebarW(next);
    }
    function onUp(): void {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // Load persisted settings + session index on mount. On first run, probe
  // for docker so we can default sandbox mode on when isolation is cheap.
  useEffect(() => {
    void (async () => {
      const s = await loadSettings();

      // First-run detection: settings store doesn't have a sentinel yet, so
      // we treat "no apiKey" as a stand-in for first launch. On first launch,
      // default sandbox ON iff Apple's `container` daemon is reachable.
      let next = s;
      if (!s.apiKey) {
        try {
          const containerOk = await invoke<boolean>("is_container_available");
          next = { ...s, sandboxEnabled: containerOk };
          await saveSettings(next);
        } catch {
          // ignore — if probe fails, keep defaults
        }
      }
      setSettings(next);
      if (!next.apiKey) setView("setup");

      const idx = await listSessions();
      setSummaries(idx);
      if (idx.length > 0 && next.apiKey) {
        const latest = await loadSession(idx[0].id);
        if (latest) setSession(latest);
      } else {
        setSession(newSession());
      }
      // MCP servers are loaded here and refreshed by the MCPs tab via
      // its onChanged callback so RunSpec always sees the latest set.
      setMcps(await listMcps());
    })();
  }, []);

  // One hardcoded theme (Slate). The CSS variables for the other palettes
  // are still in styles.css but no UI exposes them.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "slate");
  }, []);

  // Persist the active session when its turns actually change. Loading a
  // session sets turns to a fresh reference but identical content; we skip
  // those by comparing the turns reference to the last-saved snapshot.
  useEffect(() => {
    if (!session) return;
    if (session.turns.length === 0) return; // don't save empty sessions
    if (
      lastSavedSessionIdRef.current === session.id &&
      lastSavedTurnsRef.current === session.turns
    ) {
      return; // unchanged since load/save
    }
    void (async () => {
      // Preserve any custom title (LLM-generated or user-edited). Only
      // overwrite when the current title is empty, "New chat", or still
      // matches the verbatim derivation of the first user message.
      const verbatim = deriveTitle(session.turns);
      const titleIsAuto =
        !session.title ||
        session.title === "New chat" ||
        session.title === verbatim;
      const next: ChatSession = {
        ...session,
        title: titleIsAuto ? verbatim : session.title,
        updatedAt: Date.now(),
      };
      await saveSession(next);
      lastSavedSessionIdRef.current = next.id;
      lastSavedTurnsRef.current = next.turns;
      const idx = await listSessions();
      setSummaries(idx);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.turns]);

  // Start (or restart) the sidecar whenever creds/sandbox change.
  useEffect(() => {
    if (!settings || !settings.apiKey) return;
    let cancelled = false;
    void (async () => {
      const sc = new Sidecar();
      sidecarRef.current = sc;
      sc.onEvent((e) => {
        if (cancelled) return;
        handleAgentEvent(e);
      });
      try {
        await sc.start({
          apiKey: settings.apiKey,
          baseUrl: settings.baseUrl,
          model: settings.model,
          maxOutputTokens: settings.maxOutputTokens,
          provider: settings.provider,
          sandbox: {
            enabled: settings.sandboxEnabled,
            image: SANDBOX_IMAGE,
            workspaceDir: settings.workspaceDir,
          },
        });
      } catch (err) {
        setLogLines((l) => [
          ...l,
          `failed to start sidecar: ${err instanceof Error ? err.message : String(err)}`,
        ]);
      }
    })();
    return () => {
      cancelled = true;
      void sidecarRef.current?.stop();
      sidecarRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settings?.apiKey,
    settings?.baseUrl,
    settings?.model,
    settings?.maxOutputTokens,
    settings?.provider,
    settings?.sandboxEnabled,
    settings?.workspaceDir,
  ]);

  function handleAgentEvent(e: AgentEvent): void {
    switch (e.type) {
      case "text":
        setSession((cur) => cur && updateSessionTurns(cur, (turns) => appendText(turns, e.runId, e.chunk)));
        break;
      case "tool_use":
        setSession((cur) =>
          cur &&
          updateSessionTurns(cur, (turns) =>
            appendBlock(turns, e.runId, {
              kind: "tool_use",
              toolUseId: e.toolUseId,
              name: e.name,
              input: e.input,
            }),
          ),
        );
        break;
      case "tool_result":
        setSession((cur) =>
          cur &&
          updateSessionTurns(cur, (turns) =>
            updateToolResult(turns, e.toolUseId, e.content, e.isError),
          ),
        );
        break;
      case "approval_request":
        setApproval({
          runId: e.runId,
          decisionId: e.decisionId,
          toolName: e.toolName,
          input: e.input,
          title: e.title,
          description: e.description,
        });
        break;
      case "result":
        setSession((cur) =>
          cur &&
          updateSessionTurns(cur, (turns) =>
            appendBlock(turns, e.runId, {
              kind: "result",
              ok: e.ok,
              toolCalls: e.toolCalls,
              toolErrors: e.toolErrors,
              successRate: e.successRate,
              errorMessage: e.errorMessage,
            }),
          ),
        );
        setRunning(null);
        // Ask the LLM to title the session after the first turn — even if
        // the turn ended in a tool error, we still have a user message
        // worth titling around.
        if (settings) {
          void maybeGenerateTitle(e.runId);
        }
        break;
      case "usage":
        // Attach usage info to the active turn.
        setSession((cur) =>
          cur
            ? {
                ...cur,
                updatedAt: Date.now(),
                turns: cur.turns.map((t) =>
                  t.runId === e.runId
                    ? {
                        ...t,
                        usage: e.usage,
                        durationMs: e.durationMs,
                        numTurns: e.numTurns,
                        model: settings?.model,
                      }
                    : t,
                ),
              }
            : cur,
        );
        // Also persist to the permanent usage log so deleting sessions
        // doesn't erase the running cost view.
        if (settings && e.usage) {
          void appendUsage({
            ts: Date.now(),
            model: settings.model,
            input_tokens: e.usage.input_tokens ?? 0,
            output_tokens: e.usage.output_tokens ?? 0,
            cache_read_input_tokens: e.usage.cache_read_input_tokens ?? 0,
            cache_creation_input_tokens:
              e.usage.cache_creation_input_tokens ?? 0,
            durationMs: e.durationMs ?? 0,
            toolCalls: 0,
            toolErrors: 0,
            sessionId: session?.id,
          });
        }
        break;
      case "error":
        setLogLines((l) => [...l, `error: ${e.message}`]);
        // Surface inline in the chat so the user sees what went wrong
        // without hunting in the log tray.
        if (e.runId) {
          const runId = e.runId;
          setSession((cur) =>
            cur
              ? updateSessionTurns(cur, (turns) =>
                  appendBlock(turns, runId, {
                    kind: "result",
                    ok: false,
                    toolCalls: 0,
                    toolErrors: 0,
                    successRate: 1,
                    errorMessage: e.message,
                  }),
                )
              : cur,
          );
        }
        setRunning(null);
        break;
      case "log":
        setLogLines((l) => [...l, `[${e.level}] ${e.message}`]);
        break;
    }
  }

  async function handleSubmit(goal: string): Promise<void> {
    if (!settings || !sidecarRef.current || !session) return;
    const id = crypto.randomUUID();
    // In sandbox mode the workspace is bind-mounted at /workspace inside the
    // container. The host path doesn't exist inside the container, so passing
    // it as cwd causes node's spawn() to fail with ENOENT, which the SDK
    // then misreports as a libc mismatch.
    const runCwd = settings.sandboxEnabled
      ? "/workspace"
      : settings.workspaceDir || undefined;
    const filesystemRoot = settings.sandboxEnabled
      ? "/workspace"
      : settings.workspaceDir;
    const spec: RunSpec = {
      id,
      chatSessionId: session.id,
      goal,
      cwd: runCwd,
      approvalMode: settings.approvalMode,
      // Only set workspaceLock for non-sandbox mode. In sandbox mode the
      // container's filesystem is already the lock; the agent-core inside
      // the container would receive a host path that wouldn't resolve.
      workspaceLock: settings.sandboxEnabled
        ? undefined
        : settings.workspaceDir || undefined,
      mcpServers: (() => {
        const merged: RunSpec["mcpServers"] = { ...toRunSpecMcpServers(mcps) };
        if (settings.mcpFilesystemEnabled && filesystemRoot) {
          merged.filesystem = {
            command: "npx",
            args: [
              "-y",
              "@modelcontextprotocol/server-filesystem",
              filesystemRoot,
            ],
          };
        }
        return Object.keys(merged).length ? merged : undefined;
      })(),
    };
    setSession((cur) =>
      cur && updateSessionTurns(cur, (turns) => [
        ...turns,
        { runId: id, userGoal: goal, blocks: [] },
      ]),
    );
    setRunning(id);
    try {
      await sidecarRef.current.run(spec);
    } catch (err) {
      setLogLines((l) => [
        ...l,
        `run failed: ${err instanceof Error ? err.message : String(err)}`,
      ]);
      setRunning(null);
    }
  }

  async function handleApproval(
    decision: "approve" | "deny",
    denyMessage?: string,
  ): Promise<void> {
    if (!approval || !sidecarRef.current) return;
    await sidecarRef.current.respondApproval(
      approval.decisionId,
      decision,
      denyMessage,
    );
    setApproval(null);
  }

  async function handleAbort(): Promise<void> {
    if (!running || !sidecarRef.current) return;
    await sidecarRef.current.abort(running);
    setRunning(null);
  }

  async function maybeGenerateTitle(runId: string): Promise<void> {
    // Read live state through refs — the captured `session` / `settings`
    // here may be from sidecar-start time and not reflect the turn that
    // just completed.
    const liveSettings = settingsRef.current;
    const liveSession = sessionRef.current;
    if (!liveSettings || !liveSession) {
      setLogLines((l) => [...l, "[title] skipped: no live session/settings"]);
      return;
    }
    const sessionId = liveSession.id;
    const turnsAtCall = liveSession.turns;
    const t = turnsAtCall.find((t) => t.runId === runId);
    if (!t || !t.userGoal) {
      setLogLines((l) => [
        ...l,
        `[title] skipped: run ${runId.slice(0, 8)} not found in ${turnsAtCall.length} turns`,
      ]);
      return;
    }
    // Only retitle on the first turn of this session.
    const idx = turnsAtCall.indexOf(t);
    if (idx !== 0) return;
    // Skip if a non-verbatim title is already set (user/LLM has named it).
    const verbatim = deriveTitle(turnsAtCall);
    const titleIsAuto =
      !liveSession.title ||
      liveSession.title === verbatim ||
      liveSession.title === "New chat";
    if (!titleIsAuto) return;

    const firstAgentText = t.blocks
      .filter((b) => b.kind === "text")
      .map((b) => (b as { text: string }).text)
      .join(" ");

    setLogLines((l) => [...l, "[title] requesting title from baseten…"]);
    let title: string | null = null;
    try {
      title = await generateTitle(
        liveSettings.apiKey,
        liveSettings.baseUrl,
        liveSettings.model,
        t.userGoal,
        firstAgentText,
      );
    } catch (err) {
      setLogLines((l) => [
        ...l,
        `[title] error: ${err instanceof Error ? err.message : String(err)}`,
      ]);
      return;
    }
    if (!title) {
      setLogLines((l) => [...l, "[title] generation failed; keeping verbatim"]);
      return;
    }
    setLogLines((l) => [...l, `[title] "${title}"`]);

    // Apply + persist. The autosave effect won't fire because turns didn't
    // change, so we save explicitly.
    setSession((cur) => {
      if (!cur || cur.id !== sessionId) return cur;
      const next = { ...cur, title, updatedAt: Date.now() };
      void (async () => {
        await saveSession(next);
        lastSavedSessionIdRef.current = next.id;
        lastSavedTurnsRef.current = next.turns;
        const idx = await listSessions();
        setSummaries(idx);
      })();
      return next;
    });
  }

  async function persistSettings(next: AppSettings): Promise<void> {
    await saveSettings(next);
    setSettings(next);
    setView("chat");
  }

  function handleNewSession(): void {
    setSession(newSession());
    setView("chat");
  }

  async function handleSelectSession(id: string): Promise<void> {
    const sess = await loadSession(id);
    if (sess) {
      // Mark the loaded turns as "already saved" so the autosave effect
      // doesn't fire and bump updatedAt purely from clicking.
      lastSavedSessionIdRef.current = sess.id;
      lastSavedTurnsRef.current = sess.turns;
      setSession(sess);
      setView("chat");
    }
  }

  async function handleTogglePin(id: string): Promise<void> {
    await togglePinSession(id);
    const idx = await listSessions();
    setSummaries(idx);
  }

  async function handleDeleteSession(id: string): Promise<void> {
    await deleteSession(id);
    const idx = await listSessions();
    setSummaries(idx);
    if (session?.id === id) {
      if (idx.length > 0) {
        const next = await loadSession(idx[0].id);
        setSession(next ?? newSession());
      } else {
        setSession(newSession());
      }
    }
  }

  const needsSetup = useMemo(
    () => !settings || !settings.apiKey || !settings.workspaceDir,
    [settings],
  );

  if (!settings) {
    return <div className="centered-loading">Loading…</div>;
  }

  return (
    <div
      className="app-root"
      style={{ ["--sidebar-w" as string]: `${sidebarW}px` }}
    >
      <header className="app-header">
        {/* macOS title bar already shows "Recowork", so we avoid repeating
            the brand here. The version is the only useful in-app marker —
            it lets the user verify which build they're running. */}
        <div className="app-title">
          <span className="app-title-dim">v{APP_VERSION}</span>
        </div>
        <nav className="app-nav">
          <button
            className={view === "chat" ? "active" : ""}
            onClick={() => setView("chat")}
          >
            Chat
          </button>
          <button
            className={view === "tools" ? "active" : ""}
            onClick={() => setView("tools")}
          >
            Tools
          </button>
          <button
            className={view === "mcps" ? "active" : ""}
            onClick={() => setView("mcps")}
          >
            MCPs
          </button>
          <button
            className={view === "stats" ? "active" : ""}
            onClick={() => setView("stats")}
          >
            Stats
          </button>
          <button
            className={view === "settings" ? "active" : ""}
            onClick={() => setView("settings")}
          >
            Settings
          </button>
        </nav>
      </header>
      <Sidebar
        sessions={summaries}
        activeId={session?.id ?? null}
        onSelect={(id) => void handleSelectSession(id)}
        onNew={handleNewSession}
        onDelete={(id) => void handleDeleteSession(id)}
        onTogglePin={(id) => void handleTogglePin(id)}
      />
      <div
        className="sidebar-resize"
        role="separator"
        aria-orientation="vertical"
        onMouseDown={startSidebarDrag}
        onDoubleClick={() => setSidebarW(220)}
        title="Drag to resize · double-click to reset"
      />
      <main className="app-main">
        {view === "stats" ? (
          <Stats />
        ) : view === "tools" ? (
          <Tools settings={settings} mcps={mcps} />
        ) : view === "mcps" ? (
          <MCPServers onChanged={() => void (async () => setMcps(await listMcps()))()} />
        ) : view === "setup" || (view === "chat" && needsSetup) ? (
          <Settings
            initial={settings}
            onSave={persistSettings}
            firstRun={true}
          />
        ) : view === "settings" ? (
          <Settings
            initial={settings}
            onSave={persistSettings}
            firstRun={false}
          />
        ) : (
          <div className="chat-pane">
            <Chat turns={turns} running={running} />
            <Composer
              disabled={running !== null}
              running={running !== null}
              onSubmit={handleSubmit}
              onAbort={handleAbort}
            />
            {/* logs intentionally hidden from the main UI — diagnostic lines
                are still captured in `logLines` state for future debug surfaces */}
          </div>
        )}
      </main>
      {approval && (
        <ApprovalModal
          approval={approval}
          onDecision={handleApproval}
        />
      )}
    </div>
  );
}

function updateSessionTurns(
  s: ChatSession,
  fn: (t: ChatTurn[]) => ChatTurn[],
): ChatSession {
  return { ...s, turns: fn(s.turns), updatedAt: Date.now() };
}

function appendText(prev: ChatTurn[], runId: string, chunk: string): ChatTurn[] {
  return prev.map((t) => {
    if (t.runId !== runId) return t;
    const last = t.blocks[t.blocks.length - 1];
    if (last && last.kind === "text") {
      const newLast = { ...last, text: last.text + chunk };
      return { ...t, blocks: [...t.blocks.slice(0, -1), newLast] };
    }
    return { ...t, blocks: [...t.blocks, { kind: "text", text: chunk }] };
  });
}

function appendBlock(
  prev: ChatTurn[],
  runId: string,
  block: ChatTurn["blocks"][number],
): ChatTurn[] {
  return prev.map((t) =>
    t.runId === runId ? { ...t, blocks: [...t.blocks, block] } : t,
  );
}

function updateToolResult(
  prev: ChatTurn[],
  toolUseId: string,
  content: unknown,
  isError: boolean,
): ChatTurn[] {
  return prev.map((t) => {
    const blocks = t.blocks.map((b) => {
      if (b.kind === "tool_use" && b.toolUseId === toolUseId) {
        return { ...b, result: content, isError };
      }
      return b;
    });
    return { ...t, blocks };
  });
}
