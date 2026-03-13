//! System module — expose Linux system metrics to the frontend.
//!
//! Provides commands for querying CPU, memory, disk and uptime info.
//! Useful for system-monitoring dashboards and the shell's status bar.
//!
//! # Example
//!
//! ```ignore
//! use zro_sdk::modules::system::SystemModule;
//!
//! app.module(SystemModule::new());
//!
//! // From frontend:
//! // conn.invoke('__sys:info', {})
//! // conn.invoke('__sys:processes', { limit: 20 })
//! ```

use crate::module::{ModuleMeta, ModuleRegistrar, ZroModule};

/// System metrics module.
pub struct SystemModule;

impl SystemModule {
    pub fn new() -> Self {
        Self
    }
}

impl Default for SystemModule {
    fn default() -> Self {
        Self::new()
    }
}

impl ZroModule for SystemModule {
    fn meta(&self) -> ModuleMeta {
        ModuleMeta {
            name: "system".into(),
            version: "0.1.0".into(),
            description: Some("Linux system metrics".to_string()),
            dependencies: vec![],
        }
    }

    fn register(&self, registrar: &mut ModuleRegistrar) {
        registrar.command("__sys:info", |_params, _ctx| {
            Box::pin(async move { cmd_sys_info().await })
        });
        registrar.command("__sys:processes", |params, _ctx| {
            Box::pin(async move { cmd_processes(params).await })
        });
    }
}

async fn cmd_sys_info() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(gather_sys_info)
        .await
        .map_err(|e| format!("task error: {}", e))?
}

fn gather_sys_info() -> Result<serde_json::Value, String> {
    let mut info = serde_json::Map::new();

    // Uptime
    if let Ok(content) = std::fs::read_to_string("/proc/uptime") {
        if let Some(secs_str) = content.split_whitespace().next() {
            if let Ok(secs) = secs_str.parse::<f64>() {
                info.insert("uptime_secs".into(), serde_json::json!(secs as u64));
            }
        }
    }

    // Load average
    if let Ok(content) = std::fs::read_to_string("/proc/loadavg") {
        let parts: Vec<&str> = content.split_whitespace().collect();
        if parts.len() >= 3 {
            info.insert("load_avg".into(), serde_json::json!({
                "1m": parts[0].parse::<f64>().unwrap_or(0.0),
                "5m": parts[1].parse::<f64>().unwrap_or(0.0),
                "15m": parts[2].parse::<f64>().unwrap_or(0.0),
            }));
        }
    }

    // Memory
    if let Ok(content) = std::fs::read_to_string("/proc/meminfo") {
        let mut mem_total: u64 = 0;
        let mut mem_available: u64 = 0;

        for line in content.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 {
                let kb = parts[1].parse::<u64>().unwrap_or(0);
                match parts[0] {
                    "MemTotal:" => mem_total = kb,
                    "MemAvailable:" => mem_available = kb,
                    _ => {}
                }
            }
        }

        info.insert("memory".into(), serde_json::json!({
            "total_kb": mem_total,
            "available_kb": mem_available,
            "used_kb": mem_total.saturating_sub(mem_available),
            "usage_pct": if mem_total > 0 { ((mem_total - mem_available) as f64 / mem_total as f64 * 100.0).round() } else { 0.0 },
        }));
    }

    // Hostname
    if let Ok(hostname) = std::fs::read_to_string("/etc/hostname") {
        info.insert("hostname".into(), serde_json::json!(hostname.trim()));
    }

    Ok(serde_json::Value::Object(info))
}

async fn cmd_processes(params: serde_json::Value) -> Result<serde_json::Value, String> {
    let limit = params.get("limit").and_then(|v| v.as_u64()).unwrap_or(20) as usize;

    tokio::task::spawn_blocking(move || gather_processes(limit))
        .await
        .map_err(|e| format!("task error: {}", e))?
}

fn gather_processes(limit: usize) -> Result<serde_json::Value, String> {
    let mut procs = Vec::new();

    let dir = std::fs::read_dir("/proc").map_err(|e| format!("readdir /proc: {}", e))?;

    for entry in dir.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();

        // Only PID directories (numeric names)
        if !name_str.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }

        let pid: u32 = match name_str.parse() {
            Ok(p) => p,
            Err(_) => continue,
        };

        let stat_path = entry.path().join("stat");
        let status_path = entry.path().join("status");

        // Read comm from stat (field 2)
        let comm = std::fs::read_to_string(&stat_path)
            .ok()
            .and_then(|s| {
                let start = s.find('(')?;
                let end = s.rfind(')')?;
                Some(s[start + 1..end].to_string())
            })
            .unwrap_or_default();

        // Read VmRSS from status
        let rss_kb: u64 = std::fs::read_to_string(&status_path)
            .ok()
            .and_then(|s| {
                s.lines()
                    .find(|l| l.starts_with("VmRSS:"))
                    .and_then(|l| l.split_whitespace().nth(1))
                    .and_then(|v| v.parse().ok())
            })
            .unwrap_or(0);

        procs.push((pid, comm, rss_kb));
    }

    // Sort by RSS descending
    procs.sort_by(|a, b| b.2.cmp(&a.2));
    procs.truncate(limit);

    let result: Vec<serde_json::Value> = procs
        .into_iter()
        .map(|(pid, comm, rss_kb)| {
            serde_json::json!({
                "pid": pid,
                "name": comm,
                "rss_kb": rss_kb,
            })
        })
        .collect();

    Ok(serde_json::json!({ "processes": result }))
}
