#[derive(Debug, thiserror::Error)]
pub enum ProtocolError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON serialization error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Message too large: {size} bytes (max {max})")]
    MessageTooLarge { size: usize, max: usize },

    #[error("Failed to load manifest at {path}: {reason}")]
    ManifestLoadError { path: String, reason: String },

    #[error("Failed to parse manifest at {path}: {reason}")]
    ManifestParseError { path: String, reason: String },

    #[error("Invalid slug: '{slug}' — must match [a-z0-9]([a-z0-9-]{{0,30}}[a-z0-9])?")]
    InvalidSlug { slug: String },

    #[error("Reserved slug: '{slug}' cannot be used for applications")]
    ReservedSlug { slug: String },

    #[error("Unsupported protocol version: {version}")]
    UnsupportedProtocolVersion { version: u32 },

    #[error("Handshake timeout for app {slug}")]
    HandshakeTimeout { slug: String },

    #[error("IPC disconnected for app {slug}")]
    IpcDisconnected { slug: String },
}
