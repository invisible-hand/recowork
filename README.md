# Recowork

A Cowork-style desktop agent for macOS, powered by **GLM-5.2** (open weights, MIT)
served via **Baseten**, driven by the **Claude Agent SDK** harness, wrapped in a
**Tauri 2** shell.

## Status

| Phase | What | State |
|------:|------|------|
| 0 | Manual validation in Claude Desktop 3P mode | Skipped (per user) |
| 1 | Headless Node/TS harness, fixture suite | ✅ 4/4 fixtures, 100% tool-call success |
| 2 | OrbStack/Docker sandbox | ✅ workspace isolation done; egress allowlist deferred |
| 3 | Tauri 2 desktop app with sidecar | ✅ scaffolded |

## Architecture

```
desktop (Tauri 2, React/TS)              agent-core (Node/TS)
┌─────────────────────────┐ stdin/stdout ┌─────────────────────────┐
│ Chat · approvals · diff │◄────────────►│ Claude Agent SDK harness │
│ Settings · MCP config   │  JSON Lines  │ + GLM-5.2 prompt overrides│
└──────────┬──────────────┘              └──────────────┬───────────┘
           │ resolve_agent_paths                         │ HTTPS (Bearer)
           ▼                                             ▼
        Rust spawns `node sidecar.cjs`             https://inference.baseten.co
                with CLAUDE_CODE_EXECUTABLE         model: zai-org/GLM-5.2
                pointing at native `claude`         (Anthropic-compatible beta)
```

- Inference: `Authorization: Bearer <BASETEN_API_KEY>` (set via
  `ANTHROPIC_AUTH_TOKEN`, not `x-api-key`). `ANTHROPIC_BASE_URL` is
  `https://inference.baseten.co` — the SDK appends `/v1/messages`.
- The Anthropic-compatible endpoint is currently **beta**. Switching to the
  OpenAI-compat endpoint via LiteLLM is a config change, not a refactor —
  toggle `INFERENCE_PROVIDER=baseten-openai-via-litellm` in `.env` (or via
  Settings UI) and point at a local LiteLLM proxy.
- The Claude Agent SDK ships a 225 MB native `claude` binary as an optional
  per-platform npm dep. We bundle the JS sidecar to a single `.cjs` file and
  copy the native binary into Tauri's `resources/`. At runtime, Rust resolves
  both paths and spawns `node sidecar.cjs` with `CLAUDE_CODE_EXECUTABLE` set.

## Repo layout

```
agent-core/                 Node/TS — agent loop, tools, prompt overrides, fixtures
  src/
    inference/config.ts     provider abstraction (Baseten + LiteLLM fallback)
    prompts/overrides.ts    Claude→GLM-5.2 calibration (single file by design)
    tools/                  (built-in SDK tools used; custom tools live here)
    agent.ts                runAgent(): the loop with logging + approval hook
    sidecar.ts              JSON-Lines bridge over stdin/stdout for Tauri
    cli.ts                  headless CLI (--task / --task-file)
    fixtures-runner.ts      multi-fixture validator with success-rate report
  fixtures/                 Phase 1 validation tasks (JSON-described)
  .env                      Baseten key + endpoint (gitignored)
desktop/                    Tauri 2 app
  src/                      React + Vite frontend
    App.tsx                 top-level state machine
    components/             Chat, Composer, ApprovalModal, Settings
    lib/sidecar.ts          spawns the agent process and streams events
    lib/store.ts            persisted settings via tauri-plugin-store
  src-tauri/                Rust shell
    src/lib.rs              resolve_agent_paths command (dev vs packaged)
    capabilities/           shell:allow-execute scoped to `node`
  scripts/
    build-sidecar.mjs       bundles agent-core for embedding as a resource
    make-placeholder-icons  RGBA placeholder PNGs so tauri-build doesn't fail
```

## Setup (development)

Prereqs:
- macOS, Apple Silicon (other targets supported by code, but the build script
  only stages one platform per run)
- Node 20+
- Bun (`brew install oven-sh/bun/bun`)
- Rust toolchain (`rustup`)

```bash
# Install agent-core deps
cd agent-core && npm install

# Drop your Baseten key in agent-core/.env (already done if you set it during setup)
echo "BASETEN_API_KEY=..." >> agent-core/.env

# Install desktop deps + build sidecar bundle
cd ../desktop && npm install
npm run sidecar:build      # bundles sidecar.cjs and copies native claude into src-tauri/resources

# Launch dev mode (vite + tauri)
npm run tauri dev
```

First-run UI asks for the Baseten key and a workspace folder; everything
else has working defaults.

## Headless harness (Phase 1)

The CLI is useful for debugging tool calls without the UI in the way.

```bash
cd agent-core
npm install
# Quick smoke:
npx tsx src/cli.ts --task "echo hi and report what you saw, then stop"
# Print loaded config:
npx tsx src/cli.ts --print-config
# Run the fixture suite (creates temp workspaces, verifies output files):
npx tsx src/fixtures-runner.ts
```

Logs are JSONL, one tool call per line, in `agent-core/logs/`.

## Sandbox (Phase 2)

The sandbox runs the entire agent inside an OrbStack/Docker container with
the workspace bind-mounted at `/workspace`, all linux capabilities dropped,
and no-new-privileges set. The container ships its own platform-native
`claude` binary via npm's optional deps, so the host-side path resolution
isn't needed in this mode.

```bash
# One-time: build the image
bash sandbox/scripts/build-image.sh

# Then enable: Settings → Safety → "Run the agent inside an OrbStack/Docker container"
```

**What the sandbox currently protects against:**
- The agent cannot read or write files outside the chosen workspace folder
  (Read/Edit/Write/Bash all see only `/workspace`).
- The agent runs as a non-root user (`node`, uid 1000).
- No Linux capabilities (`--cap-drop=ALL`), no privilege escalation.

**What it does NOT yet protect against:**
- **Network exfiltration.** Egress allowlist is the next sandbox milestone;
  for now the container has unrestricted outbound. Until that lands, treat
  the agent as if it can POST anything in `/workspace` to anywhere on the
  internet — i.e. don't put secrets in the workspace dir.

## Known gaps / follow-ups

- **Packaging:** dev mode spawns the user's system `node`. Shipping a self-
  contained `.app` will require bundling node (or a thin native launcher)
  alongside the sidecar bundle and the native `claude` binary. The Tauri
  resource layout already accommodates this; the Rust spawn call just needs
  to point at the bundled node instead of PATH.
- **Egress allowlist for the sandbox.** Phase 2 v2: an allowlisting HTTPS
  forward proxy on the host + container `HTTPS_PROXY` env. Hostnames
  Baseten + any user-allowlisted domains only.
- **Anthropic endpoint beta drift:** Phase 1 fixtures pass cleanly today
  (Path A). If you hit malformed `tool_use`/`tool_result` blocks later,
  toggle Settings → Provider → "Baseten · OpenAI via LiteLLM proxy" and run
  a local LiteLLM proxy.
- **Icons:** generated procedurally (see `desktop/scripts/make-app-icon.mjs`).
  Drop a real 1024×1024 source PNG at `desktop/src-tauri/icons/source-1024.png`
  and rerun `npx @tauri-apps/cli icon …` to swap it out.
