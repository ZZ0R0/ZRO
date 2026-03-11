//! zro-app-tasks — Task manager with Kanban board (v2).

use std::path::PathBuf;
use std::sync::Arc;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use uuid::Uuid;

use zro_sdk::app::{EventEmitter, ZroApp};
use zro_sdk::context::AppContext;

// ── Data models ─────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Task {
    id: String,
    title: String,
    description: String,
    status: String,
    priority: String,
    category: String,
    due_date: Option<String>,
    created_at: String,
    updated_at: String,
    created_by: String,
    position: i32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Category {
    id: String,
    name: String,
    color: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct TasksData {
    tasks: Vec<Task>,
    categories: Vec<Category>,
}

type Db = Arc<RwLock<TasksData>>;

// ── Persistence ─────────────────────────────────────────────────────────────

async fn load_data(data_dir: &std::path::Path) -> TasksData {
    let path = data_dir.join("tasks.json");
    match tokio::fs::read_to_string(&path).await {
        Ok(content) => serde_json::from_str(&content).unwrap_or_else(|_| default_data()),
        Err(_) => default_data(),
    }
}

fn default_data() -> TasksData {
    TasksData {
        tasks: vec![Task {
            id: Uuid::new_v4().to_string(),
            title: "Bienvenue dans Tasks !".into(),
            description: "Ceci est votre premier tableau Kanban.".into(),
            status: "todo".into(),
            priority: "medium".into(),
            category: "default".into(),
            due_date: None,
            created_at: Utc::now().to_rfc3339(),
            updated_at: Utc::now().to_rfc3339(),
            created_by: "system".into(),
            position: 0,
        }],
        categories: vec![
            Category { id: "default".into(), name: "Général".into(), color: "#89b4fa".into() },
            Category { id: "bug".into(), name: "Bug".into(), color: "#f38ba8".into() },
            Category { id: "feature".into(), name: "Fonctionnalité".into(), color: "#a6e3a1".into() },
            Category { id: "docs".into(), name: "Documentation".into(), color: "#f9e2af".into() },
        ],
    }
}

async fn save_data(data_dir: &std::path::Path, data: &TasksData) {
    let _ = tokio::fs::create_dir_all(data_dir).await;
    let path = data_dir.join("tasks.json");
    if let Ok(json) = serde_json::to_string_pretty(data) {
        let _ = tokio::fs::write(path, json).await;
    }
}

/// Broadcast a tasks:changed event via emitter
async fn broadcast_change(emitter: &EventEmitter, action: &str, payload: serde_json::Value) {
    let _ = emitter
        .emit("tasks:changed", serde_json::json!({ "action": action, "data": payload }))
        .await;
}

// ── Main ────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let data_dir = PathBuf::from(std::env::var("ZRO_DATA_DIR").unwrap_or_else(|_| "/tmp/zro-tasks".into()));
    tokio::fs::create_dir_all(&data_dir).await?;

    let initial = load_data(&data_dir).await;
    tracing::info!("Tasks app loaded {} task(s), {} category(-ies)", initial.tasks.len(), initial.categories.len());
    let db: Db = Arc::new(RwLock::new(initial));

    // We need the emitter for broadcasting; set after build
    let emitter_holder: Arc<tokio::sync::OnceCell<EventEmitter>> = Arc::new(tokio::sync::OnceCell::new());

    let app = ZroApp::builder()
        // ── list_tasks ──────────────────────────────────────────────
        .command("list_tasks", {
            let db = db.clone();
            move |_params, _ctx| {
                let db = db.clone();
                Box::pin(async move {
                    let data = db.read().await;
                    serde_json::to_value(serde_json::json!({
                        "tasks": data.tasks,
                        "categories": data.categories,
                    })).map_err(|e| e.to_string())
                })
            }
        })
        // ── create_task ─────────────────────────────────────────────
        .command("create_task", {
            let db = db.clone();
            let dd = data_dir.clone();
            let eh = emitter_holder.clone();
            move |params, ctx: AppContext| {
                let db = db.clone();
                let dd = dd.clone();
                let eh = eh.clone();
                Box::pin(async move {
                    #[derive(Deserialize)]
                    struct P {
                        title: String,
                        #[serde(default)] description: String,
                        #[serde(default = "def_status")] status: String,
                        #[serde(default = "def_priority")] priority: String,
                        #[serde(default)] category: String,
                        #[serde(default)] due_date: Option<String>,
                    }
                    fn def_status() -> String { "todo".into() }
                    fn def_priority() -> String { "medium".into() }

                    let p: P = serde_json::from_value(params).map_err(|e| e.to_string())?;
                    let mut data = db.write().await;
                    let position = data.tasks.iter().filter(|t| t.status == p.status).count() as i32;
                    let task = Task {
                        id: Uuid::new_v4().to_string(),
                        title: p.title, description: p.description, status: p.status,
                        priority: p.priority, category: p.category, due_date: p.due_date,
                        created_at: Utc::now().to_rfc3339(), updated_at: Utc::now().to_rfc3339(),
                        created_by: ctx.session.username.clone(), position,
                    };
                    data.tasks.push(task.clone());
                    save_data(&dd, &data).await;
                    drop(data);
                    if let Some(em) = eh.get() {
                        broadcast_change(em, "created", serde_json::to_value(&task).unwrap_or_default()).await;
                    }
                    serde_json::to_value(&task).map_err(|e| e.to_string())
                })
            }
        })
        // ── update_task ─────────────────────────────────────────────
        .command("update_task", {
            let db = db.clone();
            let dd = data_dir.clone();
            let eh = emitter_holder.clone();
            move |params, _ctx| {
                let db = db.clone();
                let dd = dd.clone();
                let eh = eh.clone();
                Box::pin(async move {
                    #[derive(Deserialize)]
                    struct P {
                        id: String,
                        #[serde(default)] title: Option<String>,
                        #[serde(default)] description: Option<String>,
                        #[serde(default)] status: Option<String>,
                        #[serde(default)] priority: Option<String>,
                        #[serde(default)] category: Option<String>,
                        #[serde(default)] due_date: Option<Option<String>>,
                        #[serde(default)] position: Option<i32>,
                    }
                    let p: P = serde_json::from_value(params).map_err(|e| e.to_string())?;
                    let mut data = db.write().await;
                    let task = data.tasks.iter_mut().find(|t| t.id == p.id).ok_or("Task not found")?;
                    if let Some(v) = p.title { task.title = v; }
                    if let Some(v) = p.description { task.description = v; }
                    if let Some(v) = p.status { task.status = v; }
                    if let Some(v) = p.priority { task.priority = v; }
                    if let Some(v) = p.category { task.category = v; }
                    if let Some(v) = p.due_date { task.due_date = v; }
                    if let Some(v) = p.position { task.position = v; }
                    task.updated_at = Utc::now().to_rfc3339();
                    let task_clone = task.clone();
                    save_data(&dd, &data).await;
                    drop(data);
                    if let Some(em) = eh.get() {
                        broadcast_change(em, "updated", serde_json::to_value(&task_clone).unwrap_or_default()).await;
                    }
                    serde_json::to_value(&task_clone).map_err(|e| e.to_string())
                })
            }
        })
        // ── delete_task ─────────────────────────────────────────────
        .command("delete_task", {
            let db = db.clone();
            let dd = data_dir.clone();
            let eh = emitter_holder.clone();
            move |params, _ctx| {
                let db = db.clone();
                let dd = dd.clone();
                let eh = eh.clone();
                Box::pin(async move {
                    #[derive(Deserialize)]
                    struct P { id: String }
                    let p: P = serde_json::from_value(params).map_err(|e| e.to_string())?;
                    let mut data = db.write().await;
                    let len_before = data.tasks.len();
                    data.tasks.retain(|t| t.id != p.id);
                    let removed = data.tasks.len() < len_before;
                    save_data(&dd, &data).await;
                    drop(data);
                    if let Some(em) = eh.get() {
                        broadcast_change(em, "deleted", serde_json::json!({ "task_id": p.id })).await;
                    }
                    Ok(serde_json::json!({ "ok": true, "removed": removed }))
                })
            }
        })
        // ── move_task ───────────────────────────────────────────────
        .command("move_task", {
            let db = db.clone();
            let dd = data_dir.clone();
            let eh = emitter_holder.clone();
            move |params, _ctx| {
                let db = db.clone();
                let dd = dd.clone();
                let eh = eh.clone();
                Box::pin(async move {
                    #[derive(Deserialize)]
                    struct P { id: String, status: String, position: i32 }
                    let p: P = serde_json::from_value(params).map_err(|e| e.to_string())?;
                    let mut data = db.write().await;
                    let task = data.tasks.iter_mut().find(|t| t.id == p.id).ok_or("Task not found")?;
                    task.status = p.status;
                    task.position = p.position;
                    task.updated_at = Utc::now().to_rfc3339();
                    let task_clone = task.clone();
                    save_data(&dd, &data).await;
                    drop(data);
                    if let Some(em) = eh.get() {
                        broadcast_change(em, "moved", serde_json::to_value(&task_clone).unwrap_or_default()).await;
                    }
                    serde_json::to_value(&task_clone).map_err(|e| e.to_string())
                })
            }
        })
        // ── list_categories ─────────────────────────────────────────
        .command("list_categories", {
            let db = db.clone();
            move |_params, _ctx| {
                let db = db.clone();
                Box::pin(async move {
                    let data = db.read().await;
                    serde_json::to_value(serde_json::json!({ "categories": data.categories }))
                        .map_err(|e| e.to_string())
                })
            }
        })
        // ── create_category ─────────────────────────────────────────
        .command("create_category", {
            let db = db.clone();
            let dd = data_dir.clone();
            move |params, _ctx| {
                let db = db.clone();
                let dd = dd.clone();
                Box::pin(async move {
                    #[derive(Deserialize)]
                    struct P { name: String, color: String }
                    let p: P = serde_json::from_value(params).map_err(|e| e.to_string())?;
                    let cat = Category {
                        id: Uuid::new_v4().to_string(),
                        name: p.name,
                        color: p.color,
                    };
                    let mut data = db.write().await;
                    data.categories.push(cat.clone());
                    save_data(&dd, &data).await;
                    serde_json::to_value(&cat).map_err(|e| e.to_string())
                })
            }
        })
        // ── Lifecycle ───────────────────────────────────────────────
        .on("client:connected", |ctx: AppContext| {
            async move {
                tracing::info!("Tasks client connected: {:?}", ctx.instance_id);
            }
        })
        .on("client:disconnected", |ctx: AppContext| {
            async move {
                tracing::info!("Tasks client disconnected: {:?}", ctx.instance_id);
            }
        })
        .build()
        .await?;

    // Set emitter for broadcasting
    let _ = emitter_holder.set(app.emitter());

    tracing::info!("Tasks app ready");
    app.run().await?;
    Ok(())
}
