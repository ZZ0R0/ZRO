# ---- Build stage ----
FROM rust:1.83-bookworm AS builder

WORKDIR /build

# Copy workspace manifests first for dependency caching
COPY Cargo.toml Cargo.lock ./
COPY protocol/Cargo.toml protocol/Cargo.toml
COPY runtime/Cargo.toml runtime/Cargo.toml
COPY sdks/rust/Cargo.toml sdks/rust/Cargo.toml
COPY sdks/rust/macros/Cargo.toml sdks/rust/macros/Cargo.toml
COPY apps/notes/backend/Cargo.toml apps/notes/backend/Cargo.toml
COPY apps/files/backend/Cargo.toml apps/files/backend/Cargo.toml
COPY apps/terminal/backend/Cargo.toml apps/terminal/backend/Cargo.toml
COPY apps/echo/backend/Cargo.toml apps/echo/backend/Cargo.toml
COPY apps/tasks/backend/Cargo.toml apps/tasks/backend/Cargo.toml
COPY apps/shell/backend/Cargo.toml apps/shell/backend/Cargo.toml
COPY apps/custom-shell/backend/Cargo.toml apps/custom-shell/backend/Cargo.toml

# Create dummy source files for dependency caching
RUN mkdir -p protocol/src runtime/src sdks/rust/src sdks/rust/macros/src \
    apps/notes/backend/src apps/files/backend/src apps/terminal/backend/src \
    apps/echo/backend/src apps/tasks/backend/src apps/shell/backend/src \
    apps/custom-shell/backend/src && \
    echo "fn main() {}" > runtime/src/main.rs && \
    echo "fn main() {}" > apps/notes/backend/src/main.rs && \
    echo "fn main() {}" > apps/files/backend/src/main.rs && \
    echo "fn main() {}" > apps/terminal/backend/src/main.rs && \
    echo "fn main() {}" > apps/echo/backend/src/main.rs && \
    echo "fn main() {}" > apps/tasks/backend/src/main.rs && \
    echo "fn main() {}" > apps/shell/backend/src/main.rs && \
    echo "fn main() {}" > apps/custom-shell/backend/src/main.rs && \
    touch protocol/src/lib.rs sdks/rust/src/lib.rs sdks/rust/macros/src/lib.rs

# Build dependencies only
RUN cargo build --release --workspace 2>/dev/null || true

# Copy actual source code
COPY protocol/ protocol/
COPY runtime/ runtime/
COPY sdks/rust/ sdks/rust/
COPY apps/ apps/

# Touch source files to invalidate dependency-only build cache
RUN touch protocol/src/lib.rs sdks/rust/src/lib.rs sdks/rust/macros/src/lib.rs \
    runtime/src/main.rs \
    apps/notes/backend/src/main.rs \
    apps/files/backend/src/main.rs \
    apps/terminal/backend/src/main.rs \
    apps/echo/backend/src/main.rs \
    apps/tasks/backend/src/main.rs \
    apps/shell/backend/src/main.rs \
    apps/custom-shell/backend/src/main.rs

# Build release binaries
RUN cargo build --release --workspace

# ---- Runtime stage ----
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates bash curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/zro

# Copy binaries
COPY --from=builder /build/target/release/zro-runtime ./bin/zro-runtime
COPY --from=builder /build/target/release/zro-app-notes ./bin/zro-app-notes
COPY --from=builder /build/target/release/zro-app-files ./bin/zro-app-files
COPY --from=builder /build/target/release/zro-app-terminal ./bin/zro-app-terminal
COPY --from=builder /build/target/release/zro-app-echo ./bin/zro-app-echo
COPY --from=builder /build/target/release/zro-app-tasks ./bin/zro-app-tasks
COPY --from=builder /build/target/release/zro-app-shell ./bin/zro-app-shell
COPY --from=builder /build/target/release/zro-app-custom-shell ./bin/zro-app-custom-shell

# Copy configuration and assets
COPY config/ ./config/
COPY apps/ ./apps/
COPY static/ ./static/

# Create data and IPC directories
RUN mkdir -p /opt/zro/data /tmp/zro/ipc

# Add binaries to PATH
ENV PATH="/opt/zro/bin:${PATH}"

# Expose the gateway port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Run as non-root
RUN groupadd -r zro && useradd -r -g zro -d /opt/zro zro
RUN chown -R zro:zro /opt/zro /tmp/zro
USER zro

CMD ["zro-runtime"]