import { query, type Options, type CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import { loadConfig } from "./inference/config.js";
import { buildSystemAppend } from "./prompts/overrides.js";
import { RunLogger } from "./logger.js";

export interface RunAgentOptions {
  goal: string;
  runId: string;
  cwd?: string;
  /** Extra task-specific instructions appended after GLM calibration. */
  systemPrompt?: string;
  /** Override the default tool set. */
  tools?: Options["tools"];
  mcpServers?: Options["mcpServers"];
  permissionMode?: Options["permissionMode"];
  /** Approval handler. When provided, permissionMode is forced to 'default'. */
  canUseTool?: CanUseTool;
  abortController?: AbortController;
  onEvent?: (kind: string, payload: unknown) => void;
}

export interface RunAgentResult {
  runId: string;
  ok: boolean;
  finalText: string;
  toolCalls: number;
  toolErrors: number;
  successRate: number;
  logPath: string;
  errorMessage?: string;
}

const DEFAULT_TOOLS: string[] = [
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Glob",
  "Grep",
  "WebFetch",
];

export async function runAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  const cfg = loadConfig();
  const logger = new RunLogger(opts.runId);
  const finalChunks: string[] = [];
  let errorMessage: string | undefined;

  const usingApproval = typeof opts.canUseTool === "function";
  const permissionMode = usingApproval
    ? "default"
    : opts.permissionMode ?? "bypassPermissions";

  const sdkOptions: Options = {
    model: cfg.model,
    cwd: opts.cwd ?? process.cwd(),
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: buildSystemAppend(opts.systemPrompt),
    },
    tools: opts.tools ?? DEFAULT_TOOLS,
    permissionMode,
    allowDangerouslySkipPermissions: permissionMode === "bypassPermissions",
    canUseTool: opts.canUseTool,
    abortController: opts.abortController,
    mcpServers: opts.mcpServers,
    // When the harness ships the native CLI as a resource, the host passes its
    // resolved path here so the SDK doesn't try to resolve it through
    // node_modules (which is brittle in packaged builds).
    pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_EXECUTABLE,
    env: {
      ...process.env,
      ...cfg.sdkEnv,
    },
  };

  try {
    const stream = query({ prompt: opts.goal, options: sdkOptions });

    for await (const msg of stream) {
      switch (msg.type) {
        case "system":
          logger.record({ kind: "system", text: JSON.stringify(msg) });
          opts.onEvent?.("system", msg);
          break;

        case "assistant": {
          const content = msg.message?.content ?? [];
          for (const block of content) {
            if (block.type === "text") {
              finalChunks.push(block.text);
              logger.record({ kind: "text", text: block.text });
              opts.onEvent?.("text", block.text);
            } else if (block.type === "tool_use") {
              logger.record({
                kind: "tool_use",
                toolName: block.name,
                toolUseId: block.id,
                input: block.input,
              });
              opts.onEvent?.("tool_use", {
                name: block.name,
                id: block.id,
                input: block.input,
              });
            }
          }
          break;
        }

        case "user": {
          const content = msg.message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (
                typeof block === "object" &&
                block !== null &&
                "type" in block &&
                block.type === "tool_result"
              ) {
                logger.record({
                  kind: "tool_result",
                  toolUseId: block.tool_use_id,
                  output: block.content,
                  isError: Boolean(block.is_error),
                });
                opts.onEvent?.("tool_result", {
                  id: block.tool_use_id,
                  isError: Boolean(block.is_error),
                  content: block.content,
                });
              }
            }
          }
          break;
        }

        case "result": {
          logger.record({ kind: "result", output: msg });
          // The SDK's result carries usage and Anthropic-priced cost. We
          // forward both raw; the host overlays Baseten pricing.
          const m = msg as {
            usage?: Record<string, number>;
            total_cost_usd?: number;
            duration_ms?: number;
            duration_api_ms?: number;
            num_turns?: number;
          };
          opts.onEvent?.("result", {
            raw: msg,
            usage: m.usage,
            sdkCostUsd: m.total_cost_usd,
            durationMs: m.duration_ms,
            durationApiMs: m.duration_api_ms,
            numTurns: m.num_turns,
          });
          break;
        }
      }
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    logger.record({ kind: "system", text: `ERROR: ${errorMessage}` });
  }

  const summary = logger.summary();
  return {
    runId: opts.runId,
    ok: errorMessage === undefined,
    finalText: finalChunks.join(""),
    toolCalls: summary.toolCalls,
    toolErrors: summary.toolErrors,
    successRate: summary.successRate,
    logPath: logger.logPath,
    errorMessage,
  };
}
