//! Module system for ZRO backend applications.
//!
//! Modules are self-contained units that contribute commands, event handlers,
//! and lifecycle hooks to a ZRO app. They declare dependencies, are resolved
//! in topological order, and have optional init/destroy lifecycle hooks.
//!
//! # Example
//!
//! ```ignore
//! use zro_sdk::module::{ZroModule, ModuleMeta, ModuleRegistrar};
//! use zro_sdk::{AppContext, BoxFuture};
//! use serde_json::Value;
//!
//! struct GreetModule;
//!
//! impl ZroModule for GreetModule {
//!     fn meta(&self) -> ModuleMeta {
//!         ModuleMeta::new("greet", "0.1.0")
//!     }
//!
//!     fn register(&self, r: &mut ModuleRegistrar) {
//!         r.command("greet", |params: Value, ctx: AppContext| -> BoxFuture<_> {
//!             Box::pin(async move {
//!                 let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("world");
//!                 Ok(serde_json::json!({ "message": format!("Hello, {}!", name) }))
//!             })
//!         });
//!     }
//! }
//!
//! // Usage:
//! ZroApp::builder()
//!     .module(GreetModule)
//!     .build().await?
//!     .run().await
//! ```

use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;

use crate::app::{BoxFuture, CommandFn, EventEmitter, EventFn, LifecycleHandler, ZroSdkError};
use crate::context::AppContext;

// ── Module Metadata ─────────────────────────────────────────────

/// Metadata describing a module: identity, version, and dependencies.
#[derive(Clone, Debug)]
pub struct ModuleMeta {
    /// Unique module name (e.g. `"kv"`, `"auth"`, `"files"`).
    pub name: String,
    /// Semver version string (e.g. `"0.1.0"`).
    pub version: String,
    /// Human-readable description.
    pub description: Option<String>,
    /// Names of modules this module depends on (initialized first).
    pub dependencies: Vec<String>,
}

impl ModuleMeta {
    /// Create metadata with name and version.
    pub fn new(name: &str, version: &str) -> Self {
        Self {
            name: name.to_string(),
            version: version.to_string(),
            description: None,
            dependencies: vec![],
        }
    }

    /// Set the description.
    pub fn description(mut self, desc: &str) -> Self {
        self.description = Some(desc.to_string());
        self
    }

    /// Set dependencies.
    pub fn dependencies(mut self, deps: Vec<&str>) -> Self {
        self.dependencies = deps.into_iter().map(String::from).collect();
        self
    }
}

// ── Module Init Context ─────────────────────────────────────────

/// Context available during module initialization (after IPC handshake).
pub struct ModuleInitContext {
    /// The app slug.
    pub slug: String,
    /// Path to the app's persistent data directory.
    pub data_dir: PathBuf,
    /// Event emitter for sending events to connected clients.
    pub emitter: EventEmitter,
}

// ── Module Registrar ────────────────────────────────────────────

/// Init hook: async fn called after IPC handshake, receives context.
pub type InitHook = Arc<
    dyn Fn(ModuleInitContext) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send>>
        + Send
        + Sync,
>;

/// Destroy hook: async fn called during shutdown.
pub type DestroyHook =
    Arc<dyn Fn() -> Pin<Box<dyn Future<Output = ()> + Send>> + Send + Sync>;

/// Builder passed to [`ZroModule::register`] for contributing handlers.
///
/// Mirrors the `ZroAppBuilder` API so modules register in the same way
/// as manual inline handlers.
pub struct ModuleRegistrar {
    pub(crate) commands: HashMap<String, CommandFn>,
    pub(crate) event_handlers: HashMap<String, EventFn>,
    pub(crate) lifecycle_handlers: HashMap<String, LifecycleHandler>,
    pub(crate) init_hooks: Vec<InitHook>,
    pub(crate) destroy_hooks: Vec<DestroyHook>,
}

impl ModuleRegistrar {
    pub(crate) fn new() -> Self {
        Self {
            commands: HashMap::new(),
            event_handlers: HashMap::new(),
            lifecycle_handlers: HashMap::new(),
            init_hooks: Vec::new(),
            destroy_hooks: Vec::new(),
        }
    }

