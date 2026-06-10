/// Utility functions.

/// Format a date string.
pub fn format_date(date_str: &str) -> String {
    // Simplified: just return the input
    date_str.to_string()
}

/// Clamp a value between min and max.
pub fn clamp(value: i32, min_val: i32, max_val: i32) -> i32 {
    if value < min_val {
        return min_val;
    }
    if value > max_val {
        return max_val;
    }
    value
}

/// Private helper (no pub).
fn private_helper() -> String {
    "internal".to_string()
}
