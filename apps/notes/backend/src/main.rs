use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use uuid::Uuid;

use zro_sdk::app::ZroApp;

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Note {
    id: String,
    title: String,
    content: String,
    created_at: String,
    updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct NotePreview {
    id: String,
    title: String,
    preview: String,
    updated_at: String,
}

type NotesDb = Arc<RwLock<HashMap<String, Note>>>;

async fn load_notes(data_dir: &std::path::Path) -> HashMap<String, Note> {
    let notes_dir = data_dir.join("notes");
    let _ = tokio::fs::create_dir_all(&notes_dir).await;
    let mut notes = HashMap::new();
    let mut entries = match tokio::fs::read_dir(&notes_dir).await {
        Ok(e) => e,
        Err(_) => return notes,
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            if let Ok(content) = tokio::fs::read_to_string(&path).await {
                if let Ok(note) = serde_json::from_str::<Note>(&content) {
                    notes.insert(note.id.clone(), note);
                }
            }
        }
    }
    notes
}

async fn save_note(data_dir: &std::path::Path, note: &Note) -> Result<(), String> {
    let notes_dir = data_dir.join("notes");
    let _ = tokio::fs::create_dir_all(&notes_dir).await;
    let path = notes_dir.join(format!("{}.json", note.id));
    let json = serde_json::to_string_pretty(note).map_err(|e| e.to_string())?;
    tokio::fs::write(path, json).await.map_err(|e| e.to_string())
}

async fn delete_note_file(data_dir: &std::path::Path, id: &str) -> Result<(), String> {
    let path = data_dir.join("notes").join(format!("{}.json", id));
    if path.exists() {
        tokio::fs::remove_file(path).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let data_dir = PathBuf::from(std::env::var("ZRO_DATA_DIR").unwrap_or_else(|_| "/tmp/zro-notes".into()));
    tokio::fs::create_dir_all(&data_dir).await?;

    let initial_notes = load_notes(&data_dir).await;
    tracing::info!("Loaded {} note(s) from disk", initial_notes.len());
    let db: NotesDb = Arc::new(RwLock::new(initial_notes));

    let app = ZroApp::builder()
        // ── list_notes ──────────────────────────────────────────────
        .command("list_notes", {
            let db = db.clone();
            move |_params, _ctx| {
                let db = db.clone();
                Box::pin(async move {
                    let notes = db.read().await;
                    let mut previews: Vec<NotePreview> = notes.values().map(|n| {
                        NotePreview {
                            id: n.id.clone(),
                            title: n.title.clone(),
                            preview: n.content.chars().take(100).collect(),
                            updated_at: n.updated_at.clone(),
                        }
                    }).collect();
                    previews.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
                    serde_json::to_value(serde_json::json!({ "notes": previews })).map_err(|e| e.to_string())
                })
            }
        })
        // ── get_note ────────────────────────────────────────────────
        .command("get_note", {
            let db = db.clone();
            move |params, _ctx| {
                let db = db.clone();
                Box::pin(async move {
                    #[derive(Deserialize)]
                    struct P { id: String }
                    let p: P = serde_json::from_value(params).map_err(|e| e.to_string())?;
                    let notes = db.read().await;
                    match notes.get(&p.id) {
                        Some(note) => serde_json::to_value(note).map_err(|e| e.to_string()),
                        None => Err("Note not found".into()),
                    }
                })
            }
        })
        // ── create_note ─────────────────────────────────────────────
        .command("create_note", {
            let db = db.clone();
            let dd = data_dir.clone();
            move |params, _ctx| {
                let db = db.clone();
                let dd = dd.clone();
                Box::pin(async move {
                    #[derive(Deserialize)]
                    struct P { title: String, content: String }
                    let p: P = serde_json::from_value(params).map_err(|e| e.to_string())?;
                    let now = Utc::now().to_rfc3339();
                    let note = Note {
                        id: Uuid::new_v4().to_string(),
                        title: p.title,
                        content: p.content,
                        created_at: now.clone(),
                        updated_at: now,
                    };
                    save_note(&dd, &note).await?;
                    let mut notes = db.write().await;
                    notes.insert(note.id.clone(), note.clone());
                    serde_json::to_value(&note).map_err(|e| e.to_string())
                })
            }
        })
        // ── update_note ─────────────────────────────────────────────
        .command("update_note", {
            let db = db.clone();
            let dd = data_dir.clone();
            move |params, _ctx| {
                let db = db.clone();
                let dd = dd.clone();
                Box::pin(async move {
                    #[derive(Deserialize)]
                    struct P { id: String, title: String, content: String }
                    let p: P = serde_json::from_value(params).map_err(|e| e.to_string())?;
                    let mut notes = db.write().await;
                    let note = notes.get_mut(&p.id).ok_or("Note not found")?;
                    note.title = p.title;
                    note.content = p.content;
                    note.updated_at = Utc::now().to_rfc3339();
                    let updated = note.clone();
                    drop(notes);
                    save_note(&dd, &updated).await?;
                    serde_json::to_value(&updated).map_err(|e| e.to_string())
                })
            }
        })
        // ── delete_note ─────────────────────────────────────────────
        .command("delete_note", {
            let db = db.clone();
            let dd = data_dir.clone();
            move |params, _ctx| {
                let db = db.clone();
                let dd = dd.clone();
                Box::pin(async move {
                    #[derive(Deserialize)]
                    struct P { id: String }
                    let p: P = serde_json::from_value(params).map_err(|e| e.to_string())?;
                    let mut notes = db.write().await;
                    if notes.remove(&p.id).is_none() {
                        return Err("Note not found".into());
                    }
                    drop(notes);
                    delete_note_file(&dd, &p.id).await?;
                    Ok(serde_json::json!({ "ok": true }))
                })
            }
        })
        .build()
        .await?;

    app.run().await?;
    Ok(())
}
