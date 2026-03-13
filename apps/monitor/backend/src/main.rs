use zro_sdk::app::ZroApp;
use zro_sdk::context::AppContext;
use zro_sdk::modules::dev::{DevModule, LogLevel};
use zro_sdk::modules::ipc::IpcModule;
use zro_sdk::modules::lifecycle::LifecycleModule;
use zro_sdk::modules::notifications::NotificationsModule;
use zro_sdk::modules::system::SystemModule;
use serde_json::json;
use std::io::Read;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let app = ZroApp::builder()
        .module(IpcModule::new())
        .module(NotificationsModule::new())
        .module(SystemModule::new())
        .module(DevModule::new().level(LogLevel::Info))
        .module(LifecycleModule::new())
        .command("get_cpu_usage", |_params, _ctx: AppContext| {
            Box::pin(async move {
                tokio::task::spawn_blocking(|| {
                    let snap1 = read_cpu_stats();
                    std::thread::sleep(std::time::Duration::from_millis(200));
                    let snap2 = read_cpu_stats();
                    let mut cores: Vec<serde_json::Value> = Vec::new();
                    for (i, (a, b)) in snap1.iter().zip(snap2.iter()).enumerate() {
                        let total_d = (b.0 - a.0) as f64;
                        let idle_d = (b.1 - a.1) as f64;
                        let usage = if total_d > 0.0 { ((total_d - idle_d) / total_d * 100.0).round() } else { 0.0 };
                        cores.push(json!({"core": i, "usage": usage}));
                    }
                    let overall = if !cores.is_empty() {
                        cores.iter().filter_map(|c| c["usage"].as_f64()).sum::<f64>() / cores.len() as f64
                    } else { 0.0 };
                    Ok(json!({"overall": overall.round(), "cores": cores}))
                }).await.unwrap()
            })
        })
        .command("get_memory_info", |_params, _ctx: AppContext| {
            Box::pin(async move {
                let mut buf = String::new();
                std::fs::File::open("/proc/meminfo")
                    .and_then(|mut f| f.read_to_string(&mut buf)).ok();
                let mut total = 0u64;
                let mut avail = 0u64;
                let mut buffers = 0u64;
                let mut cached = 0u64;
                let mut swap_total = 0u64;
                let mut swap_free = 0u64;
                for line in buf.lines() {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 2 {
                        let val: u64 = parts[1].parse().unwrap_or(0);
                        match parts[0] {
                            "MemTotal:" => total = val,
                            "MemAvailable:" => avail = val,
                            "Buffers:" => buffers = val,
                            "Cached:" => cached = val,
                            "SwapTotal:" => swap_total = val,
                            "SwapFree:" => swap_free = val,
                            _ => {}
                        }
                    }
                }
                let used = total.saturating_sub(avail);
                Ok(json!({
                    "total_mb": total / 1024,
                    "used_mb": used / 1024,
                    "available_mb": avail / 1024,
                    "buffers_mb": buffers / 1024,
                    "cached_mb": cached / 1024,
                    "swap_total_mb": swap_total / 1024,
                    "swap_used_mb": swap_total.saturating_sub(swap_free) / 1024,
                    "percent": if total > 0 { (used as f64 / total as f64 * 100.0).round() } else { 0.0 },
                }))
            })
        })
        .command("get_disk_usage", |_params, _ctx: AppContext| {
            Box::pin(async move {
                let out = std::process::Command::new("df")
                    .args(["-B1", "--output=target,size,used,avail,pcent"])
                    .output()
                    .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
                    .unwrap_or_default();
                let mut disks: Vec<serde_json::Value> = Vec::new();
                for line in out.lines().skip(1) {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 5 {
                        let mount = parts[0];
                        if mount.starts_with('/') {
                            disks.push(json!({
                                "mount": mount,
                                "total_gb": parts[1].parse::<u64>().unwrap_or(0) as f64 / 1e9,
                                "used_gb": parts[2].parse::<u64>().unwrap_or(0) as f64 / 1e9,
                                "available_gb": parts[3].parse::<u64>().unwrap_or(0) as f64 / 1e9,
                                "percent": parts[4].trim_end_matches('%').parse::<f64>().unwrap_or(0.0),
                            }));
                        }
                    }
                }
                Ok(json!(disks))
            })
        })
        .command("get_processes", |_params, _ctx: AppContext| {
            Box::pin(async move {
                tokio::task::spawn_blocking(|| {
                    let out = std::process::Command::new("ps")
                        .args(["aux", "--sort=-pcpu"])
                        .output()
                        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
                        .unwrap_or_default();
                    let mut procs: Vec<serde_json::Value> = Vec::new();
                    for line in out.lines().skip(1).take(100) {
                        let parts: Vec<&str> = line.split_whitespace().collect();
                        if parts.len() >= 11 {
                            procs.push(json!({
                                "user": parts[0],
                                "pid": parts[1].parse::<u32>().unwrap_or(0),
                                "cpu": parts[2].parse::<f64>().unwrap_or(0.0),
                                "mem": parts[3].parse::<f64>().unwrap_or(0.0),
                                "vsz": parts[4].parse::<u64>().unwrap_or(0),
                                "rss": parts[5].parse::<u64>().unwrap_or(0),
                                "state": parts[7],
                                "command": parts[10..].join(" "),
                            }));
                        }
                    }
                    Ok(json!(procs))
                }).await.unwrap()
            })
        })
        .command("get_load_average", |_params, _ctx: AppContext| {
            Box::pin(async move {
                let mut buf = String::new();
                std::fs::File::open("/proc/loadavg")
                    .and_then(|mut f| f.read_to_string(&mut buf)).ok();
                let parts: Vec<&str> = buf.split_whitespace().collect();
                Ok(json!({
                    "load1": parts.first().and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0),
                    "load5": parts.get(1).and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0),
                    "load15": parts.get(2).and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0),
                }))
            })
        })
        .build()
        .await?;

    app.run().await?;
    Ok(())
}

/// Returns Vec<(total_ticks, idle_ticks)> per CPU core
fn read_cpu_stats() -> Vec<(u64, u64)> {
    let mut buf = String::new();
    let _ = std::fs::File::open("/proc/stat").and_then(|mut f| f.read_to_string(&mut buf));
    let mut cores = Vec::new();
    for line in buf.lines() {
        if line.starts_with("cpu") && line.chars().nth(3).map_or(false, |c| c.is_ascii_digit()) {
            let vals: Vec<u64> = line.split_whitespace().skip(1)
                .filter_map(|v| v.parse().ok()).collect();
            if vals.len() >= 4 {
                let total: u64 = vals.iter().sum();
                let idle = vals[3];
                cores.push((total, idle));
            }
        }
    }
    cores
}
