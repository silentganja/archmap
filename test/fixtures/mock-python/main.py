"""Main entry point for the mock Python project."""

import os
from collections import defaultdict
from .utils import format_date, clamp
from .models.user import User
import sys

def main():
    """Run the application."""
    date = format_date("2024-01-01")
    value = clamp(100, 0, 255)
    user = User("Alice")
    print(f"Date: {date}, Value: {value}, User: {user.name}")

if __name__ == "__main__":
    main()
