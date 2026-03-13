//! ZRO CLI — manage the ZRO web desktop environment.

mod client;
mod output;
mod staging;

use std::process::Command;

use clap::{Parser, Subcommand};
use serde::Deserialize;
use tabled::Tabled;

use client::{ControlClient, DEFAULT_SOCKET};

// ── CLI definition ──────────────────────────────────────────────

#[derive(Parser)]
#[command(name = "zro", about = "ZRO Web Desktop Manager", version)]
struct Cli {
    /// Output as JSON (for scripting)
    #[arg(long, global = true)]
    json: bool,

    /// Quiet output
    #[arg(short, long, global = true)]
    quiet: bool,

    /// Verbose output
    #[arg(short, long, global = true)]
    verbose: bool,

    /// Control socket path
    #[arg(long, global = true, default_value = DEFAULT_SOCKET)]
    socket: String,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Show runtime status
    Status,
    /// Show CLI and runtime version
    Version,
    /// Manage applications
    #[command(subcommand)]
    App(AppCommands),
    /// Manage configuration
    #[command(subcommand)]
    Config(ConfigCommands),
    /// Manage users (local auth)
    #[command(subcommand)]
    User(UserCommands),
    /// Show runtime logs (journalctl)
    Logs {
        /// Follow log output
        #[arg(short, long)]
        follow: bool,
        /// Number of lines to show
        #[arg(short = 'n', long, default_value = "50")]
        lines: usize,
    },
    /// Check system health
    Doctor,
}

#[derive(Subcommand)]
enum AppCommands {
    /// List all installed apps
    List,
    /// Show detailed info for an app
    Info {
        /// App slug
        slug: String,
    },
    /// Install a new application
    Install {
        /// Source directory or .tar.gz archive
        source: String,
    },
    /// Remove an application
    Remove {
        /// App slug
        slug: String,
        /// Skip confirmation
        #[arg(short, long)]
        yes: bool,
    },
    /// Start an app backend
    Start {
        /// App slug
        slug: String,
    },
    /// Stop an app backend
    Stop {
        /// App slug
        slug: String,
    },
    /// Restart an app backend
    Restart {
        /// App slug
        slug: String,
    },
    /// Update an existing application
    Update {
        /// App slug
        slug: String,
        /// Source directory or .tar.gz archive
        source: String,
    },
    /// Show app logs (journalctl)
    Logs {
        /// App slug
        slug: String,
        /// Follow log output
        #[arg(short, long)]
        follow: bool,
        /// Number of lines to show
        #[arg(short = 'n', long, default_value = "50")]
        lines: usize,
    },
}

#[derive(Subcommand)]
enum ConfigCommands {
    /// Show active configuration
    Show,
    /// Open config file in $EDITOR
    Edit,
    /// Reload configuration (sends SIGHUP)
    Reload,
    /// Show config file path
    Path,
}

#[derive(Subcommand)]
enum UserCommands {
    /// List local users
    List,
    /// Add a new user
    Add {
        /// Username
        name: String,
        /// Role (admin or user)
        #[arg(long, default_value = "user")]
        role: String,
        /// Comma-separated groups
        #[arg(long)]
        groups: Option<String>,
    },
    /// Remove a user
    Remove {
        /// Username
        name: String,
    },
    /// Change a user's password
    Passwd {
        /// Username
        name: String,
    },
}

// ── Main ────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    let cli = Cli::parse();

    let result = match &cli.command {
        Commands::Status => cmd_status(&cli).await,
        Commands::Version => cmd_version(&cli).await,
        Commands::App(sub) => cmd_app(&cli, sub).await,
        Commands::Config(sub) => cmd_config(&cli, sub).await,
        Commands::User(sub) => cmd_user(&cli, sub).await,
        Commands::Logs { follow, lines } => cmd_logs(*follow, *lines).await,
        Commands::Doctor => cmd_doctor(&cli).await,
    };

    if let Err(e) = result {
        eprintln!("error: {}", e);
        std::process::exit(1);
    }
}

// ── Status ──────────────────────────────────────────────────────

