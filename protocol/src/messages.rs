use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::types::SessionInfo;

// ═══════════════════════════════════════════════════════════════
// ZRO IPC Protocol — Message Types
//
// Three normalized communication channels:
//
// 1. WS invoke (req/resp):
//    Client → conn.invoke(cmd, params)
//    → Runtime → IPC CommandRequest → Backend
//    ← Backend → IPC CommandResponse → Runtime → WS response
//
// 2. WS event (fire-and-forget / push):
//    Client → conn.emit(event, data)
//    → Runtime → IPC WsMessage → Backend (fire-and-forget)
//    Backend → IPC EventEmit → Runtime → WS {type:"event"}
//
// 3. HTTP API (req/resp):
//    Client → fetch(/{slug}/api/...)
//    → Runtime → IPC HttpRequest → Backend
//    ← Backend → IPC HttpResponse → Runtime → HTTP response
//
// Lifecycle: ClientConnected, ClientDisconnected, ClientReconnected
// Admin: Hello/HelloAck, Shutdown/ShutdownAck, Log
// ═══════════════════════════════════════════════════════════════

/// Envelope wrapping all IPC messages.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct IpcMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub id: String,
    pub timestamp: String,
    pub payload: serde_json::Value,
}

impl IpcMessage {
    /// Create a new IPC message with auto-generated id and timestamp.
    pub fn new(msg_type: &str, payload: serde_json::Value) -> Self {
        Self {
            msg_type: msg_type.to_string(),
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            payload,
        }
    }

    /// Create a reply message that shares the same id as the original.
    pub fn reply(original_id: &str, msg_type: &str, payload: serde_json::Value) -> Self {
        Self {
            msg_type: msg_type.to_string(),
            id: original_id.to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            payload,
        }
    }
}

// ── Handshake ───────────────────────────────────────────────────

/// Hello handshake from backend → runtime.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HelloPayload {
    pub slug: String,
    pub app_version: String,
    pub protocol_version: u32,
}

// ── HTTP channel (req/resp) ─────────────────────────────────────

/// HTTP response from backend → runtime.
/// Sent in reply to HttpRequest (correlated by msg.id).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HttpResponsePayload {
    pub status: u16,
    pub headers: HashMap<String, String>,
    /// Base64-encoded body.
    pub body: Option<String>,
}

// ── Shutdown ────────────────────────────────────────────────────

/// Shutdown acknowledgement from backend → runtime.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ShutdownAckPayload {
    pub status: String,
}

// ── Logging ─────────────────────────────────────────────────────

/// Log message from backend → runtime.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LogPayload {
    pub level: String,
    pub message: String,
    #[serde(default)]
    pub fields: HashMap<String, serde_json::Value>,
}

/// HelloAck from runtime → backend.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HelloAckPayload {
    pub status: String,
    pub runtime_version: String,
}

// ── HTTP channel (req/resp) — runtime → backend ────────────────

/// HTTP request proxied from client, runtime → backend.
/// Backend must reply with HttpResponse (correlated by msg.id).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HttpRequestPayload {
    pub method: String,
    pub path: String,
    pub headers: HashMap<String, String>,
    pub query: HashMap<String, String>,
    /// Base64-encoded body, null if no body.
    pub body: Option<String>,
    pub session: SessionInfo,
}

// ── WS event channel — client emit → backend (fire-and-forget) ─

/// WS event relayed from client to backend (via conn.emit()).
/// This is fire-and-forget — no response expected.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WsInPayload {
    pub instance_id: String,
    pub session: SessionInfo,
    pub event: String,
    pub data: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
}

// ── Lifecycle notifications — runtime → backend ────────────────

/// Client connected notification, runtime → backend.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ClientConnectedPayload {
    pub instance_id: String,
    pub session: SessionInfo,
}

/// Client disconnected notification, runtime → backend.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ClientDisconnectedPayload {
    pub instance_id: String,
    pub reason: String,
}

/// Client reconnected notification, runtime → backend.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ClientReconnectedPayload {
    pub instance_id: String,
    pub session: SessionInfo,
}

/// Shutdown request from runtime → backend.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ShutdownPayload {
    pub reason: String,
    pub grace_period_ms: u64,
}

// ── WS invoke channel (req/resp) ────────────────────────────────

/// Command request from runtime → backend.
/// Sent when a client calls `conn.invoke(command, params)`.
/// Backend must reply with CommandResponse (correlated by msg.id).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CommandRequestPayload {
    pub command: String,
    pub params: serde_json::Value,
    pub session: SessionInfo,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance_id: Option<String>,
}

/// Command response from backend → runtime.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CommandResponsePayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ── WS event channel — backend → client (push) ────────────────

/// Event emitted by backend → runtime → client.
/// Use EventTarget::Instance for targeted delivery,
/// EventTarget::Broadcast for all connected clients.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EventEmitPayload {
    pub event: String,
    pub payload: serde_json::Value,
    pub target: EventTarget,
}

/// Target for an emitted event.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum EventTarget {
    /// Send to a specific instance.
    #[serde(rename = "instance")]
    Instance { instance_id: String },
    /// Broadcast to all connected clients of this app.
    #[serde(rename = "broadcast")]
    Broadcast,
    /// Broadcast to all apps within a specific user session.
    /// Used for cross-app system events (theme change, clipboard, lock…).
    #[serde(rename = "session")]
    Session { session_id: String },
    /// Broadcast to every connected client of every app (system-wide).
    /// Only the runtime or the shell should use this.
    #[serde(rename = "system")]
    System,
}

// ── Framing helpers ─────────────────────────────────────────────

use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::constants::MAX_MESSAGE_SIZE;

/// Write a length-prefixed JSON message to a writer.
pub async fn write_message<W: AsyncWriteExt + Unpin>(
    writer: &mut W,
    msg: &IpcMessage,
) -> Result<(), crate::errors::ProtocolError> {
    let json = serde_json::to_vec(msg)?;
    let len = json.len();
    if len > MAX_MESSAGE_SIZE {
        return Err(crate::errors::ProtocolError::MessageTooLarge { size: len, max: MAX_MESSAGE_SIZE });
    }
    writer.write_all(&(len as u32).to_be_bytes()).await?;
    writer.write_all(&json).await?;
    writer.flush().await?;
    Ok(())
}

/// Read a length-prefixed JSON message from a reader.
pub async fn read_message<R: AsyncReadExt + Unpin>(
    reader: &mut R,
) -> Result<IpcMessage, crate::errors::ProtocolError> {
    let mut len_buf = [0u8; 4];
    reader.read_exact(&mut len_buf).await?;
    let len = u32::from_be_bytes(len_buf) as usize;
    if len > MAX_MESSAGE_SIZE {
        return Err(crate::errors::ProtocolError::MessageTooLarge { size: len, max: MAX_MESSAGE_SIZE });
    }
    let mut buf = vec![0u8; len];
    reader.read_exact(&mut buf).await?;
    let msg: IpcMessage = serde_json::from_slice(&buf)?;
    Ok(msg)
}
