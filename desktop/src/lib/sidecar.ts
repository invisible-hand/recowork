/**
 * Bridge to the agent-core sidecar.
 *
 * The sidecar runs as `node <bundled-sidecar.cjs>` with CLAUDE_CODE_EXECUTABLE
 * pointing at the bundled native claude binary. Resource paths are resolved
 * by a Rust command (`resolve_agent_paths`).
 */
import { Command, type Child } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";

export type ApprovalMode = "always" | "auto" | "writes_only";

interface AgentPaths {
  sidecar_js: string;
  claude_exe: string;
  agent_core_dir: string;
}

export interface SidecarConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  maxOutputTokens: number;
  provider: "baseten-anthropic" | "baseten-openai-via-litellm";
  sandbox?: {
    enabled: boolean;
    /** OCI image tag for the sandbox container. */
    image: string;
    workspaceDir: string;
  };
}

export type AgentEvent =
  | { type: "ready" }
  | { type: "text"; runId: string; chunk: string }
  | {
      type: "tool_use";
      runId: string;
      toolUseId: string;
      name: string;
      input: unknown;
    }
  | {
      type: "tool_result";
      runId: string;
      toolUseId: string;
      content: unknown;
      isError: boolean;
    }
  | {
      type: "approval_request";
      runId: string;
      decisionId: string;
      toolName: string;
      input: unknown;
      title?: string;
      description?: string;
      toolUseId?: string;
    }
  | {
      type: "result";
      runId: string;
      ok: boolean;
      toolCalls: number;
      toolErrors: number;
      successRate: number;
      logPath: string;
      finalText?: string;
      errorMessage?: string;
    }
  | {
      type: "usage";
      runId: string;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
      sdkCostUsd?: number;
      durationMs?: number;
      durationApiMs?: number;
      numTurns?: number;
    }
  | { type: "error"; runId?: string; message: string }
  | { type: "log"; level: "info" | "warn" | "error"; message: string };

export interface RunSpec {
  id: string;
  /** Chat session id (frontend's, not the SDK's). Used to chain turns. */
  chatSessionId?: string;
  goal: string;
  cwd?: string;
  mcpServers?: Record<
    string,
    | { command: string; args?: string[]; env?: Record<string, string> }
    | { type: "http"; url: string; headers?: Record<string, string> }
  >;
  approvalMode?: ApprovalMode;
  systemPrompt?: string;
  /**
   * When set, the sidecar denies any file path argument outside this dir.
   * Use the host workspace path in non-sandbox mode; leave undefined when
   * the container itself already constrains the filesystem.
   */
  workspaceLock?: string;
}

type Listener = (e: AgentEvent) => void;

export class Sidecar {
  private child: Child | null = null;
  private listeners = new Set<Listener>();
  private buffer = "";

  async start(config: SidecarConfig): Promise<void> {
    if (this.child) return;

    let cmd;
    if (config.sandbox?.enabled) {
      if (!config.sandbox.workspaceDir) {
        throw new Error(
          "Sandbox enabled but no workspace directory selected. Pick one in Settings.",
        );
      }
      // Apple Container Framework: `container run` runs each container as a
      // lightweight Linux VM. The OCI image is the same one we build from
      // sandbox/Dockerfile. The container ships its own linux-arm64 native
      // claude binary via npm's optional deps, so we don't pass
      // CLAUDE_CODE_EXECUTABLE here.
      const args = [
        "run",
        "--rm",
        "-i",
        "--cap-drop=ALL",
        "--name",
        `recowork-${Date.now()}`,
        "--volume",
        `${config.sandbox.workspaceDir}:/workspace`,
        config.sandbox.image,
      ];
      cmd = Command.create("container", args);
    } else {
      const paths = await invoke<AgentPaths>("resolve_agent_paths");
      cmd = Command.create("node", [paths.sidecar_js], {
        env: {
          CLAUDE_CODE_EXECUTABLE: paths.claude_exe,
        },
      });
    }

    cmd.stdout.on("data", (line) => this.onStdout(String(line)));
    cmd.stderr.on("data", (line) => {
      this.emit({
        type: "log",
        level: "warn",
        message: `[stderr] ${String(line)}`,
      });
    });
    cmd.on("close", (info) => {
      this.emit({
        type: "log",
        level: "info",
        message: `sidecar exited (code=${info.code} signal=${info.signal})`,
      });
      this.child = null;
    });
    cmd.on("error", (err) => {
      this.emit({
        type: "error",
        message: `sidecar error: ${String(err)}`,
      });
    });

    const readyPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        off();
        reject(new Error("sidecar did not signal ready within 15s"));
      }, 15000);
      const off = this.onEvent((e) => {
        if (e.type === "ready") {
          clearTimeout(timeout);
          off();
          resolve();
        }
      });
    });

    this.child = await cmd.spawn();
    await readyPromise;
    await this.send({ type: "config", ...config });
  }

  async stop(): Promise<void> {
    if (this.child) {
      try {
        await this.child.kill();
      } catch {
        // ignore
      }
      this.child = null;
    }
  }

  isRunning(): boolean {
    return this.child !== null;
  }

  onEvent(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: AgentEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(e);
      } catch {
        // ignore listener errors
      }
    }
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (line.trim() === "") continue;
      try {
        this.emit(JSON.parse(line) as AgentEvent);
      } catch {
        this.emit({
          type: "log",
          level: "warn",
          message: `bad sidecar line: ${line.slice(0, 200)}`,
        });
      }
    }
  }

  async send(msg: Record<string, unknown>): Promise<void> {
    if (!this.child) throw new Error("sidecar not started");
    await this.child.write(JSON.stringify(msg) + "\n");
  }

  async run(spec: RunSpec): Promise<void> {
    await this.send({ type: "run", ...spec });
  }

  async respondApproval(
    decisionId: string,
    decision: "approve" | "deny",
    denyMessage?: string,
  ): Promise<void> {
    await this.send({
      type: "approval_response",
      decisionId,
      decision,
      denyMessage,
    });
  }

  async abort(id: string): Promise<void> {
    await this.send({ type: "abort", id });
  }
}
