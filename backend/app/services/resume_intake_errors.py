"""Import-safe errors shared with isolated parser children."""
class IntakeError(ValueError):
    def __init__(self, code, message):
        self.code, self.message = code, message
        super().__init__(message)
