use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::Mutex;

use zro_protocol::messages::{write_message, EventEmitPayload, EventTarget, IpcMessage};
use zro_protocol::types::SessionInfo;

/// Context provided to every command handler, event handler, and lifecycle hook.
///
/// Provides access to session info, the IPC writer for emitting events, and app metadata.
///
/// - In WS invoke / WS event handlers: `instance_id` is `Some(...)`.
/// - In HTTP API handlers: `instance_id` is `None`.
#[derive(Clone)]
pub struct AppContext {
    pub session: SessionInfo,
    pub instance_id: Option<String>,
    pub slug: String,
    pub data_dir: PathBuf,
    writer: Arc<Mutex<tokio::net::unix::OwnedWriteHalf>>,
}

impl AppContext {
    pub(crate) fn new(
        session: SessionInfo,
        instance_id: Option<String>,
        slug: String,
        data_dir: PathBuf,
        writer: Arc<Mutex<tokio::net::unix::OwnedWriteHalf>>,
    ) -> Self {
        Self {
            session,
            instance_id,
            slug,
            data_dir,
            writer,
        }
    }

    /// Emit an event to a specific client instance.
    pub async fn emit_to(
        &self,
        instance_id: &str,
        event: &str,
        payload: serde_json::Value,
    ) -> Result<(), crate::app::ZroSdkError> {
        let emit = EventEmitPayload {
            event: event.to_string(),
            payload,
            target: EventTarget::Instance {
                instance_id: instance_id.to_string(),
            },
        };
        let msg = IpcMessage::new("EventEmit", serde_json::to_value(emit)?);
        let mut w = self.writer.lock().await;
        write_message(&mut *w, &msg).await?;
        Ok(())
    }

    /// Broadcast an event to all connected clients of this app.
    pub async fn emit(
        &self,
        event: &str,
        payload: serde_json::Value,
    ) -> Result<(), crate::app::ZroSdkError> {
        let emit = EventEmitPayload {
            event: event.to_string(),
            payload,
            target: EventTarget::Broadcast,
        };
        let msg = IpcMessage::new("EventEmit", serde_json::to_value(emit)?);
        let mut w = self.writer.lock().await;
        write_message(&mut *w, &msg).await?;
        Ok(())
    }
}

impl std::fmt::Debug for AppContext {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AppContext")
            .field("session", &self.session)
            .field("instance_id", &self.instance_id)
            .field("slug", &self.slug)
            .finish()
    }
}
