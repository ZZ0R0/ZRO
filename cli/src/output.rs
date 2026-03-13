//! Output formatting — table, JSON, or quiet modes.

use tabled::{Table, Tabled};

/// Format a list of items as a table.
pub fn print_table<T: Tabled>(items: &[T]) {
    if items.is_empty() {
        println!("(none)");
        return;
    }
    let table = Table::new(items).to_string();
    println!("{}", table);
}

/// Format seconds as a human-readable duration.
pub fn format_duration(secs: u64) -> String {
    if secs < 60 {
        format!("{}s", secs)
    } else if secs < 3600 {
        format!("{}m {}s", secs / 60, secs % 60)
    } else if secs < 86400 {
        let h = secs / 3600;
        let m = (secs % 3600) / 60;
        format!("{}h {}m", h, m)
    } else {
        let d = secs / 86400;
        let h = (secs % 86400) / 3600;
        format!("{}d {}h", d, h)
    }
}
