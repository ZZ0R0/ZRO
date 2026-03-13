use serde_json::json;
use std::collections::HashMap;

use zro_sdk::handlers::{HttpRequest, HttpResponse, WsMessage};
use zro_sdk::SessionInfo;
use zro_protocol::types::SessionId;

// ── HttpResponse builder tests ──────────────────────────────────

#[test]
fn test_http_response_ok() {
    let r = HttpResponse::ok();
    assert_eq!(r.status, 200);
    assert!(r.body.is_empty());
    assert!(r.headers.is_empty());
}

#[test]
fn test_http_response_json() {
    let data = json!({"key": "value", "count": 42});
    let r = HttpResponse::json(&data);
    assert_eq!(r.status, 200);
    assert_eq!(
        r.headers.get("content-type").unwrap(),
        "application/json"
    );
    let body: serde_json::Value = serde_json::from_slice(&r.body).unwrap();
    assert_eq!(body["key"], "value");
    assert_eq!(body["count"], 42);
}

#[test]
fn test_http_response_text() {
    let r = HttpResponse::text("hello world");
    assert_eq!(r.status, 200);
    assert_eq!(r.headers.get("content-type").unwrap(), "text/plain");
    assert_eq!(String::from_utf8_lossy(&r.body), "hello world");
}

#[test]
fn test_http_response_not_found() {
    let r = HttpResponse::not_found();
    assert_eq!(r.status, 404);
    let body: serde_json::Value = serde_json::from_slice(&r.body).unwrap();
    assert_eq!(body["error"], "not_found");
}

#[test]
fn test_http_response_bad_request() {
    let r = HttpResponse::bad_request("invalid input");
    assert_eq!(r.status, 400);
    let body: serde_json::Value = serde_json::from_slice(&r.body).unwrap();
    assert_eq!(body["error"], "invalid input");
}

#[test]
fn test_http_response_internal_error() {
    let r = HttpResponse::internal_error("db failed");
    assert_eq!(r.status, 500);
    let body: serde_json::Value = serde_json::from_slice(&r.body).unwrap();
    assert_eq!(body["error"], "db failed");
}

#[test]
fn test_http_response_with_status() {
    let r = HttpResponse::ok().with_status(201);
    assert_eq!(r.status, 201);
}

#[test]
fn test_http_response_json_with_struct() {
    #[derive(serde::Serialize)]
    struct Item {
        id: u32,
        name: String,
    }
    let item = Item { id: 1, name: "test".to_string() };
    let r = HttpResponse::json(&item);
    assert_eq!(r.status, 200);
    let body: serde_json::Value = serde_json::from_slice(&r.body).unwrap();
    assert_eq!(body["id"], 1);
    assert_eq!(body["name"], "test");
}

// ── HttpRequest tests ───────────────────────────────────────────

#[test]
fn test_http_request_construction() {
    let req = HttpRequest {
        method: "GET".to_string(),
        path: "/api/items".to_string(),
        headers: HashMap::from([("accept".into(), "application/json".into())]),
        body: Vec::new(),
        query: HashMap::from([("page".into(), "1".into())]),
    };
    assert_eq!(req.method, "GET");
    assert_eq!(req.path, "/api/items");
    assert_eq!(req.query.get("page").unwrap(), "1");
    assert!(req.body.is_empty());
}

// ── WsMessage tests ────────────────────────────────────────────

#[test]
fn test_ws_message_serde_roundtrip() {
    let msg = WsMessage {
        event: "chat:message".to_string(),
        payload: json!({"text": "hello"}),
        request_id: Some("req-1".to_string()),
    };
    let json_str = serde_json::to_string(&msg).unwrap();
    let back: WsMessage = serde_json::from_str(&json_str).unwrap();
    assert_eq!(back.event, "chat:message");
    assert_eq!(back.payload["text"], "hello");
    assert_eq!(back.request_id, Some("req-1".to_string()));
}

#[test]
fn test_ws_message_data_field_rename() {
    let msg = WsMessage {
        event: "test".to_string(),
        payload: json!({"val": 1}),
        request_id: None,
    };
    let json_val: serde_json::Value = serde_json::to_value(&msg).unwrap();
    // Verify "data" field in JSON, not "payload"
    assert!(json_val.get("data").is_some());
    assert!(json_val.get("payload").is_none());
}

#[test]
fn test_ws_message_skip_none_request_id() {
    let msg = WsMessage {
        event: "test".to_string(),
        payload: json!({}),
        request_id: None,
    };
    let json_str = serde_json::to_string(&msg).unwrap();
    assert!(!json_str.contains("request_id"));
}

// ── Context tests ───────────────────────────────────────────────

#[test]
fn test_session_info_construction() {
    let session = SessionInfo {
        session_id: SessionId("s1".to_string()),
        user_id: "u1".to_string(),
        username: "admin".to_string(),
        role: "admin".to_string(),
        groups: vec!["dev".to_string()],
        profile: None,
    };
    assert_eq!(session.username, "admin");
    assert_eq!(session.role, "admin");
    assert_eq!(session.groups, vec!["dev"]);
}

#[test]
fn test_session_info_clone() {
    let session = SessionInfo {
        session_id: SessionId("s1".to_string()),
        user_id: "u1".to_string(),
        username: "admin".to_string(),
        role: "admin".to_string(),
        groups: vec![],
        profile: None,
    };
    let cloned = session.clone();
    assert_eq!(cloned.user_id, session.user_id);
    assert_eq!(cloned.username, session.username);
}

#[test]
fn test_session_info_serde_roundtrip() {
    let session = SessionInfo {
        session_id: SessionId("s1".to_string()),
        user_id: "u1".to_string(),
        username: "bob".to_string(),
        role: "user".to_string(),
        groups: vec!["team-a".to_string()],
        profile: None,
    };
    let json = serde_json::to_value(&session).unwrap();
    assert_eq!(json["username"], "bob");
    assert_eq!(json["groups"][0], "team-a");
    let back: SessionInfo = serde_json::from_value(json).unwrap();
    assert_eq!(back.username, "bob");
}
