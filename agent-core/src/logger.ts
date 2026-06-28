import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir, tmpdir } from "node:os";

export interface ToolCallRecord {
  ts: string;
  kind: "tool_use" | "tool_result" | "text" | "system" | "result";
  toolName?: string;
  toolUseId?: string;
  input?: unknown;
  output?: unknown;
  isError?: boolean;
  text?: string;
}

/**
 * Pick a writable log directory. We can't use `process.cwd()` because when
 * the sidecar runs inside a Tauri .app launched from Finder, cwd is `/`,
 * and inside the sandbox container the cwd is `/workspace` (which we don't
 * want to litter with logs anyway).
 */
function defaultLogDir(): string {
  // 1. Caller-supplied via env (host-side Rust can pass it down).
  const fromEnv = process.env.RECOWORK_LOG_DIR;
  if (fromEnv && fromEnv.trim() !== "") return fromEnv;
  // 2. Home-based: works in host mode and inside the container (where HOME=/home/node).
  const home = homedir();
  if (home && home !== "/") return resolve(home, ".recowork", "logs");
  // 3. Last resort.
  return resolve(tmpdir(), "recowork-logs");
}

export class RunLogger {
  private path: string;
  private counts: { toolCalls: number; toolErrors: number } = {
    toolCalls: 0,
    toolErrors: 0,
  };

  constructor(runId: string, logDir = defaultLogDir()) {
    mkdirSync(logDir, { recursive: true });
    this.path = resolve(logDir, `${runId}.jsonl`);
    writeFileSync(this.path, "");
  }

  record(r: Omit<ToolCallRecord, "ts">): void {
    const entry: ToolCallRecord = { ts: new Date().toISOString(), ...r };
    appendFileSync(this.path, JSON.stringify(entry) + "\n");
    if (r.kind === "tool_use") this.counts.toolCalls += 1;
    if (r.kind === "tool_result" && r.isError) this.counts.toolErrors += 1;
  }

  summary(): { toolCalls: number; toolErrors: number; successRate: number } {
    const { toolCalls, toolErrors } = this.counts;
    const successRate =
      toolCalls === 0 ? 1 : (toolCalls - toolErrors) / toolCalls;
    return { toolCalls, toolErrors, successRate };
  }

  get logPath(): string {
    return this.path;
  }
}
