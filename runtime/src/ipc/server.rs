use std::path::{Path, PathBuf};
use tokio::net::UnixListener;
use zro_protocol::constants::IPC_SOCKET_DIR;

/// Create a Unix socket listener for an app.
pub async fn create_socket(slug: &str) -> anyhow::Result<(UnixListener, PathBuf)> {
    let socket_dir = Path::new(IPC_SOCKET_DIR);
    tokio::fs::create_dir_all(socket_dir).await?;

    let socket_path = socket_dir.join(format!("{}.sock", slug));

    // Remove existing socket file if present
    if socket_path.exists() {
        tokio::fs::remove_file(&socket_path).await?;
    }

    let listener = UnixListener::bind(&socket_path)?;
    tracing::debug!(slug = slug, path = %socket_path.display(), "IPC socket created");

    Ok((listener, socket_path))
}

/// Remove a socket file.
pub async fn remove_socket(slug: &str) {
    let socket_path = Path::new(IPC_SOCKET_DIR).join(format!("{}.sock", slug));
    if let Err(e) = tokio::fs::remove_file(&socket_path).await {
        tracing::warn!(slug = slug, "Failed to remove IPC socket: {}", e);
    }
}
