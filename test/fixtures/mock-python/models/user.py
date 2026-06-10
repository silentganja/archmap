"""User model."""

class User:
    """Represents a user in the system."""

    def __init__(self, name):
        self.name = name

    def greet(self):
        return f"Hello, {self.name}!"

class Admin(User):
    """An admin user with extra privileges."""
    pass
