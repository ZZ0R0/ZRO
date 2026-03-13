use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use axum::{
    extract::{
        ws::{Message, WebSocket},
        State, WebSocketUpgrade,
    },
    http::StatusCode,
    response::{IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use tokio::sync::{mpsc, RwLock};

use zro_protocol::messages::*;
use zro_protocol::types::SessionInfo;

use crate::gateway::state::AppState;
use crate::session::Session;

// ── Instance info tracked per registered app instance ──────────────────

/// Information about a registered app instance within a WS session.
#[derive(Clone, Debug)]
pub struct InstanceInfo {
    pub app_slug: String,
    pub registered_at: Instant,
}

/// A single WebSocket session — one per browser tab / iframe that connects to /ws.
struct WsSession {
    user_id: String,
    ws_sender: mpsc::UnboundedSender<String>,
    instances: HashMap<String, InstanceInfo>,
}

// ── WsSessionManager — multiplexed WS manager ─────────────────────────

/// Manages multiplexed WebSocket sessions.
///
/// Each WS connection (to `/ws`) is a "session". Within a session, the client
/// registers one or more app instances via `{ type: "register", instance, app }`.
/// All messages carry an `instance` field for routing.
///
/// Tracks recently-disconnected instances to detect reconnections.
#[derive(Clone)]
pub struct WsSessionManager {
    sessions: Arc<RwLock<HashMap<String, WsSession>>>,
    /// Instances that were recently disconnected — kept for reconnection detection.
    /// Key: instance_id → (app_id, disconnected_at)
    disconnected_instances: Arc<RwLock<HashMap<String, (String, Instant)>>>,
    /// Direct routing table: instance_id → session_id.
    /// Ensures O(1) lookup and only ONE session can own a given instance at a time.
    instance_routes: Arc<RwLock<HashMap<String, String>>>,
}

impl Default for WsSessionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl WsSessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            disconnected_instances: Arc::new(RwLock::new(HashMap::new())),
            instance_routes: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Register a new WebSocket session.
    pub async fn register_session(
        &self,
        session_id: &str,
        user_id: &str,
        sender: mpsc::UnboundedSender<String>,
    ) {
        let mut sessions = self.sessions.write().await;
        sessions.insert(
            session_id.to_string(),
            WsSession {
                user_id: user_id.to_string(),
                ws_sender: sender,
                instances: HashMap::new(),
            },
        );
    }

    /// Register an app instance within an existing WS session.
    /// Returns `true` if this instance was previously disconnected or was
    /// transferred from another WS session (reconnection / transfer).
    pub async fn register_instance(
        &self,
        session_id: &str,
        instance_id: &str,
        app_slug: &str,
    ) -> bool {
        // Check if this instance was recently disconnected
        let was_disconnected = {
            let mut disc = self.disconnected_instances.write().await;
            disc.remove(instance_id).is_some()
        };

        let mut sessions = self.sessions.write().await;

        // Remove this instance from any OTHER session that currently holds it.
        // This handles the case where multiple WS connections (e.g. SharedWorker
        // + a leftover direct WS from an old tab) both claim the same instance.
        let was_on_other_session = {
            let mut found = false;
            for (sid, session) in sessions.iter_mut() {
                if *sid != session_id && session.instances.remove(instance_id).is_some() {
                    found = true;
                    tracing::debug!(
                        old_session = %sid,
                        new_session = session_id,
                        instance = instance_id,
                        "Instance transferred between WS sessions"
                    );
                    break;
                }
            }
            found
        };

        if let Some(session) = sessions.get_mut(session_id) {
            session.instances.insert(
                instance_id.to_string(),
                InstanceInfo {
                    app_slug: app_slug.to_string(),
                    registered_at: Instant::now(),
                },
            );
        }

        // Update the direct routing table
        drop(sessions); // release sessions lock before taking routes lock
        {
            let mut routes = self.instance_routes.write().await;
            routes.insert(instance_id.to_string(), session_id.to_string());
        }

        was_disconnected || was_on_other_session
    }

    /// Unregister an app instance from a session.
    pub async fn unregister_instance(&self, session_id: &str, instance_id: &str) {
        let mut sessions = self.sessions.write().await;
        if let Some(session) = sessions.get_mut(session_id) {
            session.instances.remove(instance_id);
        }
        drop(sessions);
        {
            let mut routes = self.instance_routes.write().await;
            // Only remove if this session currently owns the route
            if routes.get(instance_id).map(|s| s.as_str()) == Some(session_id) {
                routes.remove(instance_id);
            }
        }
    }

    /// Unregister an entire WS session. Returns the list of (instance_id, app_slug) that were active.
    /// Moves instances to disconnected tracker for potential reconnection.
    pub async fn unregister_session(&self, session_id: &str) -> Vec<(String, String)> {
        let mut sessions = self.sessions.write().await;
        if let Some(session) = sessions.remove(session_id) {
            let now = Instant::now();
            let mut disc = self.disconnected_instances.write().await;
            let result: Vec<(String, String)> = session
                .instances
                .iter()
                .map(|(iid, info)| (iid.clone(), info.app_slug.clone()))
                .collect();

            // Clean up routing table for instances owned by this session
            {
                let mut routes = self.instance_routes.write().await;
                for (iid, _) in &result {
                    if routes.get(iid).map(|s| s.as_str()) == Some(session_id) {
                        routes.remove(iid);
                    }
                }
            }

            // Track as disconnected for reconnection
            for (iid, info) in session.instances {
                disc.insert(iid, (info.app_slug, now));
            }

            result
        } else {
            Vec::new()
        }
    }

    /// Count the number of active WS sessions.
    pub async fn connection_count(&self) -> usize {
        let sessions = self.sessions.read().await;
        sessions.len()
    }

    /// Clean up disconnected instances older than the given duration.
    pub async fn cleanup_disconnected(&self, max_age: std::time::Duration) {
        let mut disc = self.disconnected_instances.write().await;
        let now = Instant::now();
        disc.retain(|_, (_, disconnected_at)| now.duration_since(*disconnected_at) < max_age);
    }

    /// Send a message to a specific instance via the direct routing table.
    pub async fn send_to_instance(&self, instance_id: &str, msg: &serde_json::Value) {
        let text = serde_json::to_string(msg).unwrap_or_default();
        let msg_type = msg.get("type").and_then(|v| v.as_str()).unwrap_or("?");
        let msg_event = msg.get("event").and_then(|v| v.as_str()).unwrap_or("");

        // Fast path: use the direct routing table
        let target_session = {
            let routes = self.instance_routes.read().await;
            routes.get(instance_id).cloned()
        };

        if let Some(ref session_id) = target_session {
            let sessions = self.sessions.read().await;
            if let Some(session) = sessions.get(session_id.as_str()) {
                tracing::debug!(
                    instance = instance_id,
                    session = %session_id,
                    msg_type = msg_type,
                    event = msg_event,
                    "send_to_instance: delivering via route table"
                );
                let _ = session.ws_sender.send(text);
                return;
            } else {
                tracing::warn!(
                    instance = instance_id,
                    session = %session_id,
                    "send_to_instance: route exists but session not found!"
                );
            }
        } else {
            tracing::warn!(
                instance = instance_id,
                msg_type = msg_type,
                "send_to_instance: no route in table, trying fallback scan"
            );
        }

        // Fallback: scan all sessions (shouldn't normally be needed)
        let sessions = self.sessions.read().await;
        for (sid, session) in sessions.iter() {
            if session.instances.contains_key(instance_id) {
                tracing::debug!(
                    instance = instance_id,
                    session = %sid,
                    "send_to_instance: delivering via fallback scan"
                );
                let _ = session.ws_sender.send(text);
                return;
            }
        }

        tracing::warn!(
            instance = instance_id,
            msg_type = msg_type,
            "send_to_instance: instance not found in ANY session!"
        );
    }

    /// Broadcast a message to all instances of a given app (across all sessions).
    pub async fn broadcast_to_app(&self, app_slug: &str, msg: &serde_json::Value) {
        let sessions = self.sessions.read().await;
        let text = serde_json::to_string(msg).unwrap_or_default();
        for session in sessions.values() {
            let has_instance = session
                .instances
                .values()
                .any(|info| info.app_slug == app_slug);
            if has_instance {
                let _ = session.ws_sender.send(text.clone());
            }
        }
    }

    /// Broadcast to all sessions of a specific user.
    pub async fn broadcast_to_user(&self, user_id: &str, msg: &serde_json::Value) {
        let sessions = self.sessions.read().await;
        let text = serde_json::to_string(msg).unwrap_or_default();
        for session in sessions.values() {
            if session.user_id == user_id {
                let _ = session.ws_sender.send(text.clone());
            }
        }
    }

    /// Broadcast to a specific WS session (all apps within that session).
    /// Used for cross-app events scoped to a user session (theme change, clipboard…).
    pub async fn broadcast_to_session(&self, session_id: &str, msg: &serde_json::Value) {
        let sessions = self.sessions.read().await;
        let text = serde_json::to_string(msg).unwrap_or_default();
        if let Some(session) = sessions.get(session_id) {
            let _ = session.ws_sender.send(text);
        }
    }

    /// Broadcast to every connected WS client (system-wide event).
    pub async fn broadcast_to_all(&self, msg: &serde_json::Value) {
        let sessions = self.sessions.read().await;
        let text = serde_json::to_string(msg).unwrap_or_default();
        for session in sessions.values() {
            let _ = session.ws_sender.send(text.clone());
        }
    }

    /// Look up which app slug an instance belongs to.
    pub async fn get_app_for_instance(&self, instance_id: &str) -> Option<String> {
        let sessions = self.sessions.read().await;
        for session in sessions.values() {
            if let Some(info) = session.instances.get(instance_id) {
                return Some(info.app_slug.clone());
            }
        }
        None
    }
}

// ── WebSocket handler — GET /ws ────────────────────────────────────────

/// GET /ws — multiplexed WebSocket upgrade handler.
pub async fn ws_handler(
    State(state): State<AppState>,
    ws: WebSocketUpgrade,
    req: axum::extract::Request,
) -> Response {
    // Extract session from extensions (injected by auth middleware)
    let session = match req.extensions().get::<Session>() {
        Some(s) => s.clone(),
        None => return (StatusCode::UNAUTHORIZED, "No session").into_response(),
    };

    ws.on_upgrade(move |socket| handle_multiplexed_ws(socket, state, session))
}

/// Main WS loop for a multiplexed connection.
async fn handle_multiplexed_ws(
    socket: WebSocket,
    state: AppState,
    session: Session,
) {
    let (mut ws_sink, mut ws_stream) = socket.split();
    let session_info = session.to_session_info();
    let ws_session_id = format!("ws-{}", uuid::Uuid::new_v4());

    // Channel for sending messages back to this client
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    // Register the WS session
    state
        .ws_manager
        .register_session(&ws_session_id, &session.user_id, tx)
        .await;

    tracing::info!(
        ws_session = ws_session_id,
        user = session.username,
        "Multiplexed WebSocket connected"
    );

    // Spawn writer task: channel → WS
    let send_task = tokio::spawn(async move {
        while let Some(text) = rx.recv().await {
            if ws_sink.send(Message::Text(text.into())).await.is_err() {
                break;
            }
        }
    });

    // Reader loop: WS → runtime
    while let Some(Ok(msg)) = ws_stream.next().await {
        match msg {
            Message::Text(text) => {
                let Ok(ws_msg) = serde_json::from_str::<serde_json::Value>(&text) else {
                    continue;
                };
                let msg_type = ws_msg.get("type").and_then(|v| v.as_str()).unwrap_or("");

                match msg_type {
                    // ── Register an app instance ─────────────────
                    "register" => {
                        let instance_id = ws_msg
                            .get("instance")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let app_slug = ws_msg
                            .get("app")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();

                        if instance_id.is_empty() || app_slug.is_empty() {
                            let _ = state
                                .ws_manager
                                .send_to_instance(&instance_id, &json!({
                                    "type": "error",
                                    "error": "register requires 'instance' and 'app' fields",
                                }))
                                .await;
                            continue;
                        }

                        // Look up the app
                        let entry = state.registry.get_by_slug(&app_slug).await;
                        let _entry = match entry {
                            Some(e) => e,
                            None => {
                                send_to_session(&state, &ws_session_id, &json!({
                                    "type": "error",
                                    "instance": instance_id,
                                    "error": format!("App '{}' not found", app_slug),
                                }))
                                .await;
                                continue;
                            }
                        };

                        let is_reconnect = state
                            .ws_manager
                            .register_instance(&ws_session_id, &instance_id, &app_slug)
                            .await;

                        // Notify backend: ClientConnected or ClientReconnected
                        if is_reconnect {
                            let reconnected_msg = IpcMessage::new(
                                "ClientReconnected",
                                serde_json::to_value(ClientReconnectedPayload {
                                    instance_id: instance_id.clone(),
                                    session: session_info.clone(),
                                })
                                .unwrap(),
                            );
                            let _ = state.ipc_router.send_message(&app_slug, &reconnected_msg).await;

                            tracing::debug!(
                                ws_session = ws_session_id,
                                instance = instance_id,
                                app = app_slug,
                                "Instance reconnected"
                            );
                        } else {
                            let connected_msg = IpcMessage::new(
                                "ClientConnected",
                                serde_json::to_value(ClientConnectedPayload {
                                    instance_id: instance_id.clone(),
                                    session: session_info.clone(),
                                })
                                .unwrap(),
                            );
                            let _ = state.ipc_router.send_message(&app_slug, &connected_msg).await;

                            tracing::debug!(
                                ws_session = ws_session_id,
                                instance = instance_id,
                                app = app_slug,
                                "Instance registered"
                            );
                        }

                        // Confirm registration to the client
                        send_to_session(&state, &ws_session_id, &json!({
                            "type": "registered",
                            "instance": instance_id,
                            "app": app_slug,
                            "reconnected": is_reconnect,
                        }))
                        .await;

                        // Send __desktop:init with user context
                        {
                            let mut init_data = json!({
                                "user": {
                                    "user_id": session_info.user_id,
                                    "username": session_info.username,
                                    "role": session_info.role,
                                    "groups": session_info.groups,
                                },
                                "theme": null,
                                "preferences": {},
                                "unread_notifications": 0,
                            });

                            if let Some(ref pref_store) = state.preference_store {
                                if let Ok(prefs) = pref_store.get_all(&session_info.user_id) {
                                    init_data["preferences"] = json!(prefs);
                                    if let Some(theme) = prefs.get("theme") {
                                        init_data["theme"] = json!(theme);
                                    }
                                }
                            }
                            if let Some(ref notif_store) = state.notification_store {
                                if let Ok(count) = notif_store.count_unread(&session_info.user_id) {
                                    init_data["unread_notifications"] = json!(count);
                                }
                            }

                            state.ws_manager.send_to_instance(&instance_id, &json!({
                                "type": "event",
                                "instance": instance_id,
                                "event": "__desktop:init",
                                "payload": init_data,
                            })).await;
                        }
                    }

                    // ── Unregister an app instance ───────────────
                    "unregister" => {
                        let instance_id = ws_msg
                            .get("instance")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();

                        if instance_id.is_empty() {
                            continue;
                        }

                        // Find the app slug for this instance before removing
                        let app_slug = state
                            .ws_manager
                            .get_app_for_instance(&instance_id)
                            .await;

                        state
                            .ws_manager
                            .unregister_instance(&ws_session_id, &instance_id)
                            .await;

                        // Notify backend
                        if let Some(app_slug) = app_slug {
                            let disconnected_msg = IpcMessage::new(
                                "ClientDisconnected",
                                serde_json::to_value(ClientDisconnectedPayload {
                                    instance_id: instance_id.clone(),
                                    reason: "unregistered".to_string(),
                                })
                                .unwrap(),
                            );
                            let _ = state
                                .ipc_router
                                .send_message(&app_slug, &disconnected_msg)
                                .await;
                        }

                        tracing::debug!(
                            ws_session = ws_session_id,
                            instance = instance_id,
                            "Instance unregistered"
                        );
                    }

                    // ── Invoke a command ──────────────────────────
                    "invoke" => {
                        let instance_id = ws_msg
                            .get("instance")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let command = ws_msg
                            .get("command")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let params = ws_msg.get("params").cloned().unwrap_or(json!({}));
                        let client_id = ws_msg
                            .get("id")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();

                        if instance_id.is_empty() || command.is_empty() {
                            state
                                .ws_manager
                                .send_to_instance(
                                    &instance_id,
                                    &json!({
                                        "type": "response",
                                        "id": client_id,
                                        "instance": instance_id,
                                        "error": "invoke requires 'instance' and 'command' fields",
                                    }),
                                )
                                .await;
                            continue;
                        }

                        // Resolve app_slug for this instance
                        let app_slug = {
                            let sessions = state.ws_manager.sessions.read().await;
                            sessions
                                .get(&ws_session_id)
                                .and_then(|s| s.instances.get(&instance_id))
                                .map(|info| info.app_slug.clone())
                                .unwrap_or_default()
                        };

                        // ── Runtime-intercepted commands ─────────────
                        if matches!(
                            command.as_str(),
                            "__state:save"
                                | "__state:restore"
                                | "__state:delete"
                                | "__state:keys"
                                | "__pref:get"
                                | "__pref:set"
                                | "__pref:get_all"
                                | "__notify:list"
                                | "__notify:read"
                                | "__notify:read_all"
                                | "__desktop:app_metadata"
                                | "__desktop:apps_for_mime"
                                | "__desktop:system_info"
                        ) {
                            let ws_resp = handle_internal_command(
                                &command,
                                &params,
                                &session_info,
                                &app_slug,
                                &client_id,
                                &instance_id,
                                &state,
                            )
                            .await;
                            state.ws_manager.send_to_instance(&instance_id, &ws_resp).await;
                            continue;
                        }

                        // ── Permissions check ──────────────────────
                        if !app_slug.is_empty()
                            && !state.permissions.can_access(
                                &session_info.username,
                                &session_info.role,
                                &session_info.groups,
                                &app_slug,
                            )
                        {
                            state
                                .ws_manager
                                .send_to_instance(
                                    &instance_id,
                                    &json!({
                                        "type": "response",
                                        "id": client_id,
                                        "instance": instance_id,
                                        "error": format!("Access denied to {}", app_slug),
                                    }),
                                )
                                .await;
                            continue;
                        }

                        if app_slug.is_empty() {
                            state
                                .ws_manager
                                .send_to_instance(
                                    &instance_id,
                                    &json!({
                                        "type": "response",
                                        "id": client_id,
                                        "instance": instance_id,
                                        "error": "Instance not registered",
                                    }),
                                )
                                .await;
                            continue;
                        }

                        let cmd_payload = CommandRequestPayload {
                            command,
                            params,
                            session: session_info.clone(),
                            instance_id: Some(instance_id.clone()),
                        };

                        let ipc_msg = IpcMessage::new(
                            "CommandRequest",
                            serde_json::to_value(cmd_payload).unwrap(),
                        );

                        let sc = state.clone();
                        let iid = instance_id.clone();
                        let cid = client_id.clone();

                        // Send request and wait for response
                        match sc
                            .ipc_router
                            .send_request(&app_slug, ipc_msg, std::time::Duration::from_secs(30))
                            .await
                        {
                            Ok(resp_msg) => {
                                if let Ok(resp) = serde_json::from_value::<CommandResponsePayload>(
                                    resp_msg.payload,
                                ) {
                                    let ws_resp = if let Some(error) = resp.error {
                                        json!({
                                            "type": "response",
                                            "id": cid,
                                            "instance": iid,
                                            "error": error,
                                        })
                                    } else {
                                        json!({
                                            "type": "response",
                                            "id": cid,
                                            "instance": iid,
                                            "result": resp.result,
                                        })
                                    };
                                    sc.ws_manager.send_to_instance(&iid, &ws_resp).await;
                                }
                            }
                            Err(e) => {
                                let ws_resp = json!({
                                    "type": "response",
                                    "id": cid,
                                    "instance": iid,
                                    "error": format!("Command failed: {}", e),
                                });
                                sc.ws_manager.send_to_instance(&iid, &ws_resp).await;
                            }
                        }
                    }

                    // ── Emit an event to the backend ─────────────
                    "emit" => {
                        let instance_id = ws_msg
                            .get("instance")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let event = ws_msg
                            .get("event")
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown")
                            .to_string();
                        let data = ws_msg.get("data").cloned().unwrap_or(json!(null));
                        let request_id = ws_msg
                            .get("requestId")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());

                        let app_slug = state
                            .ws_manager
                            .get_app_for_instance(&instance_id)
                            .await;

                        if let Some(app_slug) = app_slug {
                            let ipc_payload = WsInPayload {
                                instance_id,
                                session: session_info.clone(),
                                event,
                                data,
                                request_id,
                            };

                            let ipc_msg = IpcMessage::new(
                                "WsMessage",
                                serde_json::to_value(ipc_payload).unwrap(),
                            );
                            if let Err(e) =
                                state.ipc_router.send_message(&app_slug, &ipc_msg).await
                            {
                                tracing::error!(
                                    ws_session = ws_session_id,
                                    "Failed to relay emit to backend: {}",
                                    e
                                );
                            }
                        }
                    }

                    _ => {
                        tracing::debug!(
                            ws_session = ws_session_id,
                            msg_type = msg_type,
                            "Unknown WS message type"
                        );
                    }
                }
            }
            Message::Close(_) => break,
            Message::Ping(data) => {
                // Axum handles pong automatically in most cases
                let _ = data;
            }
            _ => {}
        }
    }

    // ── Cleanup: unregister all instances and notify backends ───────────

    let instances = state
        .ws_manager
        .unregister_session(&ws_session_id)
        .await;

    for (instance_id, app_slug) in &instances {
        let disconnected_msg = IpcMessage::new(
            "ClientDisconnected",
            serde_json::to_value(ClientDisconnectedPayload {
                instance_id: instance_id.clone(),
                reason: "ws_closed".to_string(),
            })
            .unwrap(),
        );
        let _ = state
            .ipc_router
            .send_message(app_slug, &disconnected_msg)
            .await;
    }

    tracing::info!(
        ws_session = ws_session_id,
        instances = instances.len(),
        "Multiplexed WebSocket disconnected"
    );

    send_task.abort();
}

