use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{RwLock, oneshot};

use zro_protocol::messages::IpcMessage;

use crate::ipc::channel::IpcChannel;

/// Routes IPC messages to/from backends and manages pending requests.
#[derive(Clone)]
pub struct IpcRouter {
    /// app_id -> IPC channel
    channels: Arc<RwLock<HashMap<String, IpcChannel>>>,
    /// message_id -> oneshot sender for request/response correlation
    pending: Arc<RwLock<HashMap<String, oneshot::Sender<IpcMessage>>>>,
}

impl Default for IpcRouter {
    fn default() -> Self {
        Self::new()
    }
}

impl IpcRouter {
    pub fn new() -> Self {
        Self {
            channels: Arc::new(RwLock::new(HashMap::new())),
            pending: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Register a channel for an app.
    pub async fn register(&self, app_id: &str, channel: IpcChannel) {
        let mut channels = self.channels.write().await;
        channels.insert(app_id.to_string(), channel);
    }

    /// Remove a channel.
    pub async fn unregister(&self, app_id: &str) {
        let mut channels = self.channels.write().await;
        channels.remove(app_id);
    }

    /// Get the channel for an app.
    pub async fn get_channel(&self, app_id: &str) -> Option<IpcChannel> {
        let channels = self.channels.read().await;
        channels.get(app_id).cloned()
    }

    /// Send a request and wait for the correlated response.
    pub async fn send_request(
        &self,
        app_id: &str,
        msg: IpcMessage,
        timeout: std::time::Duration,
    ) -> anyhow::Result<IpcMessage> {
        let msg_id = msg.id.clone();

        // Create oneshot channel for the response
        let (tx, rx) = oneshot::channel();
        {
            let mut pending = self.pending.write().await;
            pending.insert(msg_id.clone(), tx);
        }

        // Send the request
        let channel = self.get_channel(app_id).await
            .ok_or_else(|| anyhow::anyhow!("No IPC channel for app {}", app_id))?;
        channel.send(&msg).await?;

        // Wait for response with timeout
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(response)) => Ok(response),
            Ok(Err(_)) => {
                self.cleanup_pending(&msg_id).await;
                Err(anyhow::anyhow!("Response channel closed for message {}", msg_id))
            }
            Err(_) => {
                self.cleanup_pending(&msg_id).await;
                Err(anyhow::anyhow!("Timeout waiting for response to message {}", msg_id))
            }
        }
    }

    /// Deliver a response to a pending request.
    pub async fn deliver_response(&self, msg: IpcMessage) -> bool {
        let mut pending = self.pending.write().await;
        if let Some(tx) = pending.remove(&msg.id) {
            tx.send(msg).is_ok()
        } else {
            false
        }
    }

    /// Clean up a pending request.
    async fn cleanup_pending(&self, msg_id: &str) {
        let mut pending = self.pending.write().await;
        pending.remove(msg_id);
    }

    /// Send a fire-and-forget message (no response expected).
    pub async fn send_message(
        &self,
        app_id: &str,
        msg: &IpcMessage,
    ) -> anyhow::Result<()> {
        let channel = self.get_channel(app_id).await
            .ok_or_else(|| anyhow::anyhow!("No IPC channel for app {}", app_id))?;
        channel.send(msg).await?;
        Ok(())
    }
}
