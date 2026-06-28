#!/usr/bin/env node
/**
 * Build the agent-core sidecar for Tauri.
 *
 * The Claude Agent SDK spawns a native `claude` binary at runtime, which
 * prevents `bun build --compile` from producing a working single binary (the
 * native dep doesn't get embedded). So instead we:
 *
 *   1. Bundle agent-core/src/sidecar.ts → agent-core/dist/sidecar.mjs
 *      (single self-contained CJS file targeting node).
 *   2. Copy the platform-specific native `claude` binary into
 *      desktop/src-tauri/resources/claude.
 *
 * Both get shipped as Tauri resources. The Rust side resolves their paths and
 * spawns `node dist/sidecar.mjs` with `CLAUDE_CODE_EXECUTABLE` pointing at the
 * resolved claude binary.
 */
import { spawnSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  chmodSync,
  statSync,
} from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(__dirname, "..");
const agentCoreRoot = resolve(desktopRoot, "..", "agent-core");
const sidecarSource = resolve(agentCoreRoot, "src", "sidecar.ts");
const distDir = resolve(agentCoreRoot, "dist");
const bundledSidecar = resolve(distDir, "sidecar.mjs");
const resourcesDir = resolve(desktopRoot, "src-tauri", "resources");

function detectArch() {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
  if (platform === "darwin" && arch === "x64") return "darwin-x64";
  if (platform === "linux" && arch === "x64") return "linux-x64";
  if (platform === "linux" && arch === "arm64") return "linux-arm64";
  if (platform === "win32" && arch === "x64") return "win32-x64";
  throw new Error(`unsupported platform/arch: ${platform}/${arch}`);
}

function ensureBun() {
  try {
    execSync("bun --version", { stdio: "ignore" });
  } catch {
    throw new Error(
      "bun not found on PATH. Install from https://bun.sh and retry.",
    );
  }
}

function ensureAgentDeps() {
  if (!existsSync(resolve(agentCoreRoot, "node_modules"))) {
    console.log("▸ installing agent-core deps…");
    const r = spawnSync("npm", ["install"], {
      cwd: agentCoreRoot,
      stdio: "inherit",
    });
    if (r.status !== 0) throw new Error("npm install failed in agent-core");
  }
}

function bundleSidecar() {
  if (!existsSync(sidecarSource)) {
    throw new Error(`sidecar source missing: ${sidecarSource}`);
  }
  mkdirSync(distDir, { recursive: true });
  console.log(`▸ bundling sidecar → ${bundledSidecar}`);
  const args = [
    "build",
    sidecarSource,
    "--target=node",
    "--format=esm",
    "--outfile",
    bundledSidecar,
    // Mark the SDK as external so it resolves to node_modules at runtime
    // (which is where the platform-specific native binary lives). Same for
    // dotenv: keep it external so we use the installed copy, not a bundled
    // duplicate.
    "--external",
    "@anthropic-ai/claude-agent-sdk*",
    "--external",
    "dotenv",
  ];
  const r = spawnSync("bun", args, { cwd: agentCoreRoot, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`bun build failed (exit ${r.status})`);
}

function copyNativeClaude() {
  const archDir = detectArch();
  const nativePkgRoot = resolve(
    agentCoreRoot,
    "node_modules",
    "@anthropic-ai",
    `claude-agent-sdk-${archDir}`,
  );
  // The native binary is named "claude" inside the optional dep package.
  const src = resolve(nativePkgRoot, "claude");
  if (!existsSync(src)) {
    throw new Error(
      `native claude binary not found at ${src}. Reinstall agent-core deps?`,
    );
  }
  mkdirSync(resourcesDir, { recursive: true });
  const dst = resolve(resourcesDir, "claude");
  console.log(`▸ copying native claude (${(statSync(src).size / 1e6).toFixed(0)} MB) → ${dst}`);
  copyFileSync(src, dst);
  chmodSync(dst, 0o755);
}

function copySidecarResource() {
  mkdirSync(resourcesDir, { recursive: true });
  const dst = resolve(resourcesDir, "sidecar.mjs");
  console.log(`▸ copying sidecar bundle → ${dst}`);
  copyFileSync(bundledSidecar, dst);
}

function main() {
  ensureBun();
  ensureAgentDeps();
  bundleSidecar();
  copyNativeClaude();
  copySidecarResource();
  console.log("▸ done.");
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
