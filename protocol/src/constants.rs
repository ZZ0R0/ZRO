/// Maximum message size: 16 MiB.
pub const MAX_MESSAGE_SIZE: usize = 16 * 1024 * 1024;

/// Current IPC protocol version.
pub const PROTOCOL_VERSION: u32 = 1;

/// Runtime version.
pub const RUNTIME_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Default IPC socket directory.
pub const IPC_SOCKET_DIR: &str = "/tmp/zro/ipc";

/// Handshake timeout in seconds.
pub const HANDSHAKE_TIMEOUT_SECS: u64 = 10;

/// Default HTTP request timeout in seconds.
pub const HTTP_REQUEST_TIMEOUT_SECS: u64 = 30;

/// Default session TTL in seconds (24 hours).
pub const DEFAULT_SESSION_TTL_SECS: u64 = 86400;

/// Session cleanup interval in seconds.
pub const SESSION_CLEANUP_INTERVAL_SECS: u64 = 300;

/// Default server port.
pub const DEFAULT_PORT: u16 = 8080;

/// Cookie name for sessions.
pub const SESSION_COOKIE_NAME: &str = "zro-session";

/// Default log level.
pub const DEFAULT_LOG_LEVEL: &str = "info";
