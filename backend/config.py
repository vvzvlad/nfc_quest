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


def _get_required_env(name: str) -> str:
    """Return env var or abort if not set."""
    value = os.getenv(name, "").strip()
    if not value:
        print(f"ERROR: {name} environment variable is not set.", file=sys.stderr)
        sys.exit(1)
    return value


def _get_admin_password() -> str:
    return _get_required_env("ADMIN_PASSWORD")


class Config:
    SECRET_KEY = _get_secret_key()
    ADMIN_PASSWORD = _get_admin_password()
    BASE_URL = _get_required_env("BASE_URL")
    SQLALCHEMY_DATABASE_URI = os.getenv("DATABASE_URL", f"sqlite:///{_DEFAULT_DB}")
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SESSION_TYPE = "filesystem"
    SESSION_PERMANENT = False
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = BASE_URL.startswith("https")
    QUEST_NAME = os.getenv("QUEST_NAME", "ПЕРИМЕТР")
