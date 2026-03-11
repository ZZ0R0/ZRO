use base64::Engine;
use serde_json::json;
use std::collections::HashMap;

use zro_protocol::constants::*;
use zro_protocol::errors::ProtocolError;
use zro_protocol::manifest::*;
use zro_protocol::messages::*;
use zro_protocol::types::*;

// ── Types tests ─────────────────────────────────────────────────

#[test]
fn test_instance_id_display() {
    let id = InstanceId("echo-1".to_string());
    assert_eq!(format!("{}", id), "echo-1");
}

#[test]
fn test_session_id_display() {
    let id = SessionId("sess-789".to_string());
    assert_eq!(format!("{}", id), "sess-789");
}

#[test]
fn test_instance_id_equality() {
    let a = InstanceId("echo-1".to_string());
    let b = InstanceId("echo-1".to_string());
    let c = InstanceId("echo-2".to_string());
    assert_eq!(a, b);
    assert_ne!(a, c);
}

#[test]
fn test_session_info_serde() {
    let info = SessionInfo {
        session_id: SessionId("s1".to_string()),
        user_id: "u1".to_string(),
        username: "admin".to_string(),
        role: "admin".to_string(),
        groups: vec![],
    };
    let json = serde_json::to_string(&info).unwrap();
    let back: SessionInfo = serde_json::from_str(&json).unwrap();
    assert_eq!(back.username, "admin");
    assert_eq!(back.session_id.0, "s1");
}

#[test]
fn test_instance_id_hash_map_key() {
    let mut map = HashMap::new();
    map.insert(InstanceId("echo-1".to_string()), 42);
    assert_eq!(map.get(&InstanceId("echo-1".to_string())), Some(&42));
    assert_eq!(map.get(&InstanceId("echo-2".to_string())), None);
}

// ── IpcMessage tests ────────────────────────────────────────────

#[test]
fn test_ipc_message_new() {
    let msg = IpcMessage::new("hello", json!({"key": "value"}));
    assert_eq!(msg.msg_type, "hello");
    assert!(!msg.id.is_empty());
    assert!(!msg.timestamp.is_empty());
    assert_eq!(msg.payload["key"], "value");
}

#[test]
fn test_ipc_message_reply() {
    let original = IpcMessage::new("request", json!({}));
    let reply = IpcMessage::reply(&original.id, "response", json!({"ok": true}));
    assert_eq!(reply.id, original.id); // shares same id
    assert_eq!(reply.msg_type, "response");
    assert_eq!(reply.payload["ok"], true);
}

#[test]
fn test_ipc_message_serde_roundtrip() {
    let msg = IpcMessage::new("test_type", json!({"number": 42, "text": "hello"}));
    let json_bytes = serde_json::to_vec(&msg).unwrap();
    let back: IpcMessage = serde_json::from_slice(&json_bytes).unwrap();
    assert_eq!(back.msg_type, "test_type");
    assert_eq!(back.id, msg.id);
    assert_eq!(back.payload["number"], 42);
    assert_eq!(back.payload["text"], "hello");
}

#[test]
fn test_ipc_message_type_field_renamed() {
    // Verify "type" field in JSON, not "msg_type"
    let msg = IpcMessage::new("hello", json!({}));
    let json_val: serde_json::Value = serde_json::to_value(&msg).unwrap();
    assert!(json_val.get("type").is_some());
    assert!(json_val.get("msg_type").is_none());
}

// ── Payload serde tests ─────────────────────────────────────────

#[test]
fn test_hello_payload_serde() {
    let p = HelloPayload {
        slug: "echo".to_string(),
        app_version: "0.1.0".to_string(),
        protocol_version: PROTOCOL_VERSION,
    };
    let json = serde_json::to_string(&p).unwrap();
    let back: HelloPayload = serde_json::from_str(&json).unwrap();
    assert_eq!(back.slug, "echo");
    assert_eq!(back.protocol_version, PROTOCOL_VERSION);
}

