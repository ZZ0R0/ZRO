//! Staging — validate, extract, and prepare app packages for installation.

use std::path::{Path, PathBuf};

/// Staging directory base.
const STAGING_BASE: &str = "/tmp/zro-staging";

/// Prepare a staging directory from a source path.
/// Returns (slug, staging_path).
pub async fn prepare_staging(source: &str) -> anyhow::Result<(String, PathBuf)> {
    let source_path = Path::new(source);

    if !source_path.exists() {
        anyhow::bail!("Source path does not exist: {}", source);
    }

    // Create staging base
    tokio::fs::create_dir_all(STAGING_BASE).await?;

    if source_path.is_dir() {
        // Direct directory — validate and copy to staging
        stage_from_directory(source_path).await
    } else if is_tarball(source) {
        // Archive — extract to staging
        stage_from_archive(source_path).await
    } else {
        anyhow::bail!("Unsupported source format: {}\nExpected a directory or .tar.gz archive", source);
    }
}

/// Stage from a directory source.
async fn stage_from_directory(dir: &Path) -> anyhow::Result<(String, PathBuf)> {
    // Validate manifest exists
    let manifest_path = dir.join("manifest.toml");
    if !manifest_path.exists() {
        anyhow::bail!("manifest.toml not found in {}", dir.display());
    }

    // Read slug from manifest
    let slug = read_slug_from_manifest(&manifest_path)?;
    validate_structure(dir, &slug)?;

    // Copy to staging
    let staging_dir = PathBuf::from(STAGING_BASE).join(&slug);
    if staging_dir.exists() {
        tokio::fs::remove_dir_all(&staging_dir).await?;
    }

    copy_dir_recursive(dir, &staging_dir).await?;

    Ok((slug, staging_dir))
}

/// Stage from a tar.gz archive.
async fn stage_from_archive(archive: &Path) -> anyhow::Result<(String, PathBuf)> {
    let archive_path = archive.to_path_buf();

    // Extract in a blocking task
    let extract_dir = tokio::task::spawn_blocking(move || -> anyhow::Result<PathBuf> {
        let file = std::fs::File::open(&archive_path)?;
        let decoder = flate2::read::GzDecoder::new(file);
        let mut archive = tar::Archive::new(decoder);

        let extract_base = PathBuf::from(STAGING_BASE).join("_extract");
        if extract_base.exists() {
            std::fs::remove_dir_all(&extract_base)?;
        }
        std::fs::create_dir_all(&extract_base)?;

        archive.unpack(&extract_base)?;

        // Find the app directory (first directory containing manifest.toml)
        for entry in std::fs::read_dir(&extract_base)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() {
                let manifest = entry.path().join("manifest.toml");
                if manifest.exists() {
                    return Ok(entry.path());
                }
            }
        }

        // Maybe manifest is directly in the extract root
        if extract_base.join("manifest.toml").exists() {
            return Ok(extract_base);
        }

        anyhow::bail!("No manifest.toml found in archive");
    }).await??;

    // Read slug and validate
    let manifest_path = extract_dir.join("manifest.toml");
    let slug = read_slug_from_manifest(&manifest_path)?;
    validate_structure(&extract_dir, &slug)?;

    // Move to proper staging dir
    let staging_dir = PathBuf::from(STAGING_BASE).join(&slug);
    if staging_dir.exists() {
        tokio::fs::remove_dir_all(&staging_dir).await?;
    }

    if extract_dir != staging_dir {
        tokio::fs::rename(&extract_dir, &staging_dir).await
            .or_else(|_| {
                // Cross-device fallback
                let src = extract_dir.clone();
                let dst = staging_dir.clone();
                std::thread::spawn(move || -> anyhow::Result<()> {
                    copy_dir_sync(&src, &dst)?;
                    std::fs::remove_dir_all(&src)?;
                    Ok(())
                }).join().unwrap()
            })?;
    }

    Ok((slug, staging_dir))
}

/// Read the slug from a manifest.toml file.
fn read_slug_from_manifest(path: &Path) -> anyhow::Result<String> {
    let content = std::fs::read_to_string(path)?;
    let manifest: toml::Value = toml::from_str(&content)?;
    let slug = manifest
        .get("app")
        .and_then(|a| a.get("slug"))
        .and_then(|s| s.as_str())
        .ok_or_else(|| anyhow::anyhow!("manifest.toml missing [app].slug"))?;
    Ok(slug.to_string())
}

/// Validate the app directory structure.
fn validate_structure(dir: &Path, slug: &str) -> anyhow::Result<()> {
    // Check slug format
    if !is_valid_slug(slug) {
        anyhow::bail!("Invalid slug '{}': must match [a-z0-9][a-z0-9-]*", slug);
    }

    // Check reserved slugs
    const RESERVED: &[&str] = &["ws", "api", "auth", "static", "health", "apps"];
    if RESERVED.contains(&slug) {
        anyhow::bail!("Slug '{}' is reserved", slug);
    }

    // Check frontend/index.html exists
    let index = dir.join("frontend").join("index.html");
    if !index.exists() {
        anyhow::bail!("frontend/index.html not found in app directory");
    }

    Ok(())
}

/// Simple slug validation.
fn is_valid_slug(slug: &str) -> bool {
    if slug.is_empty() {
        return false;
    }
    let bytes = slug.as_bytes();
    // First char: [a-z0-9]
    if !bytes[0].is_ascii_lowercase() && !bytes[0].is_ascii_digit() {
        return false;
    }
    // Rest: [a-z0-9-]
    bytes.iter().all(|&b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn is_tarball(path: &str) -> bool {
    path.ends_with(".tar.gz") || path.ends_with(".tgz")
}

/// Recursively copy a directory (async).
async fn copy_dir_recursive(src: &Path, dst: &Path) -> anyhow::Result<()> {
    tokio::fs::create_dir_all(dst).await?;

    let mut entries = tokio::fs::read_dir(src).await?;
    while let Some(entry) = entries.next_entry().await? {
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if entry.file_type().await?.is_dir() {
            Box::pin(copy_dir_recursive(&src_path, &dst_path)).await?;
        } else {
            tokio::fs::copy(&src_path, &dst_path).await?;
        }
    }

    Ok(())
}

/// Recursively copy a directory (sync, for blocking contexts).
fn copy_dir_sync(src: &Path, dst: &Path) -> anyhow::Result<()> {
    std::fs::create_dir_all(dst)?;

    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if entry.file_type()?.is_dir() {
            copy_dir_sync(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)?;
        }
    }

    Ok(())
}

/// Clean up the staging directory for a slug.
pub async fn cleanup_staging(slug: &str) {
    let staging_dir = PathBuf::from(STAGING_BASE).join(slug);
    let _ = tokio::fs::remove_dir_all(&staging_dir).await;
    // Also clean up _extract if present
    let extract_dir = PathBuf::from(STAGING_BASE).join("_extract");
    let _ = tokio::fs::remove_dir_all(&extract_dir).await;
}
