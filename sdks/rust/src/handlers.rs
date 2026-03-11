use std::collections::HashMap;
use serde::{Deserialize, Serialize};

/// HTTP request received from the runtime (via proxy).
#[derive(Clone, Debug)]
pub struct HttpRequest {
    pub method: String,
    pub path: String,
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
    pub query: HashMap<String, String>,
}

/// HTTP response sent back to the runtime.
#[derive(Clone, Debug)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
}

impl HttpResponse {
    pub fn ok() -> Self {
        Self {
            status: 200,
            headers: HashMap::new(),
            body: Vec::new(),
        }
    }

    pub fn json<T: Serialize>(data: &T) -> Self {
        let body = serde_json::to_vec(data).unwrap_or_default();
        let mut headers = HashMap::new();
        headers.insert("content-type".to_string(), "application/json".to_string());
        Self {
            status: 200,
            headers,
            body,
        }
    }

    pub fn text(body: &str) -> Self {
        let mut headers = HashMap::new();
        headers.insert("content-type".to_string(), "text/plain".to_string());
        Self {
            status: 200,
            headers,
            body: body.as_bytes().to_vec(),
        }
    }

    pub fn not_found() -> Self {
        Self::json(&serde_json::json!({"error": "not_found"})).with_status(404)
    }

    pub fn bad_request(err: &str) -> Self {
        Self::json(&serde_json::json!({"error": err})).with_status(400)
    }

    pub fn internal_error(err: &str) -> Self {
        Self::json(&serde_json::json!({"error": err})).with_status(500)
    }

    pub fn with_status(mut self, status: u16) -> Self {
        self.status = status;
        self
    }
}

/// WebSocket message exchanged between frontend and backend.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WsMessage {
    pub event: String,
    #[serde(rename = "data")]
    pub payload: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
}
