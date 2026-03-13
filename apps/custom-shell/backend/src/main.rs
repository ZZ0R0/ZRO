use zro_sdk::app::ZroApp;
use zro_sdk::context::AppContext;
use zro_sdk::modules::dev::{DevModule, LogLevel};
use zro_sdk::modules::ipc::IpcModule;
use zro_sdk::modules::lifecycle::LifecycleModule;
use zro_sdk::modules::notifications::NotificationsModule;
use zro_sdk::modules::state::StateModule;
use zro_sdk::modules::system::SystemModule;
use serde_json::json;
use std::io::Read;

/// Custom Shell backend.
///
/// The shell's real logic lives in the frontend (JS).
/// This backend provides helper commands that your shell can call
/// via `conn.invoke('command_name', { ... })`.
///
/// Add your own commands here as you build out your desktop.

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let app = ZroApp::builder()
        .module(StateModule::new())
        .module(IpcModule::new())
        .module(NotificationsModule::new())
        .module(SystemModule::new())
        .module(DevModule::new().level(LogLevel::Info))
        .module(LifecycleModule::new())
        // ── get_user_info ───────────────────────────────────
        // Returns the current user's session info.
        // Call from frontend: const user = await conn.invoke('get_user_info');
        .command("get_user_info", |_params, ctx: AppContext| {
            Box::pin(async move {
                Ok(json!({
                    "user_id": ctx.session.user_id,
                    "username": ctx.session.username,
                    "role": ctx.session.role,
                    "groups": ctx.session.groups,
                }))
            })
        })
        // ── save_preference ─────────────────────────────────
        // Example: persist a user preference (theme, layout, etc.)
        // Call from frontend: await conn.invoke('save_preference', { key: 'theme', value: 'dark' });
        .command("save_preference", |params, ctx: AppContext| {
            Box::pin(async move {
                let key = params.get("key")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let value = params.get("value").cloned().unwrap_or(json!(null));
                let prefs_path = ctx.data_dir.join("preferences.json");
                let mut prefs: serde_json::Map<String, serde_json::Value> = match tokio::fs::read_to_string(&prefs_path).await {
                    Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
                    Err(_) => serde_json::Map::new(),
                };
                prefs.insert(key.clone(), value.clone());
                let _ = tokio::fs::create_dir_all(&ctx.data_dir).await;
                let _ = tokio::fs::write(&prefs_path, serde_json::to_string_pretty(&prefs).unwrap_or_default()).await;
                tracing::info!(key = %key, "Saved preference");
                Ok(json!({ "ok": true, "key": key, "value": value }))
            })
        })
        //
        // ── get_system_info ─────────────────────────────────
        // Returns CPU, RAM, disk usage and uptime.
        .command("get_system_info", |_params, _ctx: AppContext| {
            Box::pin(async move {
                let cpu = tokio::task::spawn_blocking(read_cpu_usage).await.unwrap_or(0.0);
                let (ram_used, ram_total) = read_mem_info();
                let ram_pct = if ram_total > 0 { (ram_used as f64 / ram_total as f64 * 100.0).round() as u64 } else { 0 };
                let (disk_used, disk_total) = read_disk_info();
                let disk_pct = if disk_total > 0 { (disk_used as f64 / disk_total as f64 * 100.0).round() as u64 } else { 0 };
                let uptime = read_uptime();

                Ok(json!({
                    "cpu": cpu.round() as u64,
                    "ram": ram_pct,
                    "ram_used_mb": ram_used / 1024,
                    "ram_total_mb": ram_total / 1024,
                    "disk": disk_pct,
                    "uptime": uptime,
                }))
            })
        })
        //
        .build()
        .await?;

    app.run().await?;

    Ok(())
}

/// Read CPU usage by sampling /proc/stat twice with 200ms interval.
fn read_cpu_usage() -> f64 {
    fn read_stat() -> Option<(u64, u64)> {
        let mut buf = String::new();
        std::fs::File::open("/proc/stat").ok()?.read_to_string(&mut buf).ok()?;
        let line = buf.lines().next()?;
        let fields: Vec<u64> = line.split_whitespace().skip(1).filter_map(|s| s.parse().ok()).collect();
        if fields.len() < 4 { return None; }
        let idle = fields[3];
        let total: u64 = fields.iter().sum();
        Some((idle, total))
    }

    let (idle1, total1) = read_stat().unwrap_or((0, 0));
    std::thread::sleep(std::time::Duration::from_millis(200));
    let (idle2, total2) = read_stat().unwrap_or((0, 0));

    let d_total = total2.saturating_sub(total1);
    let d_idle = idle2.saturating_sub(idle1);
    if d_total == 0 { return 0.0; }
    (1.0 - d_idle as f64 / d_total as f64) * 100.0
}

/// Read memory from /proc/meminfo. Returns (used_kb, total_kb).
fn read_mem_info() -> (u64, u64) {
    let mut buf = String::new();
    if std::fs::File::open("/proc/meminfo").and_then(|mut f| f.read_to_string(&mut buf)).is_err() {
        return (0, 0);
    }
    let mut total = 0u64;
    let mut available = 0u64;
    for line in buf.lines() {
        if line.starts_with("MemTotal:") {
            total = line.split_whitespace().nth(1).and_then(|s| s.parse().ok()).unwrap_or(0);
        } else if line.starts_with("MemAvailable:") {
            available = line.split_whitespace().nth(1).and_then(|s| s.parse().ok()).unwrap_or(0);
        }
    }
    (total.saturating_sub(available), total)
}

/// Read disk usage from `df` output. Returns (used_bytes, total_bytes).
fn read_disk_info() -> (u64, u64) {
    let output = std::process::Command::new("df")
        .args(["-B1", "/"])
        .output();
    match output {
        Ok(out) => {
            let text = String::from_utf8_lossy(&out.stdout);
            if let Some(line) = text.lines().nth(1) {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 4 {
                    let total: u64 = parts[1].parse().unwrap_or(0);
                    let used: u64 = parts[2].parse().unwrap_or(0);
                    return (used, total);
                }
            }
            (0, 0)
        }
        Err(_) => (0, 0),
    }
}

/// Read system uptime from /proc/uptime.
fn read_uptime() -> String {
    let mut buf = String::new();
    if std::fs::File::open("/proc/uptime").and_then(|mut f| f.read_to_string(&mut buf)).is_err() {
        return "–".to_string();
    }
    let secs: u64 = buf.split_whitespace()
        .next()
        .and_then(|s| s.parse::<f64>().ok())
        .map(|f| f as u64)
        .unwrap_or(0);
    let days = secs / 86400;
    let hours = (secs % 86400) / 3600;
    let mins = (secs % 3600) / 60;
    if days > 0 {
        format!("{}d {}h", days, hours)
    } else if hours > 0 {
        format!("{}h {}m", hours, mins)
    } else {
        format!("{}m", mins)
    }
}
