use zro_sdk::app::ZroApp;
use zro_sdk::context::AppContext;
use serde_json::json;

/// Shell backend — minimal, the real logic is in the frontend.
/// Provides commands for listing available apps and user info.

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let app = ZroApp::builder()
        .command("get_apps", |_params, _ctx: AppContext| {
            Box::pin(async move {
                // The Shell frontend fetches the app list from /api/apps.
                Ok(json!({"status": "use /api/apps endpoint"}))
            })
        })
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
        .build()
        .await?;

    app.run().await?;

    Ok(())
}
