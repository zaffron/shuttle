use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

// ---------------------------------------------------------------------------
// Config model
// ---------------------------------------------------------------------------

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Bastion {
    aws_profile: String,
    region: String,
    instance_id: String,
    os_user: String,
    identity_file: String,
    public_key_file: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Tunnel {
    id: String,
    name: String,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    bastion: Bastion,
    tunnels: Vec<Tunnel>,
}

impl Default for Config {
    fn default() -> Self {
        // Placeholder defaults shown on first run. Edit the bastion settings and
        // add your own tunnels in the app — the config is persisted to the app
        // config directory, not to this file.
        Config {
            bastion: Bastion {
                aws_profile: "default".into(),
                region: "us-east-1".into(),
                instance_id: "i-0000000000000000".into(),
                os_user: "ec2-user".into(),
                identity_file: "~/.ssh/id_ed25519".into(),
                public_key_file: "~/.ssh/id_ed25519.pub".into(),
            },
            tunnels: vec![Tunnel {
                id: "example".into(),
                name: "Example — Redis".into(),
                local_port: 16379,
                remote_host: "redis.internal.example.com".into(),
                remote_port: 6379,
            }],
        }
    }
}

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

struct AppState {
    config: Mutex<Config>,
    config_path: PathBuf,
    running: Mutex<HashMap<String, Child>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LogEvent {
    id: String,
    line: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExitEvent {
    id: String,
    code: Option<i32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TunnelStatus {
    id: String,
    running: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EnvCheck {
    aws: bool,
    ssh: bool,
    session_manager_plugin: bool,
}

// ---------------------------------------------------------------------------
// Helpers: paths, binaries, PATH augmentation
// ---------------------------------------------------------------------------

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn expand_tilde(p: &str) -> PathBuf {
    if p == "~" {
        return home_dir().unwrap_or_else(|| PathBuf::from(p));
    }
    if let Some(rest) = p.strip_prefix("~/") {
        if let Some(home) = home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(p)
}

// GUI apps launched from Finder inherit a minimal PATH that omits Homebrew, so
// build an augmented PATH that includes the common install locations. This lets
// `ssh` find `aws`, and `aws` find `session-manager-plugin`, at runtime.
fn augmented_path() -> String {
    let extra = [
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ];
    let mut parts: Vec<String> = std::env::var("PATH")
        .unwrap_or_default()
        .split(':')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();
    for d in extra {
        if !parts.iter().any(|p| p == d) {
            parts.push(d.to_string());
        }
    }
    parts.join(":")
}

fn find_binary(name: &str) -> Option<PathBuf> {
    for dir in augmented_path().split(':') {
        if dir.is_empty() {
            continue;
        }
        let candidate = PathBuf::from(dir).join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Config persistence
// ---------------------------------------------------------------------------

fn load_config(path: &PathBuf) -> Config {
    if let Ok(bytes) = std::fs::read(path) {
        if let Ok(cfg) = serde_json::from_slice::<Config>(&bytes) {
            return cfg;
        }
    }
    Config::default()
}

fn write_config(path: &PathBuf, cfg: &Config) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Tunnel process control
// ---------------------------------------------------------------------------

fn push_ssh_key(b: &Bastion) -> Result<(), String> {
    let aws = find_binary("aws").ok_or_else(|| "aws CLI not found on PATH".to_string())?;
    let key = expand_tilde(&b.public_key_file);
    if !key.is_file() {
        return Err(format!("public key not found: {}", key.display()));
    }
    let out = Command::new(&aws)
        .args([
            "ec2-instance-connect",
            "send-ssh-public-key",
            "--profile",
            &b.aws_profile,
            "--region",
            &b.region,
            "--instance-id",
            &b.instance_id,
            "--instance-os-user",
            &b.os_user,
            "--ssh-public-key",
            &format!("file://{}", key.display()),
        ])
        .env("PATH", augmented_path())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("failed to run aws: {e}"))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(stderr.trim().to_string());
    }
    Ok(())
}

#[tauri::command]
fn check_environment() -> EnvCheck {
    EnvCheck {
        aws: find_binary("aws").is_some(),
        ssh: find_binary("ssh").is_some(),
        session_manager_plugin: find_binary("session-manager-plugin").is_some(),
    }
}

// List the AWS profiles configured on this machine (`aws configure list-profiles`).
// Returns an empty list if the aws CLI is missing or no profiles are configured.
#[tauri::command]
fn aws_profiles() -> Vec<String> {
    let Some(aws) = find_binary("aws") else {
        return Vec::new();
    };
    let output = Command::new(&aws)
        .args(["configure", "list-profiles"])
        .env("PATH", augmented_path())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output();
    match output {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout)
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect(),
        _ => Vec::new(),
    }
}

#[tauri::command]
fn get_config(state: State<AppState>) -> Config {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
fn save_config(state: State<AppState>, config: Config) -> Result<(), String> {
    write_config(&state.config_path, &config)?;
    *state.config.lock().unwrap() = config;
    Ok(())
}

#[tauri::command]
fn test_connection(state: State<AppState>) -> Result<(), String> {
    let bastion = state.config.lock().unwrap().bastion.clone();
    push_ssh_key(&bastion)
}

#[tauri::command]
fn start_tunnel(app: AppHandle, state: State<AppState>, id: String) -> Result<(), String> {
    {
        let running = state.running.lock().unwrap();
        if running.contains_key(&id) {
            return Err("Tunnel is already running".into());
        }
    }

    let (bastion, tunnel) = {
        let cfg = state.config.lock().unwrap();
        let t = cfg
            .tunnels
            .iter()
            .find(|t| t.id == id)
            .cloned()
            .ok_or_else(|| "Tunnel not found".to_string())?;
        (cfg.bastion.clone(), t)
    };

    // 1. Push the SSH public key (valid ~60s) via EC2 Instance Connect. Well this is how I do it as
    //    of now.
    push_ssh_key(&bastion).map_err(|e| format!("send-ssh-public-key failed: {e}"))?;

    // 2. Spawn ssh -N -L, tunnelling through the SSM ProxyCommand. The command is
    //    constructed explicitly so it does not depend on ~/.ssh/config.
    let ssh = find_binary("ssh").unwrap_or_else(|| PathBuf::from("/usr/bin/ssh"));
    let aws = find_binary("aws").ok_or_else(|| "aws CLI not found on PATH".to_string())?;
    let identity = expand_tilde(&bastion.identity_file);
    let proxy = format!(
        "{} ssm start-session --profile {} --region {} --target %h --document-name AWS-StartSSHSession --parameters portNumber=%p",
        aws.display(),
        bastion.aws_profile,
        bastion.region
    );
    let forward = format!(
        "{}:{}:{}",
        tunnel.local_port, tunnel.remote_host, tunnel.remote_port
    );
    let target = format!("{}@{}", bastion.os_user, bastion.instance_id);

    let mut child = Command::new(&ssh)
        .args([
            "-i",
            &identity.display().to_string(),
            "-N",
            "-o",
            &format!("ProxyCommand={proxy}"),
            "-o",
            "StrictHostKeyChecking=accept-new",
            "-o",
            "UserKnownHostsFile=/dev/null",
            "-o",
            "ExitOnForwardFailure=yes",
            "-o",
            "ServerAliveInterval=30",
            "-o",
            "ServerAliveCountMax=3",
            "-L",
            &forward,
            &target,
        ])
        .env("PATH", augmented_path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn ssh: {e}"))?;

    // Stream ssh stderr (and stdout) lines back to the UI as log events. Maybe I will implement
    // some better logging but I have never seen any logs appear when I run them directly on the CLI
    // anyway.
    stream_output(&app, &id, &mut child);

    state.running.lock().unwrap().insert(id.clone(), child);
    let _ = app.emit(
        "tunnel-log",
        LogEvent {
            id,
            line: "Tunnel started.".into(),
        },
    );
    Ok(())
}

enum Pipe {
    Err(std::process::ChildStderr),
    Out(std::process::ChildStdout),
}

// Forward a child's stdout/stderr to the UI as `tunnel-log` events tagged with `id`.
fn stream_output(app: &AppHandle, id: &str, child: &mut Child) {
    for pipe in [
        child.stderr.take().map(Pipe::Err),
        child.stdout.take().map(Pipe::Out),
    ]
    .into_iter()
    .flatten()
    {
        let app = app.clone();
        let id = id.to_string();
        std::thread::spawn(move || {
            let reader: Box<dyn BufRead + Send> = match pipe {
                Pipe::Err(s) => Box::new(BufReader::new(s)),
                Pipe::Out(s) => Box::new(BufReader::new(s)),
            };
            for line in reader.lines().map_while(Result::ok) {
                let _ = app.emit(
                    "tunnel-log",
                    LogEvent {
                        id: id.clone(),
                        line,
                    },
                );
            }
        });
    }
}

// Run `aws sso login` for the configured profile. Opens the browser for the SSO
// flow and blocks until the user completes (or cancels) it.
#[tauri::command]
fn sso_login(app: AppHandle, state: State<AppState>) -> Result<(), String> {
    let profile = state.config.lock().unwrap().bastion.aws_profile.clone();
    let aws = find_binary("aws").ok_or_else(|| "aws CLI not found on PATH".to_string())?;

    let _ = app.emit(
        "tunnel-log",
        LogEvent {
            id: "sso".into(),
            line: format!("aws sso login --profile {profile}"),
        },
    );

    let mut child = Command::new(&aws)
        .args(["sso", "login", "--profile", &profile])
        .env("PATH", augmented_path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to run aws sso login: {e}"))?;

    stream_output(&app, "sso", &mut child);

    let status = child.wait().map_err(|e| e.to_string())?;
    if status.success() {
        let _ = app.emit(
            "tunnel-log",
            LogEvent {
                id: "sso".into(),
                line: "Signed in.".into(),
            },
        );
        Ok(())
    } else {
        Err("aws sso login failed — see logs".into())
    }
}

#[tauri::command]
fn stop_tunnel(app: AppHandle, state: State<AppState>, id: String) -> Result<(), String> {
    let child = state.running.lock().unwrap().remove(&id);
    match child {
        Some(mut c) => {
            let _ = c.kill();
            let _ = c.wait();
            let _ = app.emit(
                "tunnel-log",
                LogEvent {
                    id: id.clone(),
                    line: "Tunnel stopped.".into(),
                },
            );
            let _ = app.emit("tunnel-exited", ExitEvent { id, code: None });
            Ok(())
        }
        None => Err("Tunnel is not running".into()),
    }
}

// Polled by the UI. Reaps any ssh process that exited on its own (e.g. auth
// failure or dropped connection) and reports the live running set.
#[tauri::command]
fn tunnel_states(app: AppHandle, state: State<AppState>) -> Vec<TunnelStatus> {
    let mut running = state.running.lock().unwrap();
    let mut exited: Vec<(String, Option<i32>)> = Vec::new();

    for (id, child) in running.iter_mut() {
        if let Ok(Some(status)) = child.try_wait() {
            exited.push((id.clone(), status.code()));
        }
    }
    for (id, code) in &exited {
        running.remove(id);
        let _ = app.emit(
            "tunnel-exited",
            ExitEvent {
                id: id.clone(),
                code: *code,
            },
        );
    }

    let cfg = state.config.lock().unwrap();
    cfg.tunnels
        .iter()
        .map(|t| TunnelStatus {
            id: t.id.clone(),
            running: running.contains_key(&t.id),
        })
        .collect()
}

fn kill_all(state: &AppState) {
    let mut running = state.running.lock().unwrap();
    for (_, mut child) in running.drain() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            let config_path = dir.join("config.json");
            let config = load_config(&config_path);
            // Persist the seeded default on first run so the file exists to edit.
            let _ = write_config(&config_path, &config);
            app.manage(AppState {
                config: Mutex::new(config),
                config_path,
                running: Mutex::new(HashMap::new()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_environment,
            aws_profiles,
            get_config,
            save_config,
            test_connection,
            sso_login,
            start_tunnel,
            stop_tunnel,
            tunnel_states
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<AppState>() {
                    kill_all(&state);
                }
            }
        });
}
