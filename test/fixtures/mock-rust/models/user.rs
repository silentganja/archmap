/// User model.

/// Represents a user in the system.
pub struct User {
    pub name: String,
    age: u32, // private field
}

impl User {
    /// Create a new user.
    pub fn new(name: &str) -> Self {
        User {
            name: name.to_string(),
            age: 0,
        }
    }

    /// Greet someone.
    pub fn greet(&self) -> String {
        format!("Hello, {}!", self.name)
    }

    // Private method
    fn secret(&self) -> String {
        "secret".to_string()
    }
}
