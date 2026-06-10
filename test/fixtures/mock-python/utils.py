"""Utility functions."""

from datetime import datetime

def format_date(date_str):
    """Format a date string."""
    dt = datetime.strptime(date_str, "%Y-%m-%d")
    return dt.strftime("%B %d, %Y")

def clamp(value, min_val, max_val):
    """Clamp a value between min and max."""
    return max(min_val, min(value, max_val))

class Helper:
    """A helper class."""
    pass
