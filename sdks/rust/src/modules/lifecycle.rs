//! Lifecycle module — grace-period management for client connections.
//!
//! When a client disconnects, the module starts a configurable grace-period
//! timer. If the client reconnects before the timer expires, the timer is
//! cancelled and the session resumes normally. If the timer expires, a
//! configurable cleanup callback is invoked.
//!
//! # Example
//!
//! ```ignore
//! use zro_sdk::modules::lifecycle::LifecycleModule;
//! use std::time::Duration;
//!
//! let lifecycle = LifecycleModule::new()
//!     .grace_period(Duration::from_secs(10))
//!     .on_timeout(|ctx| Box::pin(async move {
//!         eprintln!("Session {} timed out", ctx.session.session_id);
//!     }));
//!
//! app.module(lifecycle);
//! ```

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Mutex;
use tokio::task::JoinHandle;

use crate::context::AppContext;
use crate::app::BoxFuture;
use crate::module::{ModuleMeta, ModuleRegistrar, ZroModule};

/// Callback invoked when a disconnected client's grace period expires.
pub type TimeoutCallback =
    Arc<dyn Fn(AppContext) -> BoxFuture<()> + Send + Sync>;

/// Lifecycle module for managing client connection grace periods.
pub struct LifecycleModule {
    grace_period: Duration,
    on_timeout: Option<TimeoutCallback>,
    on_connect: Option<Arc<dyn Fn(AppContext) -> BoxFuture<()> + Send + Sync>>,
    on_disconnect: Option<Arc<dyn Fn(AppContext) -> BoxFuture<()> + Send + Sync>>,
}

impl LifecycleModule {
    /// Create a new lifecycle module with a default 5-second grace period.
    pub fn new() -> Self {
        Self {
            grace_period: Duration::from_secs(5),
            on_timeout: None,
            on_connect: None,
            on_disconnect: None,
        }
    }

    /// Set the grace period duration before a disconnected session is cleaned up.
    pub fn grace_period(mut self, duration: Duration) -> Self {
        self.grace_period = duration;
        self
    }

    /// Set a callback invoked when the grace period expires without reconnection.
    pub fn on_timeout<F, Fut>(mut self, f: F) -> Self
    where
        F: Fn(AppContext) -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = ()> + Send + 'static,
    {
        self.on_timeout = Some(Arc::new(move |ctx| Box::pin(f(ctx))));
        self
    }

    /// Set a callback invoked when a client connects.
    pub fn on_connect<F, Fut>(mut self, f: F) -> Self
    where
        F: Fn(AppContext) -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = ()> + Send + 'static,
    {
        self.on_connect = Some(Arc::new(move |ctx| Box::pin(f(ctx))));
        self
    }

    /// Set a callback invoked when a client disconnects (before grace period starts).
    pub fn on_disconnect<F, Fut>(mut self, f: F) -> Self
    where
        F: Fn(AppContext) -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = ()> + Send + 'static,
    {
        self.on_disconnect = Some(Arc::new(move |ctx| Box::pin(f(ctx))));
        self
    }
}

impl Default for LifecycleModule {
    fn default() -> Self {
        Self::new()
    }
}

impl ZroModule for LifecycleModule {
    fn meta(&self) -> ModuleMeta {
        ModuleMeta::new("lifecycle", "0.1.0")
            .description("Grace-period management for client connections")
    }

    fn register(&self, r: &mut ModuleRegistrar) {
        // Shared state: map of instance_id → active grace-period timer handle
        let timers: Arc<Mutex<HashMap<String, JoinHandle<()>>>> =
            Arc::new(Mutex::new(HashMap::new()));

        let grace = self.grace_period;
        let timeout_cb = self.on_timeout.clone();
        let connect_cb = self.on_connect.clone();
        let disconnect_cb = self.on_disconnect.clone();

        // --- client:connected ---
        {
            let timers = timers.clone();
            let connect_cb = connect_cb.clone();
            r.on("client:connected", move |ctx: AppContext| {
                let timers = timers.clone();
                let connect_cb = connect_cb.clone();
                async move {
                    // Cancel any pending grace-period timer for this instance
                    if let Some(instance_id) = &ctx.instance_id {
                        let mut map = timers.lock().await;
                        if let Some(handle) = map.remove(instance_id) {
                            handle.abort();
                            tracing::debug!(
                                instance_id = %instance_id,
                                "Cancelled grace-period timer (reconnected)"
                            );
                        }
                    }

                    if let Some(cb) = &connect_cb {
                        cb(ctx).await;
                    }
                }
            });
        }

        // --- client:disconnected ---
        {
            let timers = timers.clone();
            r.on("client:disconnected", move |ctx: AppContext| {
                let timers = timers.clone();
                let timeout_cb = timeout_cb.clone();
                let disconnect_cb = disconnect_cb.clone();
                async move {
                    if let Some(cb) = &disconnect_cb {
                        cb(ctx.clone()).await;
                    }

                    if let Some(instance_id) = ctx.instance_id.clone() {
                        let ctx_for_timeout = ctx.clone();
                        let timers_inner = timers.clone();
                        let id_for_spawn = instance_id.clone();

                        let handle = tokio::spawn(async move {
                            tokio::time::sleep(grace).await;

                            // Grace period expired — run cleanup
                            tracing::info!(
                                instance_id = %id_for_spawn,
                                grace_secs = grace.as_secs(),
                                "Grace period expired, running cleanup"
                            );

                            // Remove ourselves from the timer map
                            {
                                let mut map = timers_inner.lock().await;
                                map.remove(&id_for_spawn);
                            }

                            if let Some(cb) = &timeout_cb {
                                cb(ctx_for_timeout).await;
                            }
                        });

                        let mut map = timers.lock().await;
                        // If there's already a timer (shouldn't happen normally), abort it
                        if let Some(old) = map.insert(instance_id, handle) {
                            old.abort();
                        }
                    }
                }
            });
        }

        // --- client:reconnected ---
        {
            let timers = timers.clone();
            r.on("client:reconnected", move |ctx: AppContext| {
                let timers = timers.clone();
                async move {
                    if let Some(instance_id) = &ctx.instance_id {
                        let mut map = timers.lock().await;
                        if let Some(handle) = map.remove(instance_id) {
                            handle.abort();
                            tracing::debug!(
                                instance_id = %instance_id,
                                "Cancelled grace-period timer (reconnected)"
                            );
                        }
                    }
                }
            });
        }
    }
}
