use tokio::net::UnixStream;
use zro_protocol::messages::{IpcMessage, read_message, write_message};
use zro_protocol::errors::ProtocolError;

/// IPC client that connects to the runtime via Unix socket.
pub struct IpcClient {
    stream: UnixStream,
}

impl IpcClient {
    /// Connect to the runtime IPC socket.
    pub async fn connect(socket_path: &str) -> Result<Self, ProtocolError> {
        let stream = UnixStream::connect(socket_path).await.map_err(|e| {
            ProtocolError::Io(e)
        })?;
        Ok(Self { stream })
    }

    /// Send an IPC message.
    pub async fn send(&mut self, msg: &IpcMessage) -> Result<(), ProtocolError> {
        let (_, mut writer) = self.stream.split();
        write_message(&mut writer, msg).await
    }

    /// Receive an IPC message.
    pub async fn recv(&mut self) -> Result<IpcMessage, ProtocolError> {
        let (mut reader, _) = self.stream.split();
        read_message(&mut reader).await
    }

    /// Split into read and write halves.
    pub fn into_split(self) -> (tokio::net::unix::OwnedReadHalf, tokio::net::unix::OwnedWriteHalf) {
        self.stream.into_split()
    }
}