async fn cmd_status(cli: &Cli) -> anyhow::Result<()> {
    let mut client = ControlClient::connect(&cli.socket).await?;
    let resp = client.call(serde_json::json!({"cmd": "status"})).await?;
    check_response(&resp)?;

    let data = &resp["data"];

    if cli.json {
        println!("{}", serde_json::to_string_pretty(data)?);
        return Ok(());
    }

    let version = data["version"].as_str().unwrap_or("?");
    let uptime = data["uptime_seconds"].as_u64().unwrap_or(0);
    let pid = data["pid"].as_u64().unwrap_or(0);
    let port = data["port"].as_u64().unwrap_or(0);
    let running = data["apps_running"].as_u64().unwrap_or(0);
    let stopped = data["apps_stopped"].as_u64().unwrap_or(0);
    let errored = data["apps_error"].as_u64().unwrap_or(0);
    let ws = data["active_ws_connections"].as_u64().unwrap_or(0);

    println!("ZRO Web Desktop    v{}", version);
    println!("Status: running    Uptime: {}", output::format_duration(uptime));
    println!("Port: {}         PID: {}", port, pid);
    println!("Apps: {} running / {} stopped / {} error", running, stopped, errored);
    println!("Users online: {}", ws);

    Ok(())
}

// ── Version ─────────────────────────────────────────────────────

async fn cmd_version(cli: &Cli) -> anyhow::Result<()> {
    let cli_version = env!("CARGO_PKG_VERSION");
    println!("zro-cli {}", cli_version);

    match ControlClient::connect(&cli.socket).await {
        Ok(mut client) => {
            let resp = client.call(serde_json::json!({"cmd": "status"})).await?;
            if let Some(v) = resp["data"]["version"].as_str() {
                println!("zro-runtime {}", v);
            }
        }
        Err(_) => {
            println!("zro-runtime (not reachable)");
        }
    }

    Ok(())
}

// ── App commands ────────────────────────────────────────────────

async fn cmd_app(cli: &Cli, sub: &AppCommands) -> anyhow::Result<()> {
    match sub {
        AppCommands::List => cmd_app_list(cli).await,
        AppCommands::Info { slug } => cmd_app_info(cli, slug).await,
        AppCommands::Install { source } => cmd_app_install(cli, source).await,
        AppCommands::Remove { slug, yes } => cmd_app_remove(cli, slug, *yes).await,
        AppCommands::Start { slug } => cmd_app_start(cli, slug).await,
        AppCommands::Stop { slug } => cmd_app_stop(cli, slug).await,
        AppCommands::Restart { slug } => cmd_app_restart(cli, slug).await,
        AppCommands::Update { slug, source } => cmd_app_update(cli, slug, source).await,
        AppCommands::Logs { slug, follow, lines } => cmd_app_logs(slug, *follow, *lines).await,
    }
}

#[derive(Deserialize, Tabled)]
struct AppRow {
    slug: String,
    name: String,
    version: String,
    state: String,
}

async fn cmd_app_list(cli: &Cli) -> anyhow::Result<()> {
    let mut client = ControlClient::connect(&cli.socket).await?;
    let resp = client.call(serde_json::json!({"cmd": "app.list"})).await?;
    check_response(&resp)?;

    let data = &resp["data"];

    if cli.json {
        println!("{}", serde_json::to_string_pretty(data)?);
        return Ok(());
    }

    let apps: Vec<AppRow> = serde_json::from_value(
        data["apps"].clone()
    ).unwrap_or_default();

    output::print_table(&apps);
    Ok(())
}

