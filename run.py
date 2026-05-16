"""
Root entry point for the NFC Quest backend.
Adds the backend/ directory to sys.path and starts the Flask+SocketIO server.
"""
import sys
import os

# Make backend/ importable without installing it as a package
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

from dotenv import load_dotenv
load_dotenv()

from app import create_app  # noqa: E402  (import after sys.path patch)
import socket_events as _socket_events  # noqa: E402

application = create_app()

if __name__ == "__main__":
    _socket_events.socketio.run(application, host="0.0.0.0", port=5000, debug=True)
