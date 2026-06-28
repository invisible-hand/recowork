#!/usr/bin/env node
import { runAgent } from "./agent.js";
import { describeConfig, loadConfig } from "./inference/config.js";
import { resolve } from "node:path";

interface CliArgs {
  task?: string;
  taskFile?: string;
  cwd?: string;
  printConfig?: boolean;
  help?: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--task":
      case "-t":
        args.task = argv[++i];
        break;
      case "--task-file":
      case "-f":
        args.taskFile = argv[++i];
        break;
      case "--cwd":
      case "-C":
        args.cwd = argv[++i];
        break;
      case "--print-config":
        args.printConfig = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
    }
  }
  return args;
}

const HELP = `recowork-agent — Phase 1 headless harness

Usage:
  recowork-agent --task "your goal here"
  recowork-agent --task-file path/to/task.md
  recowork-agent --print-config

Options:
  --task, -t <string>       Goal for the agent
  --task-file, -f <path>    Read goal from a file
  --cwd, -C <path>          Working directory for tool execution
  --print-config            Print the loaded inference config and exit
  --help, -h                Show this help

Env vars (loaded from agent-core/.env):
  BASETEN_API_KEY           required
  INFERENCE_PROVIDER        baseten-anthropic | baseten-openai-via-litellm
  INFERENCE_BASE_URL        defaults per provider
  INFERENCE_MODEL           defaults to zai-org/GLM-5.2
  MAX_OUTPUT_TOKENS         defaults to 8192
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  if (args.printConfig) {
    const cfg = loadConfig();
    process.stdout.write(describeConfig(cfg) + "\n");
    return;
  }

  let goal: string | undefined = args.task;
  if (!goal && args.taskFile) {
    const fs = await import("node:fs");
    goal = fs.readFileSync(resolve(args.taskFile), "utf8");
  }

  if (!goal) {
    process.stderr.write("error: provide --task or --task-file\n\n" + HELP);
    process.exit(2);
  }

  const runId = `cli-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  process.stderr.write(`▸ run ${runId}\n`);

  const result = await runAgent({
    goal,
    runId,
    cwd: args.cwd ? resolve(args.cwd) : process.cwd(),
    onEvent: (kind, payload) => {
      if (kind === "text" && typeof payload === "string") {
        process.stdout.write(payload);
      } else if (kind === "tool_use") {
        const p = payload as { name: string; input: unknown };
        process.stderr.write(`\n[tool_use ${p.name}] ${truncate(p.input)}\n`);
      } else if (kind === "tool_result") {
        const p = payload as { isError: boolean; content: unknown };
        const tag = p.isError ? "tool_error" : "tool_result";
        process.stderr.write(`[${tag}] ${truncate(p.content)}\n`);
      }
    },
  });

  process.stdout.write("\n");
  process.stderr.write(
    `\n▸ done ${runId}\n` +
      `  ok:          ${result.ok}\n` +
      `  tool calls:  ${result.toolCalls}\n` +
      `  tool errors: ${result.toolErrors}\n` +
      `  success:     ${(result.successRate * 100).toFixed(1)}%\n` +
      `  log:         ${result.logPath}\n`,
  );
  if (!result.ok) {
    process.stderr.write(`  error:       ${result.errorMessage}\n`);
    process.exit(1);
  }
}

function truncate(v: unknown, max = 200): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? s.slice(0, max) + "…" : s;
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.stack : err}\n`);
  process.exit(1);
});