#[test]
fn test_http_request_payload_serde() {
    let session = SessionInfo {
        session_id: SessionId("s1".to_string()),
        user_id: "u1".to_string(),
        username: "admin".to_string(),
        role: "admin".to_string(),
        groups: vec![],
    };
    let p = HttpRequestPayload {
        method: "POST".to_string(),
        path: "/api/items".to_string(),
        headers: HashMap::from([("content-type".to_string(), "application/json".to_string())]),
        query: HashMap::new(),
        body: Some(base64::engine::general_purpose::STANDARD.encode(b"hello body")),
        session,
    };
    let json = serde_json::to_string(&p).unwrap();
    let back: HttpRequestPayload = serde_json::from_str(&json).unwrap();
    assert_eq!(back.method, "POST");
    assert_eq!(back.path, "/api/items");
    assert!(back.body.is_some());

    // Decode body
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(back.body.unwrap())
        .unwrap();
    assert_eq!(decoded, b"hello body");
}

#[test]
fn test_http_response_payload_serde() {
    let p = HttpResponsePayload {
        status: 200,
        headers: HashMap::from([("x-custom".to_string(), "value".to_string())]),
        body: None,
    };
    let json = serde_json::to_string(&p).unwrap();
    let back: HttpResponsePayload = serde_json::from_str(&json).unwrap();
    assert_eq!(back.status, 200);
    assert!(back.body.is_none());
}

#[test]
fn test_ws_in_payload_serde() {
    let session = SessionInfo {
        session_id: SessionId("s1".to_string()),
        user_id: "u1".to_string(),
        username: "user".to_string(),
        role: "user".to_string(),
        groups: vec![],
    };
    let p = WsInPayload {
        instance_id: "inst-1".to_string(),
        session,
        event: "chat:message".to_string(),
        data: json!({"text": "hello"}),
        request_id: Some("req-1".to_string()),
    };
    let json = serde_json::to_string(&p).unwrap();
    let back: WsInPayload = serde_json::from_str(&json).unwrap();
    assert_eq!(back.event, "chat:message");
    assert_eq!(back.request_id, Some("req-1".to_string()));
}

#[test]
fn test_event_emit_payload_instance_target() {
    let p = EventEmitPayload {
        event: "update".to_string(),
        payload: json!({"count": 42}),
        target: EventTarget::Instance {
            instance_id: "i1".to_string(),
        },
    };
    let json_str = serde_json::to_string(&p).unwrap();
    let back: EventEmitPayload = serde_json::from_str(&json_str).unwrap();
    assert_eq!(back.event, "update");
    match back.target {
        EventTarget::Instance { instance_id } => assert_eq!(instance_id, "i1"),
        _ => panic!("Expected Instance target"),
    }
}

#[test]
fn test_event_emit_payload_broadcast_target() {
    let p = EventEmitPayload {
        event: "refresh".to_string(),
        payload: json!(null),
        target: EventTarget::Broadcast,
    };
    let json_str = serde_json::to_string(&p).unwrap();
    let back: EventEmitPayload = serde_json::from_str(&json_str).unwrap();
    assert_eq!(back.event, "refresh");
    assert!(matches!(back.target, EventTarget::Broadcast));
}

#[test]
fn test_shutdown_payload_serde() {
    let p = ShutdownPayload {
        reason: "user_request".to_string(),
        grace_period_ms: 5000,
    };
    let json = serde_json::to_string(&p).unwrap();
    let back: ShutdownPayload = serde_json::from_str(&json).unwrap();
    assert_eq!(back.reason, "user_request");
    assert_eq!(back.grace_period_ms, 5000);
}

#[test]
fn test_log_payload_default_fields() {
    let json = r#"{"level":"info","message":"hello"}"#;
    let p: LogPayload = serde_json::from_str(json).unwrap();
    assert_eq!(p.level, "info");
    assert_eq!(p.message, "hello");
    assert!(p.fields.is_empty()); // #[serde(default)]
}

