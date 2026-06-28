#!/usr/bin/env node
/**
 * Sidecar entry point. Speaks JSON Lines over stdin/stdout to the Tauri host.
 *
 * Inbound (host -> agent):
 *   { "type": "config", "apiKey": "...", "model": "...", "baseUrl": "...",
 *     "maxOutputTokens": 8192, "provider": "baseten-anthropic" }
 *   { "type": "run", "id": "uuid", "goal": "...", "cwd": "/abs/path",
 *     "mcpServers": { ... }, "approvalMode": "always"|"auto"|"writes_only",
 *     "systemPrompt": "extra task instructions (optional)" }
 *   { "type": "approval_response", "decisionId": "uuid",
 *     "decision": "approve"|"deny", "denyMessage"?: "..." }
 *   { "type": "abort", "id": "uuid" }
 *
 * Outbound (agent -> host):
 *   { "type": "ready" }
 *   { "type": "text", "runId", "chunk" }
 *   { "type": "tool_use", "runId", "toolUseId", "name", "input" }
 *   { "type": "tool_result", "runId", "toolUseId", "content", "isError" }
 *   { "type": "approval_request", "runId", "decisionId",
 *     "toolName", "input", "title"?, "description"? }
 *   { "type": "result", "runId", "ok", "toolCalls", "toolErrors",
 *     "successRate", "logPath", "finalText"?, "errorMessage"? }
 *   { "type": "error", "runId"?, "message" }
 *   { "type": "log", "level", "message" }
 */