    /// Register a command handler (WS invoke + HTTP API).
    pub fn command(
        &mut self,
        name: &str,
        handler: impl Fn(serde_json::Value, AppContext) -> BoxFuture<Result<serde_json::Value, String>>
            + Send
            + Sync
            + 'static,
    ) -> &mut Self {
        self.commands.insert(name.to_string(), Arc::new(handler));
        self
    }

    /// Register a WS event handler (fire-and-forget).
    pub fn on_event<F, Fut>(&mut self, event: &str, handler: F) -> &mut Self
    where
        F: Fn(serde_json::Value, AppContext) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = ()> + Send + 'static,
    {
        self.event_handlers.insert(
            event.to_string(),
            Arc::new(move |data, ctx| Box::pin(handler(data, ctx))),
        );
        self
    }

    /// Register a lifecycle handler (`client:connected`, `client:disconnected`, etc.).
    pub fn on<F, Fut>(&mut self, event: &str, handler: F) -> &mut Self
    where
        F: Fn(AppContext) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = ()> + Send + 'static,
    {
        self.lifecycle_handlers.insert(
            event.to_string(),
            Arc::new(move |ctx| Box::pin(handler(ctx))),
        );
        self
    }

    /// Register an init hook, called after IPC handshake before the main loop.
    pub fn on_init<F, Fut>(&mut self, handler: F) -> &mut Self
    where
        F: Fn(ModuleInitContext) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<(), String>> + Send + 'static,
    {
        self.init_hooks
            .push(Arc::new(move |ctx| Box::pin(handler(ctx))));
        self
    }

    /// Register a destroy hook, called during shutdown (reverse init order).
    pub fn on_destroy<F, Fut>(&mut self, handler: F) -> &mut Self
    where
        F: Fn() -> Fut + Send + Sync + 'static,
        Fut: Future<Output = ()> + Send + 'static,
    {
        self.destroy_hooks
            .push(Arc::new(move || Box::pin(handler())));
        self
    }
}

// ── Module Trait ────────────────────────────────────────────────

/// A ZRO backend module. Implement this trait to package reusable
/// commands, event handlers, and lifecycle hooks.
pub trait ZroModule: Send + Sync + 'static {
    /// Module metadata (name, version, dependencies).
    fn meta(&self) -> ModuleMeta;

    /// Register handlers on the provided registrar.
    /// Called once during app build, in dependency order.
    fn register(&self, registrar: &mut ModuleRegistrar);
}

// ── Dependency Resolution ───────────────────────────────────────

