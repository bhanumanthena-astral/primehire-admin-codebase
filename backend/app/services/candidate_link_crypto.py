"""Assessment URLs use existing encryption configuration with a purpose marker."""
from cryptography.fernet import Fernet, InvalidToken
from ..config import settings
from .outbox_crypto import OutboxCryptoError

MARKER='candidate-assessment-url:'


def cipher():
    key=(settings.outbox_encryption_key or settings.recruitment_outbox_encryption_key or '').strip()
    if not key: raise OutboxCryptoError('Configure an existing outbox encryption key to protect assessment URLs')
    try: return Fernet(key.encode())
    except (TypeError,ValueError): raise OutboxCryptoError('Assessment link encryption key is invalid') from None


def encrypt_link(url):
    return cipher().encrypt((MARKER+url).encode()).decode()


def decrypt_link(encrypted):
    try: value=cipher().decrypt(encrypted.encode()).decode()
    except (InvalidToken,UnicodeError): raise OutboxCryptoError('Assessment link cannot be decrypted') from None
    if not value.startswith(MARKER): raise OutboxCryptoError('Invalid assessment link encryption purpose')
    return value[len(MARKER):]