async fn cmd_app_info(cli: &Cli, slug: &str) -> anyhow::Result<()> {
    let mut client = ControlClient::connect(&cli.socket).await?;
    let resp = client.call(serde_json::json!({"cmd": "app.info", "slug": slug})).await?;
    check_response(&resp)?;

    let data = &resp["data"];

    if cli.json {
        println!("{}", serde_json::to_string_pretty(data)?);
        return Ok(());
    }

    println!("Slug:        {}", data["slug"].as_str().unwrap_or("?"));
    println!("Name:        {}", data["name"].as_str().unwrap_or("?"));
    println!("Version:     {}", data["version"].as_str().unwrap_or("?"));
    println!("Description: {}", data["description"].as_str().unwrap_or(""));
    println!("State:       {}", data["state"].as_str().unwrap_or("?"));
    println!("Executable:  {}", data["executable"].as_str().unwrap_or("?"));
    println!("Frontend:    {}", data["frontend_dir"].as_str().unwrap_or("?"));
    println!("Data:        {}", data["data_dir"].as_str().unwrap_or("?"));
    println!("Transport:   {}", data["transport"].as_str().unwrap_or("?"));

    Ok(())
}

async fn cmd_app_install(cli: &Cli, source: &str) -> anyhow::Result<()> {
    // Stage the app locally
    if !cli.quiet {
        eprintln!("Preparing app from {}...", source);
    }

    let (slug, staging_path) = staging::prepare_staging(source).await?;

    if !cli.quiet {
        eprintln!("Manifest validated: {}", slug);
    }

    // Send to runtime
    let mut client = ControlClient::connect(&cli.socket).await?;
    let resp = client.call(serde_json::json!({
        "cmd": "app.install",
        "slug": slug,
        "staging_path": staging_path.to_string_lossy(),
    })).await?;

    // Clean up staging on failure
    if !resp["ok"].as_bool().unwrap_or(false) {
        staging::cleanup_staging(&slug).await;
        let msg = resp["error"].as_str().unwrap_or("unknown error");
        anyhow::bail!("Install failed: {}", msg);
    }

    if cli.json {
        println!("{}", serde_json::to_string_pretty(&resp["data"])?);
    } else if !cli.quiet {
        eprintln!("App '{}' installed and running", slug);
    }

    Ok(())
}

async fn cmd_app_remove(cli: &Cli, slug: &str, yes: bool) -> anyhow::Result<()> {
    if !yes {
        // Confirm with user
        eprint!("Remove app '{}'? Data directory will be preserved. [y/N] ", slug);
        let mut input = String::new();
        std::io::stdin().read_line(&mut input)?;
        if !input.trim().eq_ignore_ascii_case("y") {
            eprintln!("Aborted.");
            return Ok(());
        }
    }

    let mut client = ControlClient::connect(&cli.socket).await?;
    let resp = client.call(serde_json::json!({"cmd": "app.remove", "slug": slug})).await?;
    check_response(&resp)?;

    if cli.json {
        println!("{}", serde_json::to_string_pretty(&resp["data"])?);
    } else if !cli.quiet {
        eprintln!("App '{}' removed", slug);
    }

    Ok(())
}

async fn cmd_app_start(cli: &Cli, slug: &str) -> anyhow::Result<()> {
    let mut client = ControlClient::connect(&cli.socket).await?;
    let resp = client.call(serde_json::json!({"cmd": "app.start", "slug": slug})).await?;
    check_response(&resp)?;

    if !cli.quiet {
        eprintln!("App '{}' started", slug);
    }
    Ok(())
}

async fn cmd_app_stop(cli: &Cli, slug: &str) -> anyhow::Result<()> {
    let mut client = ControlClient::connect(&cli.socket).await?;
    let resp = client.call(serde_json::json!({"cmd": "app.stop", "slug": slug})).await?;
    check_response(&resp)?;

    if !cli.quiet {
        eprintln!("App '{}' stopped", slug);
    }
    Ok(())
}

async fn cmd_app_restart(cli: &Cli, slug: &str) -> anyhow::Result<()> {
    let mut client = ControlClient::connect(&cli.socket).await?;
    let resp = client.call(serde_json::json!({"cmd": "app.restart", "slug": slug})).await?;
    check_response(&resp)?;

    if !cli.quiet {
        eprintln!("App '{}' restarted", slug);
    }
    Ok(())
}

