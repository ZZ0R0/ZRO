use zro_sdk::app::ZroApp;
use zro_sdk::context::AppContext;
use zro_sdk::modules::dev::{DevModule, LogLevel};
use zro_sdk::modules::ipc::IpcModule;
use zro_sdk::modules::lifecycle::LifecycleModule;
use zro_sdk::modules::notifications::NotificationsModule;
use zro_sdk::modules::state::StateModule;
use serde_json::json;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let app = ZroApp::builder()
        .module(StateModule::new())
        .module(IpcModule::new())
        .module(NotificationsModule::new())
        .module(DevModule::new().level(LogLevel::Info))
        .module(LifecycleModule::new())
        .command("get_bookmarks", |_params, ctx: AppContext| {
            Box::pin(async move {
                let data = load_json(&ctx.data_dir, "bookmarks.json").await;
                Ok(data)
            })
        })
        .command("add_bookmark", |params, ctx: AppContext| {
            Box::pin(async move {
                let url = params["url"].as_str().unwrap_or("").to_string();
                let title = params["title"].as_str().unwrap_or(&url).to_string();
                let favicon = params["favicon"].as_str().unwrap_or("").to_string();
                let bookmark = json!({
                    "id": uuid_simple(),
                    "url": url,
                    "title": title,
                    "favicon": favicon,
                });
                let mut bookmarks = load_json(&ctx.data_dir, "bookmarks.json").await;
                let arr = bookmarks.as_array_mut().unwrap();
                arr.push(bookmark.clone());
                save_json(&ctx.data_dir, "bookmarks.json", &bookmarks).await;
                Ok(bookmark)
            })
        })
        .command("remove_bookmark", |params, ctx: AppContext| {
            Box::pin(async move {
                let id = params["id"].as_str().unwrap_or("").to_string();
                let mut bookmarks = load_json(&ctx.data_dir, "bookmarks.json").await;
                let arr = bookmarks.as_array_mut().unwrap();
                arr.retain(|b| b["id"].as_str() != Some(&id));
                save_json(&ctx.data_dir, "bookmarks.json", &bookmarks).await;
                Ok(json!({"ok": true}))
            })
        })
        .command("get_history", |params, ctx: AppContext| {
            Box::pin(async move {
                let limit = params["limit"].as_u64().unwrap_or(50) as usize;
                let history = load_json(&ctx.data_dir, "history.json").await;
                let arr = history.as_array().unwrap();
                let slice: Vec<_> = arr.iter().rev().take(limit).cloned().collect();
                Ok(json!(slice))
            })
        })
        .command("add_history_entry", |params, ctx: AppContext| {
            Box::pin(async move {
                let url = params["url"].as_str().unwrap_or("").to_string();
                let title = params["title"].as_str().unwrap_or("").to_string();
                let ts = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default().as_secs();
                let entry = json!({
                    "url": url,
                    "title": title,
                    "visited_at": ts,
                });
                let mut history = load_json(&ctx.data_dir, "history.json").await;
                let arr = history.as_array_mut().unwrap();
                if arr.len() >= 500 {
                    arr.drain(0..arr.len() - 499);
                }
                arr.push(entry.clone());
                save_json(&ctx.data_dir, "history.json", &history).await;
                Ok(entry)
            })
        })
        .command("clear_history", |_params, ctx: AppContext| {
            Box::pin(async move {
                save_json(&ctx.data_dir, "history.json", &json!([])).await;
                Ok(json!({"ok": true}))
            })
        })
        .build()
        .await?;

    app.run().await?;
    Ok(())
}

async fn load_json(data_dir: &std::path::Path, name: &str) -> serde_json::Value {
    let path = data_dir.join(name);
    match tokio::fs::read_to_string(&path).await {
        Ok(content) => serde_json::from_str(&content).unwrap_or_else(|_| json!([])),
        Err(_) => json!([]),
    }
}

async fn save_json(data_dir: &std::path::Path, name: &str, value: &serde_json::Value) {
    let path = data_dir.join(name);
    let _ = tokio::fs::create_dir_all(data_dir).await;
    let _ = tokio::fs::write(&path, serde_json::to_string_pretty(value).unwrap_or_default()).await;
}

fn uuid_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    format!("{:x}-{:x}", t.as_secs(), t.subsec_nanos())
}
