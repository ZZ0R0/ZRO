use std::sync::Arc;
use tokio::net::unix::{OwnedReadHalf, OwnedWriteHalf};
use tokio::sync::Mutex;

use zro_protocol::messages::{IpcMessage, read_message, write_message};

/// Bidirectional IPC communication channel.
#[derive(Clone)]
pub struct IpcChannel {
    writer: Arc<Mutex<OwnedWriteHalf>>,
    reader: Arc<Mutex<OwnedReadHalf>>,
}

impl IpcChannel {
    pub fn new(reader: OwnedReadHalf, writer: OwnedWriteHalf) -> Self {
        Self {
            writer: Arc::new(Mutex::new(writer)),
            reader: Arc::new(Mutex::new(reader)),
        }
    }

    /// Send a message to the backend.
    pub async fn send(&self, msg: &IpcMessage) -> Result<(), zro_protocol::errors::ProtocolError> {
        let mut writer = self.writer.lock().await;
        write_message(&mut *writer, msg).await
    }

    /// Receive a message from the backend.
    pub async fn recv(&self) -> Result<IpcMessage, zro_protocol::errors::ProtocolError> {
        let mut reader = self.reader.lock().await;
        read_message(&mut *reader).await
    }
}