async fn cmd_app_update(cli: &Cli, slug: &str, source: &str) -> anyhow::Result<()> {
    // Stage the new version
    if !cli.quiet {
        eprintln!("Preparing update from {}...", source);
    }

    let (staged_slug, staging_path) = staging::prepare_staging(source).await?;

    if staged_slug != slug {
        staging::cleanup_staging(&staged_slug).await;
        anyhow::bail!("Slug mismatch: expected '{}', got '{}'", slug, staged_slug);
    }

    // Send update to runtime
    let mut client = ControlClient::connect(&cli.socket).await?;
    let resp = client.call(serde_json::json!({
        "cmd": "app.update",
        "slug": slug,
        "staging_path": staging_path.to_string_lossy(),
    })).await?;

    if !resp["ok"].as_bool().unwrap_or(false) {
        staging::cleanup_staging(slug).await;
        let msg = resp["error"].as_str().unwrap_or("unknown error");
        anyhow::bail!("Update failed: {}", msg);
    }

    if cli.json {
        println!("{}", serde_json::to_string_pretty(&resp["data"])?);
    } else if !cli.quiet {
        eprintln!("App '{}' updated", slug);
    }

    Ok(())
}

async fn cmd_app_logs(slug: &str, follow: bool, lines: usize) -> anyhow::Result<()> {
    let mut args = vec![
        "-u".to_string(), "zro-runtime".to_string(),
        "--no-pager".to_string(),
        "-n".to_string(), lines.to_string(),
        "--grep".to_string(), slug.to_string(),
    ];
    if follow {
        args.push("-f".to_string());
    }

    let status = Command::new("journalctl")
        .args(&args)
        .status()?;

    if !status.success() {
        anyhow::bail!("journalctl exited with {}", status);
    }
    Ok(())
}

// ── Config commands ─────────────────────────────────────────────

async fn cmd_config(cli: &Cli, sub: &ConfigCommands) -> anyhow::Result<()> {
    match sub {
        ConfigCommands::Show => cmd_config_show(cli).await,
        ConfigCommands::Edit => cmd_config_edit().await,
        ConfigCommands::Reload => cmd_config_reload(cli).await,
        ConfigCommands::Path => cmd_config_path(cli).await,
    }
}

async fn cmd_config_show(cli: &Cli) -> anyhow::Result<()> {
    let mut client = ControlClient::connect(&cli.socket).await?;
    let resp = client.call(serde_json::json!({"cmd": "config.show"})).await?;
    check_response(&resp)?;

    let data = &resp["data"];
    println!("{}", serde_json::to_string_pretty(data)?);
    Ok(())
}

async fn cmd_config_edit() -> anyhow::Result<()> {
    let editor = std::env::var("EDITOR").unwrap_or_else(|_| "vi".to_string());
    let config_path = std::env::var("ZRO_CONFIG")
        .unwrap_or_else(|_| "/etc/zro/runtime.toml".to_string());

    let status = Command::new(&editor)
        .arg(&config_path)
        .status()?;

    if !status.success() {
        anyhow::bail!("{} exited with {}", editor, status);
    }
    Ok(())
}

async fn cmd_config_reload(cli: &Cli) -> anyhow::Result<()> {
    let mut client = ControlClient::connect(&cli.socket).await?;
    let resp = client.call(serde_json::json!({"cmd": "config.reload"})).await?;
    check_response(&resp)?;

    if !cli.quiet {
        eprintln!("Configuration reloaded");
    }
    Ok(())
}

async fn cmd_config_path(cli: &Cli) -> anyhow::Result<()> {
    let mut client = ControlClient::connect(&cli.socket).await?;
    let resp = client.call(serde_json::json!({"cmd": "config.show"})).await?;
    check_response(&resp)?;

    // The config path is from the env or default
    let path = std::env::var("ZRO_CONFIG")
        .unwrap_or_else(|_| "/etc/zro/runtime.toml".to_string());
    println!("{}", path);
    Ok(())
}

// ── User commands ───────────────────────────────────────────────

async fn cmd_user(cli: &Cli, sub: &UserCommands) -> anyhow::Result<()> {
    match sub {
        UserCommands::List => cmd_user_list(cli).await,
        UserCommands::Add { name, role, groups } => cmd_user_add(cli, name, role, groups.as_deref()).await,
        UserCommands::Remove { name } => cmd_user_remove(cli, name).await,
        UserCommands::Passwd { name } => cmd_user_passwd(cli, name).await,
    }
}

