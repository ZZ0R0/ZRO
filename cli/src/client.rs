//! Control socket client — communicates with the running zro-runtime.

use std::path::Path;

use tokio::net::UnixStream;
use zro_protocol::messages::{read_message, write_message, IpcMessage};

/// Default control socket path.
pub const DEFAULT_SOCKET: &str = "/run/zro/control.sock";

/// Client for the control socket.
pub struct ControlClient {
    reader: tokio::net::unix::OwnedReadHalf,
    writer: tokio::net::unix::OwnedWriteHalf,
}

impl ControlClient {
    /// Connect to the control socket.
    pub async fn connect(socket_path: &str) -> anyhow::Result<Self> {
        if !Path::new(socket_path).exists() {
            anyhow::bail!(
                "Control socket not found at {}\nIs zro-runtime running?",
                socket_path
            );
        }

        let stream = UnixStream::connect(socket_path).await
            .map_err(|e| anyhow::anyhow!(
                "Cannot connect to {}: {}\nIs zro-runtime running?",
                socket_path, e
            ))?;

        let (reader, writer) = stream.into_split();
        Ok(Self { reader, writer })
    }

    /// Send a command and wait for the response.
    pub async fn call(&mut self, payload: serde_json::Value) -> anyhow::Result<serde_json::Value> {
        let msg = IpcMessage::new("ControlRequest", payload);
        write_message(&mut self.writer, &msg).await?;

        let reply = read_message(&mut self.reader).await?;
        Ok(reply.payload)
    }
}