/// Send a raw JSON message to a WS session.
async fn send_to_session(state: &AppState, ws_session_id: &str, msg: &serde_json::Value) {
    let sessions = state.ws_manager.sessions.read().await;
    if let Some(session) = sessions.get(ws_session_id) {
        let text = serde_json::to_string(msg).unwrap_or_default();
        let _ = session.ws_sender.send(text);
    }
}

/// Handle runtime-intercepted commands.
/// Covers __state:*, __pref:*, __notify:*, and __desktop:* families.
async fn handle_internal_command(
    command: &str,
    params: &serde_json::Value,
    session: &SessionInfo,
    app_slug: &str,
    client_id: &str,
    instance_id: &str,
    state: &AppState,
) -> serde_json::Value {
    match command {
        // ── State commands ──────────────────────────────────────────
        "__state:save" | "__state:restore" | "__state:delete" | "__state:keys" => {
            let state_store = match &state.state_store {
                Some(s) => s,
                None => return err_resp(client_id, instance_id, "Storage not available"),
            };
            handle_state_command(command, params, session, app_slug, client_id, instance_id, state_store)
        }

        // ── Preference commands ─────────────────────────────────────
        "__pref:get" => {
            let store = match &state.preference_store {
                Some(s) => s,
                None => return err_resp(client_id, instance_id, "Storage not available"),
            };
            let key = params.get("key").and_then(|v| v.as_str()).unwrap_or("");
            if key.is_empty() {
                return err_resp(client_id, instance_id, "key is required");
            }
            match store.get(&session.user_id, key) {
                Ok(Some(v)) => ok_resp(client_id, instance_id, json!(v)),
                Ok(None) => ok_resp(client_id, instance_id, json!(null)),
                Err(e) => err_resp(client_id, instance_id, &e.to_string()),
            }
        }
        "__pref:set" => {
            let store = match &state.preference_store {
                Some(s) => s,
                None => return err_resp(client_id, instance_id, "Storage not available"),
            };
            let key = params.get("key").and_then(|v| v.as_str()).unwrap_or("");
            let value = params.get("value").and_then(|v| v.as_str()).unwrap_or("");
            if key.is_empty() {
                return err_resp(client_id, instance_id, "key is required");
            }
            match store.set(&session.user_id, key, value) {
                Ok(()) => ok_resp(client_id, instance_id, json!(true)),
                Err(e) => err_resp(client_id, instance_id, &e.to_string()),
            }
        }
        "__pref:get_all" => {
            let store = match &state.preference_store {
                Some(s) => s,
                None => return err_resp(client_id, instance_id, "Storage not available"),
            };
            match store.get_all(&session.user_id) {
                Ok(prefs) => ok_resp(client_id, instance_id, json!(prefs)),
                Err(e) => err_resp(client_id, instance_id, &e.to_string()),
            }
        }

        // ── Notification commands ───────────────────────────────────
        "__notify:list" => {
            let store = match &state.notification_store {
                Some(s) => s,
                None => return err_resp(client_id, instance_id, "Storage not available"),
            };
            let unread_only = params.get("unread_only").and_then(|v| v.as_bool()).unwrap_or(true);
            let limit = params.get("limit").and_then(|v| v.as_u64()).unwrap_or(100) as u32;
            match store.get(&session.user_id, unread_only, limit) {
                Ok(notifs) => {
                    let count = store.count_unread(&session.user_id).unwrap_or(0);
                    ok_resp(client_id, instance_id, json!({"notifications": notifs, "unread_count": count}))
                }
                Err(e) => err_resp(client_id, instance_id, &e.to_string()),
            }
        }
        "__notify:read" => {
            let store = match &state.notification_store {
                Some(s) => s,
                None => return err_resp(client_id, instance_id, "Storage not available"),
            };
            let id = params.get("id").and_then(|v| v.as_str()).unwrap_or("");
            if id.is_empty() {
                return err_resp(client_id, instance_id, "id is required");
            }
            match store.mark_read(id, &session.user_id) {
                Ok(()) => ok_resp(client_id, instance_id, json!(true)),
                Err(e) => err_resp(client_id, instance_id, &e.to_string()),
            }
        }
        "__notify:read_all" => {
            let store = match &state.notification_store {
                Some(s) => s,
                None => return err_resp(client_id, instance_id, "Storage not available"),
            };
            match store.mark_all_read(&session.user_id) {
                Ok(()) => ok_resp(client_id, instance_id, json!(true)),
                Err(e) => err_resp(client_id, instance_id, &e.to_string()),
            }
        }

        // ── Desktop commands ────────────────────────────────────────
        "__desktop:app_metadata" => {
            let metadata = state.registry.all_app_metadata().await;
            ok_resp(client_id, instance_id, json!(metadata))
        }
        "__desktop:apps_for_mime" => {
            let mime = params.get("mime").and_then(|v| v.as_str()).unwrap_or("");
            if mime.is_empty() {
                return err_resp(client_id, instance_id, "mime is required");
            }
            let apps = state.registry.apps_for_mime(mime).await;
            let metadata: Vec<serde_json::Value> = apps.iter().map(|e| {
                let a = &e.manifest.app;
                json!({"slug": a.slug, "name": a.name, "icon": a.icon, "category": format!("{:?}", a.category)})
            }).collect();
            ok_resp(client_id, instance_id, json!(metadata))
        }
        "__desktop:system_info" => {
            let uptime = state.start_time.elapsed().as_secs();
            let connections = state.ws_manager.connection_count().await;
            ok_resp(client_id, instance_id, json!({
                "runtime_uptime_secs": uptime,
                "connections": connections,
            }))
        }

        _ => {
            unreachable!("handle_internal_command called with unexpected command: {}", command)
        }
    }
}

