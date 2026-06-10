package utils

import "time"

// FormatDate formats a date string.
func FormatDate(dateStr string) string {
	t, _ := time.Parse("2006-01-02", dateStr)
	return t.Format("January 02, 2006")
}

// Clamp restricts a value between min and max.
func Clamp(value, minVal, maxVal int) int {
	if value < minVal {
		return minVal
	}
	if value > maxVal {
		return maxVal
	}
	return value
}

// privateHelper is not exported (lowercase).
func privateHelper() string {
	return "internal"
}