/// Resolve module initialization order via topological sort.
/// Returns indices into `modules` in the order they should be initialized.
pub(crate) fn resolve_module_order(
    modules: &[Box<dyn ZroModule>],
) -> Result<Vec<usize>, ZroSdkError> {
    // Collect metas so we can borrow names
    let metas: Vec<ModuleMeta> = modules.iter().map(|m| m.meta()).collect();
    let name_to_idx: HashMap<&str, usize> = metas
        .iter()
        .enumerate()
        .map(|(i, m)| (m.name.as_str(), i))
        .collect();

    // Build adjacency (dependency edges)
    let n = modules.len();
    let mut in_degree = vec![0usize; n];
    let mut adj: Vec<Vec<usize>> = vec![vec![]; n];

    for (i, meta) in metas.iter().enumerate() {
        for dep in &meta.dependencies {
            let dep_idx = name_to_idx.get(dep.as_str()).ok_or_else(|| {
                ZroSdkError::HandlerError(format!(
                    "Module '{}' depends on '{}' which is not registered",
                    meta.name, dep
                ))
            })?;
            adj[*dep_idx].push(i);
            in_degree[i] += 1;
        }
    }

    // Kahn's algorithm
    let mut queue: Vec<usize> = (0..n).filter(|i| in_degree[*i] == 0).collect();
    let mut order = Vec::with_capacity(n);

    while let Some(node) = queue.pop() {
        order.push(node);
        for &next in &adj[node] {
            in_degree[next] -= 1;
            if in_degree[next] == 0 {
                queue.push(next);
            }
        }
    }

    if order.len() != n {
        return Err(ZroSdkError::HandlerError(
            "Circular dependency detected among modules".to_string(),
        ));
    }

    Ok(order)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestModule {
        meta: ModuleMeta,
        command_names: Vec<String>,
    }

    impl TestModule {
        fn new(name: &str, deps: Vec<&str>) -> Self {
            Self {
                meta: ModuleMeta::new(name, "0.1.0").dependencies(deps),
                command_names: vec![format!("{}_cmd", name)],
            }
        }
    }

    impl ZroModule for TestModule {
        fn meta(&self) -> ModuleMeta {
            self.meta.clone()
        }

        fn register(&self, r: &mut ModuleRegistrar) {
            for name in &self.command_names {
                let n = name.clone();
                r.command(&n, move |_params, _ctx| {
                    Box::pin(async { Ok(serde_json::json!({"from": "test"})) })
                });
            }
        }
    }

    #[test]
    fn test_module_meta_builder() {
        let meta = ModuleMeta::new("kv", "1.0.0")
            .description("Key-value store")
            .dependencies(vec!["auth"]);

        assert_eq!(meta.name, "kv");
        assert_eq!(meta.version, "1.0.0");
        assert_eq!(meta.description.as_deref(), Some("Key-value store"));
        assert_eq!(meta.dependencies, vec!["auth"]);
    }

    #[test]
    fn test_registrar_collects_handlers() {
        let module = TestModule::new("test", vec![]);
        let mut registrar = ModuleRegistrar::new();
        module.register(&mut registrar);

        assert!(registrar.commands.contains_key("test_cmd"));
        assert_eq!(registrar.commands.len(), 1);
    }

    #[test]
    fn test_resolve_order_no_deps() {
        let modules: Vec<Box<dyn ZroModule>> = vec![
            Box::new(TestModule::new("a", vec![])),
            Box::new(TestModule::new("b", vec![])),
        ];
        let order = resolve_module_order(&modules).unwrap();
        assert_eq!(order.len(), 2);
    }

    #[test]
    fn test_resolve_order_with_deps() {
        let modules: Vec<Box<dyn ZroModule>> = vec![
            Box::new(TestModule::new("b", vec!["a"])),
            Box::new(TestModule::new("a", vec![])),
        ];
        let order = resolve_module_order(&modules).unwrap();
        // "a" (index 1) must come before "b" (index 0)
        let a_pos = order.iter().position(|&i| i == 1).unwrap();
        let b_pos = order.iter().position(|&i| i == 0).unwrap();
        assert!(a_pos < b_pos);
    }

    #[test]
    fn test_resolve_order_circular_dep() {
        let modules: Vec<Box<dyn ZroModule>> = vec![
            Box::new(TestModule::new("a", vec!["b"])),
            Box::new(TestModule::new("b", vec!["a"])),
        ];
        assert!(resolve_module_order(&modules).is_err());
    }

    #[test]
    fn test_resolve_order_missing_dep() {
        let modules: Vec<Box<dyn ZroModule>> = vec![
            Box::new(TestModule::new("a", vec!["nonexistent"])),
        ];
        assert!(resolve_module_order(&modules).is_err());
    }

    #[test]
    fn test_resolve_order_chain() {
        let modules: Vec<Box<dyn ZroModule>> = vec![
            Box::new(TestModule::new("c", vec!["b"])),
            Box::new(TestModule::new("a", vec![])),
            Box::new(TestModule::new("b", vec!["a"])),
        ];
        let order = resolve_module_order(&modules).unwrap();
        let a_pos = order.iter().position(|&i| i == 1).unwrap();
        let b_pos = order.iter().position(|&i| i == 2).unwrap();
        let c_pos = order.iter().position(|&i| i == 0).unwrap();
        assert!(a_pos < b_pos);
        assert!(b_pos < c_pos);
    }

    #[test]
    fn test_registrar_event_and_lifecycle() {
        let mut r = ModuleRegistrar::new();
        r.on_event("my:event", |_data, _ctx| async {});
        r.on("client:connected", |_ctx| async {});
        assert!(r.event_handlers.contains_key("my:event"));
        assert!(r.lifecycle_handlers.contains_key("client:connected"));
    }

    #[test]
    fn test_registrar_init_destroy_hooks() {
        let mut r = ModuleRegistrar::new();
        r.on_init(|_ctx| async { Ok(()) });
        r.on_destroy(|| async {});
        assert_eq!(r.init_hooks.len(), 1);
        assert_eq!(r.destroy_hooks.len(), 1);
    }
}