#[derive(Deserialize, Tabled)]
struct UserRow {
    username: String,
    role: String,
    groups: String,
}

async fn cmd_user_list(cli: &Cli) -> anyhow::Result<()> {
    let mut client = ControlClient::connect(&cli.socket).await?;
    let resp = client.call(serde_json::json!({"cmd": "user.list"})).await?;
    check_response(&resp)?;

    let data = &resp["data"];

    if cli.json {
        println!("{}", serde_json::to_string_pretty(data)?);
        return Ok(());
    }

    let users: Vec<UserRow> = serde_json::from_value(
        data["users"].clone()
    ).unwrap_or_default();

    output::print_table(&users);
    Ok(())
}

async fn cmd_user_add(cli: &Cli, name: &str, role: &str, groups: Option<&str>) -> anyhow::Result<()> {
    // Prompt for password
    let password = read_password("Password: ")?;
    let confirm = read_password("Confirm:  ")?;

    if password != confirm {
        anyhow::bail!("Passwords do not match");
    }

    if password.is_empty() {
        anyhow::bail!("Password cannot be empty");
    }

    // Hash password locally using Argon2id
    let hash = hash_password(&password)?;

    let groups_vec: Vec<String> = groups
        .map(|g: &str| g.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect())
        .unwrap_or_default();

    let mut client = ControlClient::connect(&cli.socket).await?;
    let resp = client.call(serde_json::json!({
        "cmd": "user.add",
        "username": name,
        "password_hash": hash,
        "role": role,
        "groups": groups_vec,
    })).await?;
    check_response(&resp)?;

    if !cli.quiet {
        eprintln!("User '{}' created", name);
    }
    Ok(())
}

async fn cmd_user_remove(cli: &Cli, name: &str) -> anyhow::Result<()> {
    let mut client = ControlClient::connect(&cli.socket).await?;
    let resp = client.call(serde_json::json!({"cmd": "user.remove", "username": name})).await?;
    check_response(&resp)?;

    if !cli.quiet {
        eprintln!("User '{}' removed", name);
    }
    Ok(())
}

async fn cmd_user_passwd(cli: &Cli, name: &str) -> anyhow::Result<()> {
    let password = read_password("New password: ")?;
    let confirm = read_password("Confirm:      ")?;

    if password != confirm {
        anyhow::bail!("Passwords do not match");
    }

    if password.is_empty() {
        anyhow::bail!("Password cannot be empty");
    }

    let hash = hash_password(&password)?;

    // Use user.add with same username — the runtime should update password
    let mut client = ControlClient::connect(&cli.socket).await?;
    let resp = client.call(serde_json::json!({
        "cmd": "user.passwd",
        "username": name,
        "password_hash": hash,
    })).await?;
    check_response(&resp)?;

    if !cli.quiet {
        eprintln!("Password updated for '{}'", name);
    }
    Ok(())
}

// ── Logs command ────────────────────────────────────────────────

async fn cmd_logs(follow: bool, lines: usize) -> anyhow::Result<()> {
    let mut args = vec![
        "-u".to_string(), "zro-runtime".to_string(),
        "--no-pager".to_string(),
        "-n".to_string(), lines.to_string(),
    ];
    if follow {
        args.push("-f".to_string());
    }

    let status = Command::new("journalctl")
        .args(&args)
        .status()?;

    if !status.success() {
        anyhow::bail!("journalctl exited with {}", status);
    }
    Ok(())
}

// ── Doctor command ──────────────────────────────────────────────

