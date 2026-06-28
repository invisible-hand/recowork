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

/// Returns true if a docker daemon is reachable. The frontend uses this to
/// decide whether to default sandbox mode on at first launch.
#[tauri::command]
fn is_docker_available() -> bool {
    let result = std::process::Command::new("docker")
        .arg("info")
        .arg("--format")
        .arg("{{.ServerVersion}}")
        .output();
    match result {
        Ok(out) => out.status.success(),
        Err(_) => false,
    }
}

/// Tauri apps launched from Finder/Launchd inherit a stripped-down PATH that
/// usually doesn't include `/usr/local/bin` or `/opt/homebrew/bin`. Since the
/// app shells out to `node`, `docker`, and `npx` (for MCP servers), we have
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
            is_docker_available
        ])
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
