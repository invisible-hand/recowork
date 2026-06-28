import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  loadSettings,
  saveSettings,
  type AppSettings,
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
  type ChatSession,
  type SessionSummary,
} from "./lib/sessions";
import { Chat, type ChatTurn } from "./components/Chat";
import { Settings } from "./components/Settings";
import { ApprovalModal, type PendingApproval } from "./components/ApprovalModal";
import { Composer } from "./components/Composer";
import { Sidebar } from "./components/Sidebar";
import { Stats } from "./components/Stats";

type View = "chat" | "settings" | "setup" | "stats";

export default function App() {
  const [view, setView] = useState<View>("chat");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [session, setSession] = useState<ChatSession | null>(null);
  const [summaries, setSummaries] = useState<SessionSummary[]>([]);
  const [approval, setApproval] = useState<PendingApproval | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const sidecarRef = useRef<Sidecar | null>(null);
  // Live snapshot of the session for the auto-save effect, which depends on
  // turns but updating it via state alone is fine.
  const turns = session?.turns ?? [];

  // Load persisted settings + session index on mount. On first run, probe
  // for docker so we can default sandbox mode on when isolation is cheap.
  useEffect(() => {
    void (async () => {
      const s = await loadSettings();

      // First-run detection: settings store doesn't have a sentinel yet, so
      // we treat "no apiKey" as a stand-in for first launch. On first launch,
      // default sandbox ON if and only if docker is reachable.
      let next = s;
      if (!s.apiKey) {
        try {
          const dockerOk = await invoke<boolean>("is_docker_available");
          next = { ...s, sandboxEnabled: dockerOk };
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
    })();
  }, []);

  // Apply the theme to <html> whenever it changes. This drives the CSS
  // variable system in styles.css.
  useEffect(() => {
    const theme = settings?.theme ?? "linen";
    document.documentElement.setAttribute("data-theme", theme);
  }, [settings?.theme]);

  // Persist the active session whenever its turns change.
  useEffect(() => {
    if (!session) return;
    if (session.turns.length === 0) return; // don't save empty sessions
    void (async () => {
      const next: ChatSession = {
        ...session,
        title: deriveTitle(session.turns),
        updatedAt: Date.now(),
      };
      await saveSession(next);
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
            image: settings.sandboxImage,
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
    settings?.sandboxImage,
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
      goal,
      cwd: runCwd,
      approvalMode: settings.approvalMode,
      // Only set workspaceLock for non-sandbox mode. In sandbox mode the
      // container's filesystem is already the lock; the agent-core inside
      // the container would receive a host path that wouldn't resolve.
      workspaceLock: settings.sandboxEnabled
        ? undefined
        : settings.workspaceDir || undefined,
      mcpServers:
        settings.mcpFilesystemEnabled && filesystemRoot
          ? {
              filesystem: {
                command: "npx",
                args: [
                  "-y",
                  "@modelcontextprotocol/server-filesystem",
                  filesystemRoot,
                ],
              },
            }
          : undefined,
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

  async function persistSettings(next: AppSettings): Promise<void> {
    await saveSettings(next);
    setSettings(next);
    setView("chat");
  }

  function previewTheme(theme: AppSettings["theme"]): void {
    if (!settings) return;
    const next: AppSettings = { ...settings, theme };
    setSettings(next);
    // Persist asynchronously; failure is non-critical (just won't survive restart).
    void saveSettings(next);
  }

  function handleNewSession(): void {
    setSession(newSession());
    setView("chat");
  }

  async function handleSelectSession(id: string): Promise<void> {
    const sess = await loadSession(id);
    if (sess) {
      setSession(sess);
      setView("chat");
    }
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
    <div className="app-root">
      <header className="app-header">
        <div className="app-title">Recowork · GLM-5.2 via Baseten</div>
        <nav className="app-nav">
          <button
            className={view === "chat" ? "active" : ""}
            onClick={() => setView("chat")}
          >
            Chat
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
      />
      <main className="app-main">
        {view === "stats" ? (
          <Stats />
        ) : view === "setup" || (view === "chat" && needsSetup) ? (
          <Settings
            initial={settings}
            onSave={persistSettings}
            onPreviewTheme={previewTheme}
            firstRun={true}
          />
        ) : view === "settings" ? (
          <Settings
            initial={settings}
            onSave={persistSettings}
            onPreviewTheme={previewTheme}
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
            {logLines.length > 0 && (
              <details className="log-tray">
                <summary>logs ({logLines.length})</summary>
                <pre>{logLines.slice(-30).join("\n")}</pre>
              </details>
            )}
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