/// Build a success response for WS internal command.
fn ok_resp(client_id: &str, instance_id: &str, result: serde_json::Value) -> serde_json::Value {
    json!({
        "type": "response",
        "id": client_id,
        "instance": instance_id,
        "result": result,
    })
}

/// Build an error response for WS internal command.
fn err_resp(client_id: &str, instance_id: &str, error: &str) -> serde_json::Value {
    json!({
        "type": "response",
        "id": client_id,
        "instance": instance_id,
        "error": error,
    })
}

/// Handle __state:* commands (factored out from the main handler).
fn handle_state_command(
    command: &str,
    params: &serde_json::Value,
    session: &SessionInfo,
    app_slug: &str,
    client_id: &str,
    instance_id: &str,
    state_store: &crate::storage::state_store::StateStore,
) -> serde_json::Value {
    match command {
        "__state:save" => {
            let key = params.get("key").and_then(|v| v.as_str()).unwrap_or("");
            let value = params.get("value").and_then(|v| v.as_str()).unwrap_or("");
            if key.is_empty() {
                return err_resp(client_id, instance_id, "key is required");
            }
            if value.len() > 1_048_576 {
                return err_resp(client_id, instance_id, "value too large (max 1 MiB)");
            }
            match state_store.save(&session.user_id, app_slug, key, value) {
                Ok(()) => ok_resp(client_id, instance_id, json!(true)),
                Err(e) => err_resp(client_id, instance_id, &e.to_string()),
            }
        }
        "__state:restore" => {
            let key = params.get("key").and_then(|v| v.as_str()).unwrap_or("");
            if key.is_empty() {
                return err_resp(client_id, instance_id, "key is required");
            }
            match state_store.restore(&session.user_id, app_slug, key) {
                Ok(Some(val)) => ok_resp(client_id, instance_id, json!(val)),
                Ok(None) => ok_resp(client_id, instance_id, json!(null)),
                Err(e) => err_resp(client_id, instance_id, &e.to_string()),
            }
        }
        "__state:delete" => {
            let key = params.get("key").and_then(|v| v.as_str()).unwrap_or("");
            if key.is_empty() {
                return err_resp(client_id, instance_id, "key is required");
            }
            match state_store.delete(&session.user_id, app_slug, key) {
                Ok(()) => ok_resp(client_id, instance_id, json!(true)),
                Err(e) => err_resp(client_id, instance_id, &e.to_string()),
            }
        }
        "__state:keys" => {
            match state_store.list_keys(&session.user_id, app_slug) {
                Ok(keys) => ok_resp(client_id, instance_id, json!(keys)),
                Err(e) => err_resp(client_id, instance_id, &e.to_string()),
            }
        }
        _ => unreachable!(),
    }
}