async fn cmd_doctor(cli: &Cli) -> anyhow::Result<()> {
    let mut ok_count = 0u32;
    let mut fail_count = 0u32;

    // 1. Check control socket
    match ControlClient::connect(&cli.socket).await {
        Ok(mut client) => {
            print_check(true, &format!("Runtime reachable via {}", cli.socket));
            ok_count += 1;

            // 2. Get status
            match client.call(serde_json::json!({"cmd": "status"})).await {
                Ok(resp) if resp["ok"].as_bool() == Some(true) => {
                    let data = &resp["data"];
                    let version = data["version"].as_str().unwrap_or("?");
                    print_check(true, &format!("Runtime v{} responding", version));
                    ok_count += 1;

                    let running = data["apps_running"].as_u64().unwrap_or(0);
                    let errored = data["apps_error"].as_u64().unwrap_or(0);
                    let total = running + data["apps_stopped"].as_u64().unwrap_or(0) + errored;

                    if errored == 0 {
                        print_check(true, &format!("{}/{} apps running", running, total));
                        ok_count += 1;
                    } else {
                        print_check(false, &format!("{} app(s) in error state", errored));
                        fail_count += 1;
                    }

                    let port = data["port"].as_u64().unwrap_or(8080);
                    print_check(true, &format!("Port {} configured", port));
                    ok_count += 1;
                }
                Ok(_) => {
                    print_check(false, "Runtime returned error on status");
                    fail_count += 1;
                }
                Err(e) => {
                    print_check(false, &format!("Failed to get status: {}", e));
                    fail_count += 1;
                }
            }
        }
        Err(_) => {
            print_check(false, &format!("Runtime not reachable via {}", cli.socket));
            fail_count += 1;
            eprintln!("  Cannot perform further checks without connection.");
        }
    }

    // 3. Check config file
    let config_path = std::env::var("ZRO_CONFIG")
        .unwrap_or_else(|_| "/etc/zro/runtime.toml".to_string());
    if std::path::Path::new(&config_path).exists() {
        print_check(true, &format!("Config file exists: {}", config_path));
        ok_count += 1;
    } else {
        print_check(false, &format!("Config file not found: {}", config_path));
        fail_count += 1;
    }

    println!();
    if fail_count == 0 {
        println!("All {} checks passed.", ok_count);
    } else {
        println!("{} passed, {} failed.", ok_count, fail_count);
    }

    if fail_count > 0 {
        std::process::exit(1);
    }
    Ok(())
}

// ── Helpers ─────────────────────────────────────────────────────

/// Check a response for errors and bail if needed.
fn check_response(resp: &serde_json::Value) -> anyhow::Result<()> {
    if resp["ok"].as_bool() != Some(true) {
        let msg = resp["error"].as_str().unwrap_or("unknown error");
        anyhow::bail!("{}", msg);
    }
    Ok(())
}

/// Print a check result line.
fn print_check(ok: bool, msg: &str) {
    if ok {
        println!("  OK  {}", msg);
    } else {
        println!("  FAIL  {}", msg);
    }
}

/// Read a password from the terminal without echoing.
fn read_password(prompt: &str) -> anyhow::Result<String> {
    eprint!("{}", prompt);

    // Try to disable echo for password input
    #[cfg(unix)]
    {
        use std::io::BufRead;

        // Save terminal settings
        let fd = 0; // stdin
        let old_termios = unsafe {
            let mut t = std::mem::zeroed::<libc::termios>();
            libc::tcgetattr(fd, &mut t);
            t
        };

        // Disable echo
        unsafe {
            let mut t = old_termios;
            t.c_lflag &= !libc::ECHO;
            libc::tcsetattr(fd, libc::TCSANOW, &t);
        }

        let stdin = std::io::stdin();
        let mut line = String::new();
        stdin.lock().read_line(&mut line)?;

        // Restore terminal settings
        unsafe {
            libc::tcsetattr(fd, libc::TCSANOW, &old_termios);
        }

        eprintln!(); // newline after password
        Ok(line.trim_end().to_string())
    }

    #[cfg(not(unix))]
    {
        use std::io::BufRead;
        let stdin = std::io::stdin();
        let mut line = String::new();
        stdin.lock().read_line(&mut line)?;
        Ok(line.trim_end().to_string())
    }
}

/// Hash a password with Argon2id.
fn hash_password(password: &str) -> anyhow::Result<String> {
    use argon2::password_hash::SaltString;
    use argon2::{Argon2, PasswordHasher};
    use rand::rngs::OsRng;

    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!("failed to hash password: {}", e))?;
    Ok(hash.to_string())
}
