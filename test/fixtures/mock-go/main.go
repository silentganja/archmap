package main

import (
	"fmt"
	"os"

	"./models"
	"./utils"
)

func main() {
	date := utils.FormatDate("2024-01-01")
	value := utils.Clamp(100, 0, 255)
	user := models.User{Name: "Alice"}
	fmt.Printf("Date: %s, Value: %d, User: %s\n", date, value, user.Name)
	_ = os.Args
}