#[test]
fn test_client_connected_payload_serde() {
    let session = SessionInfo {
        session_id: SessionId("s1".to_string()),
        user_id: "u1".to_string(),
        username: "user".to_string(),
        role: "user".to_string(),
        groups: vec![],
    };
    let p = ClientConnectedPayload {
        instance_id: "inst-1".to_string(),
        session,
    };
    let json = serde_json::to_string(&p).unwrap();
    let back: ClientConnectedPayload = serde_json::from_str(&json).unwrap();
    assert_eq!(back.instance_id, "inst-1");
    assert_eq!(back.session.username, "user");
}

// ── Framing tests ───────────────────────────────────────────────

#[tokio::test]
async fn test_write_and_read_message() {
    let msg = IpcMessage::new("test", json!({"data": 123}));

    let mut buf = Vec::new();
    write_message(&mut buf, &msg).await.unwrap();

    // Verify wire format: 4-byte BE length prefix + JSON
    let len = u32::from_be_bytes([buf[0], buf[1], buf[2], buf[3]]) as usize;
    assert_eq!(len + 4, buf.len());

    // Read it back
    let mut reader = &buf[..];
    let decoded = read_message(&mut reader).await.unwrap();
    assert_eq!(decoded.msg_type, "test");
    assert_eq!(decoded.id, msg.id);
    assert_eq!(decoded.payload["data"], 123);
}

#[tokio::test]
async fn test_multiple_messages_framing() {
    let msg1 = IpcMessage::new("first", json!({"n": 1}));
    let msg2 = IpcMessage::new("second", json!({"n": 2}));

    let mut buf = Vec::new();
    write_message(&mut buf, &msg1).await.unwrap();
    write_message(&mut buf, &msg2).await.unwrap();

    let mut reader = &buf[..];
    let decoded1 = read_message(&mut reader).await.unwrap();
    let decoded2 = read_message(&mut reader).await.unwrap();

    assert_eq!(decoded1.msg_type, "first");
    assert_eq!(decoded1.payload["n"], 1);
    assert_eq!(decoded2.msg_type, "second");
    assert_eq!(decoded2.payload["n"], 2);
}

#[tokio::test]
async fn test_read_message_truncated_length() {
    // Only 2 bytes instead of 4
    let buf = [0u8, 1];
    let mut reader = &buf[..];
    let result = read_message(&mut reader).await;
    assert!(result.is_err());
}

#[tokio::test]
async fn test_read_message_truncated_body() {
    // Valid length header pointing beyond available data
    let mut buf = Vec::new();
    buf.extend_from_slice(&100u32.to_be_bytes()); // says 100 bytes
    buf.extend_from_slice(b"short"); // only 5 bytes
    let mut reader = &buf[..];
    let result = read_message(&mut reader).await;
    assert!(result.is_err());
}

#[tokio::test]
async fn test_read_message_too_large() {
    // Length header exceeds MAX_MESSAGE_SIZE
    let huge_len = (MAX_MESSAGE_SIZE as u32) + 1;
    let buf = huge_len.to_be_bytes();
    let mut reader = &buf[..];
    let result = read_message(&mut reader).await;
    assert!(matches!(result, Err(ProtocolError::MessageTooLarge { .. })));
}

// ── Manifest tests ──────────────────────────────────────────────

fn valid_manifest() -> AppManifest {
    AppManifest {
        app: AppInfo {
            slug: "my-app".to_string(),
            name: "My App".to_string(),
            version: "0.1.0".to_string(),
            description: String::new(),
        },
        backend: BackendInfo {
            executable: "my-app-backend".to_string(),
            transport: "unix_socket".to_string(),
            command: None,
            args: vec![],
        },
        frontend: FrontendInfo {
            directory: "frontend".to_string(),
            index: "index.html".to_string(),
            dev: None,
        },
        permissions: PermissionsInfo::default(),
    }
}

#[test]
fn test_manifest_valid() {
    let m = valid_manifest();
    assert!(m.validate().is_ok());
}

