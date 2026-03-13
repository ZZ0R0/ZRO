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

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let app = ZroApp::builder()
        .module(StateModule::new())
        .module(IpcModule::new())
        .module(NotificationsModule::new())
        .module(SystemModule::new())
        .module(DevModule::new().level(LogLevel::Info))
        .module(LifecycleModule::new())
        .command("get_settings", |_params, ctx: AppContext| {
            Box::pin(async move {
                Ok(json!({
                    "user_id": ctx.session.user_id,
                    "username": ctx.session.username,
                    "role": ctx.session.role,
                }))
            })
        })
        .command("get_system_about", |_params, _ctx: AppContext| {
            Box::pin(async move {
                let hostname = read_file_trimmed("/etc/hostname");
                let kernel = read_cmd_output("uname", &["-r"]);
                let arch = read_cmd_output("uname", &["-m"]);
                let uptime = read_uptime_str();
                let os_name = read_os_name();
                Ok(json!({
                    "hostname": hostname,
                    "kernel": kernel,
                    "arch": arch,
                    "uptime": uptime,
                    "os": os_name,
                    "runtime_version": env!("CARGO_PKG_VERSION"),
                }))
            })
        })
        .command("get_available_themes", |_params, _ctx: AppContext| {
            Box::pin(async move {
                Ok(json!([
                    {"id":"catppuccin-mocha","name":"Catppuccin Mocha","type":"dark"},
                    {"id":"catppuccin-latte","name":"Catppuccin Latte","type":"light"},
                    {"id":"nord","name":"Nord","type":"dark"},
                    {"id":"dracula","name":"Dracula","type":"dark"},
                    {"id":"tokyo-night","name":"Tokyo Night","type":"dark"},
                    {"id":"gruvbox-dark","name":"Gruvbox Dark","type":"dark"},
                    {"id":"solarized-dark","name":"Solarized Dark","type":"dark"},
                    {"id":"solarized-light","name":"Solarized Light","type":"light"},
                ]))
            })
        })
        .build()
        .await?;

    app.run().await?;
    Ok(())
}

fn read_file_trimmed(path: &str) -> String {
    let mut buf = String::new();
    if std::fs::File::open(path).and_then(|mut f| f.read_to_string(&mut buf)).is_ok() {
        buf.trim().to_string()
    } else {
        "unknown".to_string()
    }
}

fn read_cmd_output(cmd: &str, args: &[&str]) -> String {
    std::process::Command::new(cmd)
        .args(args)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_else(|_| "unknown".to_string())
}

fn read_uptime_str() -> String {
    let mut buf = String::new();
    if std::fs::File::open("/proc/uptime").and_then(|mut f| f.read_to_string(&mut buf)).is_err() {
        return "unknown".to_string();
    }
    let secs: u64 = buf.split_whitespace().next()
        .and_then(|s| s.parse::<f64>().ok())
        .map(|f| f as u64).unwrap_or(0);
    let d = secs / 86400;
    let h = (secs % 86400) / 3600;
    let m = (secs % 3600) / 60;
    if d > 0 { format!("{}d {}h {}m", d, h, m) }
    else if h > 0 { format!("{}h {}m", h, m) }
    else { format!("{}m", m) }
}

fn read_os_name() -> String {
    let mut buf = String::new();
    if std::fs::File::open("/etc/os-release").and_then(|mut f| f.read_to_string(&mut buf)).is_ok() {
        for line in buf.lines() {
            if line.starts_with("PRETTY_NAME=") {
                return line.trim_start_matches("PRETTY_NAME=").trim_matches('"').to_string();
            }
        }
    }
    "Linux".to_string()
}