import { runAgent } from "./agent.js";
import type {
  Options,
  CanUseTool,
  PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { resolve as resolvePath, sep as PATH_SEP } from "node:path";

interface ConfigMessage {
  type: "config";
  apiKey: string;
  model?: string;
  baseUrl?: string;
  maxOutputTokens?: number;
  provider?: string;
}

interface RunMessage {
  type: "run";
  id: string;
  goal: string;
  cwd?: string;
  mcpServers?: Options["mcpServers"];
  approvalMode?: "always" | "auto" | "writes_only";
  systemPrompt?: string;
  /**
   * When provided, ALL file-path arguments to Read/Write/Edit/Glob/Grep/etc.
   * must resolve inside this directory or the tool call is denied before any
   * user prompt. The container-mode sidecar doesn't need this because the
   * filesystem is already isolated by the container, but the host-mode
   * sidecar relies on it to constrain the agent to a single folder.
   */
  workspaceLock?: string;
}

interface ApprovalResponse {
  type: "approval_response";
  decisionId: string;
  decision: "approve" | "deny";
  denyMessage?: string;
}

interface AbortMessage {
  type: "abort";
  id: string;
}

type Inbound = ConfigMessage | RunMessage | ApprovalResponse | AbortMessage;

interface PendingApproval {
  resolve: (decision: { allow: boolean; message?: string }) => void;
}

let runtimeConfig: ConfigMessage | null = null;
const pendingApprovals = new Map<string, PendingApproval>();
const activeRuns = new Map<string, AbortController>();

const WRITE_TOOLS = new Set([
  "Write",
  "Edit",
  "MultiEdit",
  "Bash",
  "NotebookEdit",
]);

/**
 * For each built-in tool, the input fields that carry filesystem paths.
 * Bash is intentionally absent — shell commands can touch anything, and we
 * can't reliably parse arbitrary commands. The sandbox is the only honest
 * mitigation for Bash; in non-sandbox mode the approval flow + user
 * judgment is what protects the host.
 */
const TOOL_PATH_FIELDS: Record<string, string[]> = {
  Read: ["file_path"],
  Write: ["file_path"],
  Edit: ["file_path"],
  MultiEdit: ["file_path"],
  NotebookEdit: ["notebook_path"],
  Glob: ["path"],
  Grep: ["path"],
};

function pathEscapesWorkspace(
  toolName: string,
  input: Record<string, unknown>,
  workspaceLock: string,
): string | null {
  const fields = TOOL_PATH_FIELDS[toolName];
  if (!fields) return null;
  const lockAbs = resolvePath(workspaceLock);
  for (const f of fields) {
    const raw = input[f];
    if (typeof raw !== "string" || raw === "") continue;
    const resolved = resolvePath(lockAbs, raw);
    const inside =
      resolved === lockAbs || resolved.startsWith(lockAbs + PATH_SEP);
    if (!inside) return resolved;
  }
  return null;
}

function out(obj: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function log(level: "info" | "warn" | "error", message: string): void {
  out({ type: "log", level, message });
}

function applyConfig(cfg: ConfigMessage): void {
  runtimeConfig = cfg;
  process.env.BASETEN_API_KEY = cfg.apiKey;
  if (cfg.baseUrl) process.env.INFERENCE_BASE_URL = cfg.baseUrl;
  if (cfg.model) process.env.INFERENCE_MODEL = cfg.model;
  if (cfg.maxOutputTokens)
    process.env.MAX_OUTPUT_TOKENS = String(cfg.maxOutputTokens);
  if (cfg.provider) process.env.INFERENCE_PROVIDER = cfg.provider;
  log("info", `config applied (model=${cfg.model ?? "default"})`);
}

function makeCanUseTool(
  runId: string,
  mode: "always" | "writes_only" | "auto",
  workspaceLock: string | undefined,
): CanUseTool {
  return async (toolName, input, ctx): Promise<PermissionResult> => {
    // Hard enforcement: deny any tool call whose path argument escapes the
    // workspace. This runs BEFORE the user prompt so the user never has to
    // catch path-traversal mistakes manually.
    if (workspaceLock) {
      const escapedTo = pathEscapesWorkspace(toolName, input, workspaceLock);
      if (escapedTo) {
        return {
          behavior: "deny",
          message:
            `Path "${escapedTo}" is outside the workspace (${workspaceLock}). ` +
            `Enable sandbox mode to isolate the agent's filesystem entirely, ` +
            `or change the workspace directory in Settings.`,
        };
      }
    }
    // Auto mode: no user prompt, but the path check above still applies.
    if (mode === "auto") {
      return { behavior: "allow", updatedInput: input };
    }
    if (mode === "writes_only" && !WRITE_TOOLS.has(toolName)) {
      return { behavior: "allow", updatedInput: input };
    }
    const decisionId = randomUUID();
    out({
      type: "approval_request",
      runId,
      decisionId,
      toolName,
      input,
      title: ctx?.title,
      description: ctx?.description,
      toolUseId: ctx?.toolUseID,
    });
    const decision = await new Promise<{ allow: boolean; message?: string }>(
      (resolve) => {
        pendingApprovals.set(decisionId, { resolve });
      },
    );
    if (decision.allow) {
      return { behavior: "allow", updatedInput: input };
    }
    return {
      behavior: "deny",
      message: decision.message ?? "User denied the tool call.",
    };
  };
}

async function handleRun(msg: RunMessage): Promise<void> {
  if (!runtimeConfig) {
    out({ type: "error", runId: msg.id, message: "config not sent yet" });
    return;
  }
  const abortController = new AbortController();
  activeRuns.set(msg.id, abortController);

  const mode = msg.approvalMode ?? "writes_only";
  // Even in 'auto' approval mode we want path enforcement when a workspace
  // lock is provided. Without sandboxing this is the only thing standing
  // between the agent and arbitrary host paths.
  const needsCanUseTool = mode !== "auto" || Boolean(msg.workspaceLock);
  const canUseTool = needsCanUseTool
    ? makeCanUseTool(msg.id, mode, msg.workspaceLock)
    : undefined;

  const result = await runAgent({
    goal: msg.goal,
    runId: msg.id,
    cwd: msg.cwd,
    systemPrompt: msg.systemPrompt,
    mcpServers: msg.mcpServers,
    permissionMode: mode === "auto" ? "bypassPermissions" : "default",
    canUseTool,
    abortController,
    onEvent: (kind, payload) => {
      switch (kind) {
        case "text":
          out({ type: "text", runId: msg.id, chunk: payload });
          break;
        case "tool_use": {
          const p = payload as { name: string; id: string; input: unknown };
          out({
            type: "tool_use",
            runId: msg.id,
            toolUseId: p.id,
            name: p.name,
            input: p.input,
          });
          break;
        }
        case "tool_result": {
          const p = payload as {
            id: string;
            isError: boolean;
            content: unknown;
          };
          out({
            type: "tool_result",
            runId: msg.id,
            toolUseId: p.id,
            content: p.content,
            isError: p.isError,
          });
          break;
        }
        case "result": {
          const p = payload as {
            usage?: Record<string, number>;
            sdkCostUsd?: number;
            durationMs?: number;
            durationApiMs?: number;
            numTurns?: number;
          };
          out({
            type: "usage",
            runId: msg.id,
            usage: p.usage,
            sdkCostUsd: p.sdkCostUsd,
            durationMs: p.durationMs,
            durationApiMs: p.durationApiMs,
            numTurns: p.numTurns,
          });
          break;
        }
      }
    },
  });

  activeRuns.delete(msg.id);
  out({
    type: "result",
    runId: msg.id,
    ok: result.ok,
    toolCalls: result.toolCalls,
    toolErrors: result.toolErrors,
    successRate: result.successRate,
    logPath: result.logPath,
    finalText: result.finalText,
    errorMessage: result.errorMessage,
  });
}

function handleApprovalResponse(msg: ApprovalResponse): void {
  const p = pendingApprovals.get(msg.decisionId);
  if (!p) return;
  pendingApprovals.delete(msg.decisionId);
  p.resolve({ allow: msg.decision === "approve", message: msg.denyMessage });
}

function handleAbort(msg: AbortMessage): void {
  const c = activeRuns.get(msg.id);
  if (c) c.abort();
}

async function processLine(line: string): Promise<void> {
  if (line.trim() === "") return;
  let parsed: Inbound;
  try {
    parsed = JSON.parse(line) as Inbound;
  } catch {
    log("error", `invalid json: ${line.slice(0, 120)}`);
    return;
  }
  switch (parsed.type) {
    case "config":
      applyConfig(parsed);
      break;
    case "run":
      handleRun(parsed).catch((err) => {
        out({
          type: "error",
          runId: parsed.id,
          message: err instanceof Error ? err.message : String(err),
        });
      });
      break;
    case "approval_response":
      handleApprovalResponse(parsed);
      break;
    case "abort":
      handleAbort(parsed);
      break;
  }
}

async function main(): Promise<void> {
  out({ type: "ready" });
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buf += chunk;
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      processLine(line);
    }
  });
  process.stdin.on("end", () => process.exit(0));
}

main().catch((err) => {
  log("error", `fatal: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});

export {};
