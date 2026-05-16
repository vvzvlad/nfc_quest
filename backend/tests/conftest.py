import sys
import os
import tempfile

import pytest

# Add backend/ to sys.path so imports work without the "backend." prefix
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from config import Config
from app import create_app
from blueprints.game_api import rate_limiter
from blueprints.admin_api import _login_attempts


class TestConfig(Config):
    TESTING = True
    SECRET_KEY = "test-secret"
    ADMIN_PASSWORD = "testpass"
    BASE_URL = "http://localhost:5000"
    SOCKETIO_ASYNC_MODE = "threading"
    SESSION_TYPE = "filesystem"  # keep as-is; pytest handles it fine


@pytest.fixture()
def app():
    """Create a fresh Flask app with a temporary on-disk SQLite database."""
    db_fd, db_path = tempfile.mkstemp(suffix=".db")
    os.close(db_fd)

    TestConfig.SQLALCHEMY_DATABASE_URI = f"sqlite:///{db_path}"
    application = create_app(TestConfig)

    yield application

    # Clean rate limiter state so tests don't bleed into each other
    rate_limiter.clear()
    _login_attempts.clear()
    os.unlink(db_path)


@pytest.fixture()
def client(app):
    """Unauthenticated test client."""
    return app.test_client()


@pytest.fixture()
def admin_client(app):
    """Test client pre-authenticated as admin."""
    c = app.test_client()
    c.post("/admin/api/login", json={"password": "testpass"})
    return c


@pytest.fixture()
def ws_client(app):
    """WebSocket test client connected to the app's SocketIO instance."""
    import socket_events
    ws = socket_events.socketio.test_client(app)
    yield ws
    # Disconnect after each test to avoid polluting the global SocketIO state
    ws.disconnect()
