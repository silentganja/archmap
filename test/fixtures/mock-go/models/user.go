package models

// User represents a user in the system.
type User struct {
	Name string
	age  int // unexported field
}

// NewUser creates a new user.
func NewUser(name string) *User {
	return &User{Name: name, age: 0}
}

// Greet returns a greeting.
func (u *User) Greet() string {
	return "Hello, " + u.Name + "!"
}

// unexported helper
func hiddenHelper() string {
	return "hidden"
}
