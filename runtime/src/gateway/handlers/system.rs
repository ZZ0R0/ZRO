//! System information API handler.
//!
//! Routes:
//!   GET /api/system/info — System metrics (CPU, memory, load, uptime, disk)

use axum::{
    extract::State,
    response::{Json, Response, IntoResponse},
};
use serde_json::json;

use crate::gateway::state::AppState;

/// GET /api/system/info — system metrics parsed from /proc and statvfs.
pub async fn system_info(
    State(state): State<AppState>,
) -> Response {
    let uptime = state.start_time.elapsed().as_secs();

    // Gather system info in a blocking task since we read /proc files
    let info = tokio::task::spawn_blocking(|| gather_system_info())
        .await
        .unwrap_or_else(|_| json!({"error": "task_failed"}));

    let mut result = info;
    if let Some(obj) = result.as_object_mut() {
        obj.insert("runtime_uptime_secs".to_string(), json!(uptime));
        obj.insert("connections".to_string(), json!(state.ws_manager.connection_count().await));
    }

    Json(json!({"ok": true, "system": result})).into_response()
}

fn gather_system_info() -> serde_json::Value {
    let mut info = serde_json::Map::new();

    // Uptime from /proc/uptime
    if let Ok(content) = std::fs::read_to_string("/proc/uptime") {
        if let Some(secs_str) = content.split_whitespace().next() {
            if let Ok(secs) = secs_str.parse::<f64>() {
                info.insert("uptime_secs".into(), json!(secs as u64));
            }
        }
    }

    // Load average from /proc/loadavg
    if let Ok(content) = std::fs::read_to_string("/proc/loadavg") {
        let parts: Vec<&str> = content.split_whitespace().collect();
        if parts.len() >= 3 {
            info.insert("load_avg".into(), json!({
                "1m": parts[0].parse::<f64>().unwrap_or(0.0),
                "5m": parts[1].parse::<f64>().unwrap_or(0.0),
                "15m": parts[2].parse::<f64>().unwrap_or(0.0),
            }));
        }
    }

    // Memory from /proc/meminfo
    if let Ok(content) = std::fs::read_to_string("/proc/meminfo") {
        let mut mem_total: u64 = 0;
        let mut mem_available: u64 = 0;
        let mut swap_total: u64 = 0;
        let mut swap_free: u64 = 0;

        for line in content.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 {
                let kb = parts[1].parse::<u64>().unwrap_or(0);
                match parts[0] {
                    "MemTotal:" => mem_total = kb,
                    "MemAvailable:" => mem_available = kb,
                    "SwapTotal:" => swap_total = kb,
                    "SwapFree:" => swap_free = kb,
                    _ => {}
                }
            }
        }

        info.insert("memory".into(), json!({
            "total_kb": mem_total,
            "available_kb": mem_available,
            "used_kb": mem_total.saturating_sub(mem_available),
            "usage_pct": if mem_total > 0 { ((mem_total - mem_available) as f64 / mem_total as f64 * 100.0).round() } else { 0.0 },
        }));

        info.insert("swap".into(), json!({
            "total_kb": swap_total,
            "free_kb": swap_free,
            "used_kb": swap_total.saturating_sub(swap_free),
        }));
    }

    // Hostname
    if let Ok(hostname) = std::fs::read_to_string("/etc/hostname") {
        info.insert("hostname".into(), json!(hostname.trim()));
    }

    // Disk usage: parse df output for portability (no libc dependency needed)
    if let Ok(output) = std::process::Command::new("df").args(["-B1", "/"]).output() {
        if let Ok(text) = String::from_utf8(output.stdout) {
            // Skip header line, parse the data line
            if let Some(line) = text.lines().nth(1) {
                let parts: Vec<&str> = line.split_whitespace().collect();
                // df -B1 format: Filesystem 1B-blocks Used Available Use% Mounted
                if parts.len() >= 5 {
                    let total = parts[1].parse::<u64>().unwrap_or(0);
                    let used = parts[2].parse::<u64>().unwrap_or(0);
                    let available = parts[3].parse::<u64>().unwrap_or(0);
                    info.insert("disk".into(), json!({
                        "total_bytes": total,
                        "used_bytes": used,
                        "available_bytes": available,
                        "usage_pct": if total > 0 { (used as f64 / total as f64 * 100.0).round() } else { 0.0 },
                    }));
                }
            }
        }
    }

    serde_json::Value::Object(info)
}
