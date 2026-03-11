use zro_sdk::app::ZroApp;
use zro_sdk::context::AppContext;
use serde_json::json;

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
        .command("save_preference", |params, _ctx: AppContext| {
            Box::pin(async move {
                let key = params.get("key")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let value = params.get("value").cloned().unwrap_or(json!(null));
                // TODO: persist to disk using ctx.data_dir or a database
                tracing::info!(key = %key, "Saved preference");
                Ok(json!({ "ok": true, "key": key, "value": value }))
            })
        })
        //
        // ── Add your own commands below ─────────────────────
        // .command("my_command", |params, ctx: AppContext| {
        //     Box::pin(async move {
        //         Ok(json!({ "hello": "world" }))
        //     })
        // })
        //
        .build()
        .await?;

    app.run().await?;

    Ok(())
}
