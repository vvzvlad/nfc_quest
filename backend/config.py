import os
import sys
import secrets

_PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
_DATA_DIR = os.path.join(_PROJECT_ROOT, "data")
_DEFAULT_DB = os.path.join(_DATA_DIR, "quest.db")
_SECRET_KEY_FILE = os.path.join(_DATA_DIR, "secret_key")


def _get_secret_key() -> str:
    """Load or generate SECRET_KEY from data/secret_key file."""
    os.makedirs(_DATA_DIR, exist_ok=True)
    if os.path.exists(_SECRET_KEY_FILE):
        with open(_SECRET_KEY_FILE) as f:
            return f.read().strip()

    key = secrets.token_hex(32)
    with open(_SECRET_KEY_FILE, "w") as f:
        f.write(key)
    return key


def _get_admin_password() -> str:
    """Return ADMIN_PASSWORD from env or abort if not set."""
    password = os.getenv("ADMIN_PASSWORD", "").strip()
    if not password:
        print(
            "ERROR: ADMIN_PASSWORD environment variable is not set.\n"
            "Set it in .env file or pass via environment before starting the server.",
            file=sys.stderr,
        )
        sys.exit(1)
    return password


class Config:
    SECRET_KEY = _get_secret_key()
    ADMIN_PASSWORD = _get_admin_password()
    BASE_URL = os.getenv("BASE_URL", "http://localhost:5000")
    SQLALCHEMY_DATABASE_URI = os.getenv("DATABASE_URL", f"sqlite:///{_DEFAULT_DB}")
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SESSION_TYPE = "filesystem"
    SESSION_PERMANENT = False
    QUEST_NAME = os.getenv("QUEST_NAME", "ПЕРИМЕТР")