#[test]
fn test_manifest_invalid_slug_uppercase() {
    let mut m = valid_manifest();
    m.app.slug = "MyApp".to_string();
    assert!(matches!(m.validate(), Err(ProtocolError::InvalidSlug { .. })));
}

#[test]
fn test_manifest_invalid_slug_special_chars() {
    let mut m = valid_manifest();
    m.app.slug = "my_app!".to_string();
    assert!(matches!(m.validate(), Err(ProtocolError::InvalidSlug { .. })));
}

#[test]
fn test_manifest_empty_slug() {
    let mut m = valid_manifest();
    m.app.slug = "".to_string();
    assert!(matches!(m.validate(), Err(ProtocolError::InvalidSlug { .. })));
}

#[test]
fn test_manifest_slug_too_long() {
    let mut m = valid_manifest();
    m.app.slug = "a".repeat(40); // > 32 chars
    assert!(matches!(m.validate(), Err(ProtocolError::InvalidSlug { .. })));
}

#[test]
fn test_manifest_reserved_slug() {
    let reserved = ["apps", "auth", "health", "static", "api", "admin", "system", "_internal", "ws"];
    for slug in reserved {
        let mut m = valid_manifest();
        m.app.slug = slug.to_string();
        let result = m.validate();
        // _internal will fail slug validation first (starts with _)
        if slug.starts_with('_') {
            assert!(result.is_err());
        } else {
            assert!(
                matches!(result, Err(ProtocolError::ReservedSlug { .. })),
                "Expected ReservedSlug for '{}'",
                slug
            );
        }
    }
}

#[test]
fn test_manifest_toml_roundtrip() {
    let m = valid_manifest();
    let toml_str = toml::to_string(&m).unwrap();
    let back: AppManifest = toml::from_str(&toml_str).unwrap();
    assert_eq!(back.app.slug, "my-app");
    assert_eq!(back.backend.executable, "my-app-backend");
    assert!(back.validate().is_ok());
}

#[test]
fn test_manifest_toml_defaults() {
    let toml_str = r#"
[app]
slug = "test"
name = "Test"
version = "0.1.0"

[backend]
executable = "test-backend"

[frontend]
directory = "frontend"
"#;
    let manifest: AppManifest = toml::from_str(toml_str).unwrap();
    assert_eq!(manifest.backend.transport, "unix_socket"); // default
    assert_eq!(manifest.frontend.index, "index.html"); // default
    assert!(manifest.permissions.roles.is_empty()); // default
    assert!(manifest.validate().is_ok());
}

#[test]
fn test_manifest_load_nonexistent_file() {
    let result = AppManifest::load(std::path::Path::new("/nonexistent/manifest.toml"));
    assert!(matches!(result, Err(ProtocolError::ManifestLoadError { .. })));
}

// ── Constants tests ─────────────────────────────────────────────

#[test]
fn test_constants_sane_values() {
    assert_ne!(MAX_MESSAGE_SIZE, 0);
    assert_ne!(PROTOCOL_VERSION, 0);
    assert_ne!(HANDSHAKE_TIMEOUT_SECS, 0);
    assert_ne!(HTTP_REQUEST_TIMEOUT_SECS, 0);
    assert_ne!(DEFAULT_SESSION_TTL_SECS, 0);
    assert_ne!(DEFAULT_PORT, 0);
    assert!(!SESSION_COOKIE_NAME.is_empty());
    assert!(!IPC_SOCKET_DIR.is_empty());
}

// ── Error display tests ─────────────────────────────────────────

#[test]
fn test_protocol_error_display() {
    let err = ProtocolError::MessageTooLarge {
        size: 100,
        max: 50,
    };
    let msg = format!("{}", err);
    assert!(msg.contains("100"));
    assert!(msg.contains("50"));

    let err = ProtocolError::InvalidSlug {
        slug: "BAD".to_string(),
    };
    assert!(format!("{}", err).contains("BAD"));

    let err = ProtocolError::HandshakeTimeout {
        slug: "app-1".to_string(),
    };
    assert!(format!("{}", err).contains("app-1"));
}
