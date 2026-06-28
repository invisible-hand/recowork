#!/usr/bin/env node
/**
 * Phase 1 fixture runner. For each fixture:
 *   1. Create a temp workspace.
 *   2. Materialize fixture setup files.
 *   3. Run the agent with the fixture's goal, cwd=workspace.
 *   4. Verify post-conditions.
 *   5. Print results + aggregate tool-call success rate.
 *
 * Use this to decide Path A (Anthropic-compat) vs Path B (LiteLLM proxy).
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { runAgent } from "./agent.js";

interface FixtureSpec {
  name: string;
  description: string;
  setup?: { files?: Record<string, string> };
  goal: string;
  verify?: {
    files_exist?: string[];
    file_contains?: Record<string, string[]>;
    min_tool_calls?: number;
  };
}

interface FixtureOutcome {
  name: string;
  ok: boolean;
  toolCalls: number;
  toolErrors: number;
  successRate: number;
  verifyFailures: string[];
  errorMessage?: string;
  logPath: string;
  workspace: string;
}

function loadFixtures(dir: string): FixtureSpec[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  return files.map((f) => {
    const raw = readFileSync(join(dir, f), "utf8");
    return JSON.parse(raw) as FixtureSpec;
  });
}

function materializeSetup(workspace: string, setup?: FixtureSpec["setup"]): void {
  if (!setup?.files) return;
  for (const [relPath, body] of Object.entries(setup.files)) {
    const abs = join(workspace, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
}

function verify(workspace: string, v?: FixtureSpec["verify"], toolCalls = 0): string[] {
  const failures: string[] = [];
  if (!v) return failures;
  for (const f of v.files_exist ?? []) {
    if (!existsSync(join(workspace, f))) failures.push(`missing file: ${f}`);
  }
  for (const [f, snippets] of Object.entries(v.file_contains ?? {})) {
    const p = join(workspace, f);
    if (!existsSync(p)) {
      failures.push(`cannot grep missing file: ${f}`);
      continue;
    }
    const body = readFileSync(p, "utf8");
    for (const s of snippets) {
      if (!body.includes(s)) failures.push(`${f} missing snippet: ${JSON.stringify(s)}`);
    }
  }
  if (v.min_tool_calls !== undefined && toolCalls < v.min_tool_calls) {
    failures.push(`tool calls ${toolCalls} < min ${v.min_tool_calls}`);
  }
  return failures;
}

async function runOne(spec: FixtureSpec, idx: number): Promise<FixtureOutcome> {
  const workspace = mkdtempSync(join(tmpdir(), `recowork-fixture-${spec.name}-`));
  materializeSetup(workspace, spec.setup);

  const runId = `fixture-${String(idx + 1).padStart(2, "0")}-${spec.name}-${Date.now()}`;
  process.stderr.write(`\n━━━ [${idx + 1}] ${spec.name}\n  goal: ${spec.goal.slice(0, 110)}${spec.goal.length > 110 ? "…" : ""}\n  cwd:  ${workspace}\n`);

  const result = await runAgent({
    goal: spec.goal,
    runId,
    cwd: workspace,
    onEvent: (kind, payload) => {
      if (kind === "tool_use") {
        const p = payload as { name: string; input: unknown };
        const inputStr = JSON.stringify(p.input);
        process.stderr.write(`  → ${p.name}(${inputStr.length > 80 ? inputStr.slice(0, 80) + "…" : inputStr})\n`);
      } else if (kind === "tool_result") {
        const p = payload as { isError: boolean };
        if (p.isError) process.stderr.write(`  ✗ tool_error\n`);
      }
    },
  });

  const verifyFailures = verify(workspace, spec.verify, result.toolCalls);
  const ok = result.ok && verifyFailures.length === 0;

  process.stderr.write(
    `  result: ${ok ? "PASS" : "FAIL"}  · toolCalls=${result.toolCalls} errors=${result.toolErrors} successRate=${(result.successRate * 100).toFixed(0)}%\n`,
  );
  if (verifyFailures.length) {
    for (const f of verifyFailures) process.stderr.write(`    ✗ ${f}\n`);
  }
  if (result.errorMessage) {
    process.stderr.write(`    ✗ error: ${result.errorMessage}\n`);
  }

  return {
    name: spec.name,
    ok,
    toolCalls: result.toolCalls,
    toolErrors: result.toolErrors,
    successRate: result.successRate,
    verifyFailures,
    errorMessage: result.errorMessage,
    logPath: result.logPath,
    workspace,
  };
}

async function main(): Promise<void> {
  const fixturesDir = resolve(process.cwd(), "fixtures");
  if (!existsSync(fixturesDir)) {
    process.stderr.write(`No fixtures dir at ${fixturesDir}\n`);
    process.exit(2);
  }
  const specs = loadFixtures(fixturesDir);
  if (specs.length === 0) {
    process.stderr.write(`No fixtures in ${fixturesDir}\n`);
    process.exit(2);
  }

  process.stderr.write(`Running ${specs.length} fixtures…\n`);
  const outcomes: FixtureOutcome[] = [];
  for (let i = 0; i < specs.length; i++) {
    outcomes.push(await runOne(specs[i], i));
  }

  const total = outcomes.length;
  const passed = outcomes.filter((o) => o.ok).length;
  const totalToolCalls = outcomes.reduce((a, o) => a + o.toolCalls, 0);
  const totalToolErrors = outcomes.reduce((a, o) => a + o.toolErrors, 0);
  const aggregateSuccessRate =
    totalToolCalls === 0 ? 1 : (totalToolCalls - totalToolErrors) / totalToolCalls;

  process.stderr.write("\n═══════════════════════════════════════\n");
  process.stderr.write(`Fixtures:           ${passed}/${total} passed\n`);
  process.stderr.write(`Tool calls (all):   ${totalToolCalls}\n`);
  process.stderr.write(`Tool errors (all):  ${totalToolErrors}\n`);
  process.stderr.write(`Tool success rate:  ${(aggregateSuccessRate * 100).toFixed(1)}%\n`);
  process.stderr.write("═══════════════════════════════════════\n");
  for (const o of outcomes) {
    process.stderr.write(`  ${o.ok ? "✓" : "✗"} ${o.name.padEnd(28)} ${o.workspace}\n`);
  }

  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.stack : err}\n`);
  process.exit(1);
});
