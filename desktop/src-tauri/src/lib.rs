use serde::Serialize;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Serialize)]
struct AgentPaths {
    sidecar_js: String,
    claude_exe: String,
    agent_core_dir: String,
}

/// Resolve the on-disk paths the sidecar needs.
///
/// - In `tauri dev`, the agent-core source tree sits next to src-tauri, so we
///   use those paths directly and assume `npm run sidecar:build` has produced
///   the bundle.
/// - In a packaged build, the bundle and native binary live in Tauri's
///   resource dir.
#[tauri::command]
fn resolve_agent_paths(app: tauri::AppHandle) -> Result<AgentPaths, String> {
    // Try resource resolution first (packaged build path).
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir failed: {e}"))?;
    let packaged_sidecar = resource_dir.join("resources").join("sidecar.mjs");
    let packaged_claude = resource_dir.join("resources").join("claude");

    if packaged_sidecar.exists() && packaged_claude.exists() {
        return Ok(AgentPaths {
            sidecar_js: packaged_sidecar.to_string_lossy().into_owned(),
            claude_exe: packaged_claude.to_string_lossy().into_owned(),
            agent_core_dir: packaged_sidecar
                .parent()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default(),
        });
    }

    // Dev fallback: use CARGO_MANIFEST_DIR (compile-time path to src-tauri/)
    // to find ../../agent-core. This is robust to whatever cwd Tauri runs the
    // bundled Rust binary from.
    let dev_root: PathBuf = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.join("agent-core"))
        .ok_or_else(|| {
            "could not derive ../../agent-core from CARGO_MANIFEST_DIR".to_string()
        })?;

    let dev_sidecar = dev_root.join("dist").join("sidecar.mjs");
    let dev_claude = dev_root
        .join("node_modules")
        .join("@anthropic-ai")
        .join(native_pkg_name())
        .join("claude");

    if !dev_sidecar.exists() {
        return Err(format!(
            "agent-core sidecar bundle missing at {}. Run `npm run sidecar:build`.",
            dev_sidecar.display()
        ));
    }
    if !dev_claude.exists() {
        return Err(format!(
            "native claude binary missing at {}. Reinstall agent-core deps.",
            dev_claude.display()
        ));
    }
    Ok(AgentPaths {
        sidecar_js: dev_sidecar.to_string_lossy().into_owned(),
        claude_exe: dev_claude.to_string_lossy().into_owned(),
        agent_core_dir: dev_root.to_string_lossy().into_owned(),
    })
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn native_pkg_name() -> &'static str {
    "claude-agent-sdk-darwin-arm64"
}

#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
fn native_pkg_name() -> &'static str {
    "claude-agent-sdk-darwin-x64"
}

#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
fn native_pkg_name() -> &'static str {
    "claude-agent-sdk-linux-x64"
}

#[cfg(all(target_os = "linux", target_arch = "aarch64"))]
fn native_pkg_name() -> &'static str {
    "claude-agent-sdk-linux-arm64"
}

#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
fn native_pkg_name() -> &'static str {
    "claude-agent-sdk-win32-x64"
}

/// Returns true if Apple's `container` CLI is installed and its api-server
/// is running. The frontend uses this to decide whether to default sandbox
/// mode on at first launch.
#[tauri::command]
fn is_container_available() -> bool {
    let result = std::process::Command::new("container")
        .arg("system")
        .arg("status")
        .output();
    match result {
        Ok(out) => {
            if !out.status.success() {
                return false;
            }
            let s = String::from_utf8_lossy(&out.stdout);
            s.contains("running")
        }
        Err(_) => false,
    }
}

/// Snapshot of the container framework's state. Used by the Stats tab.
#[derive(Serialize, Default)]
struct SandboxStats {
    running: bool,
    containers: Vec<serde_json::Value>,
    /// Raw `container system property list` output (TOML-ish lines).
    properties: String,
    /// Raw stdout/stderr from `container list`. Surfaced so the UI can
    /// explain *why* zero containers show up (missing CLI, weird JSON
    /// shape, …) rather than silently showing an empty list.
    list_stdout: String,
    list_stderr: String,
}

#[tauri::command]
fn sandbox_stats() -> SandboxStats {
    let mut s = SandboxStats::default();
    if let Ok(out) = std::process::Command::new("container")
        .args(["system", "status"])
        .output()
    {
        s.running =
            out.status.success() && String::from_utf8_lossy(&out.stdout).contains("running");
    }
    if !s.running {
        return s;
    }
    // `container list` (no -a) returns only active containers. Earlier we
    // used -a and tried to filter by `status == "running"` on the JS side;
    // Apple's status payload doesn't match that exact string in every
    // build, so we now trust the CLI's own running filter.
    if let Ok(out) = std::process::Command::new("container")
        .args(["list", "--format", "json"])
        .output()
    {
        s.list_stdout = String::from_utf8_lossy(&out.stdout).into_owned();
        s.list_stderr = String::from_utf8_lossy(&out.stderr).into_owned();
        if out.status.success() {
            // Apple Container has emitted both bare-array (`[{...}]`) and
            // wrapped (`{"containers":[...]}`) shapes across versions —
            // accept either.
            if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&out.stdout) {
                if let Some(arr) = v.as_array() {
                    s.containers = arr.clone();
                } else if let Some(arr) = v.get("containers").and_then(|x| x.as_array()) {
                    s.containers = arr.clone();
                }
            }
        }
    }
    if let Ok(out) = std::process::Command::new("container")
        .args(["system", "property", "list"])
        .output()
    {
        if out.status.success() {
            s.properties = String::from_utf8_lossy(&out.stdout).into_owned();
        }
    }
    s
}

/// Tauri apps launched from Finder/Launchd inherit a stripped-down PATH that
/// usually doesn't include `/usr/local/bin` or `/opt/homebrew/bin`. Since the
/// app shells out to `node`, `container`, and `npx` (for MCP servers), we have
/// to extend PATH ourselves at startup. We pull the user's interactive shell
/// PATH (`bash -lic 'echo $PATH'`) and merge it with a small set of common
/// install locations.
fn enrich_path() {
    let mut paths: Vec<String> = Vec::new();
    let mut push = |p: &str| {
        if !p.is_empty() && !paths.iter().any(|x| x == p) {
            paths.push(p.to_string());
        }
    };
    for p in &["/usr/local/bin", "/opt/homebrew/bin"] {
        push(p);
    }
    if let Ok(out) = std::process::Command::new("/bin/bash")
        .args(["-lic", "printf %s \"$PATH\""])
        .output()
    {
        if out.status.success() {
            let pathvar = String::from_utf8_lossy(&out.stdout).to_string();
            for p in pathvar.split(':') {
                push(p);
            }
        }
    }
    if let Ok(existing) = std::env::var("PATH") {
        for p in existing.split(':') {
            push(p);
        }
    }
    for p in &["/usr/bin", "/bin", "/usr/sbin", "/sbin"] {
        push(p);
    }
    // Safety: setting PATH at startup is a deliberate, one-time mutation
    // before any threads or tools that depend on it are spawned.
    unsafe {
        std::env::set_var("PATH", paths.join(":"));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    enrich_path();
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            resolve_agent_paths,
            is_container_available,
            sandbox_stats
        ])
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
