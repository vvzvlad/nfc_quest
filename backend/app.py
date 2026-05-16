import os
from flask import Flask, send_from_directory
from flask_socketio import SocketIO
from flask_cors import CORS
from werkzeug.middleware.proxy_fix import ProxyFix
from config import Config
from models import db, GameSettings
from blueprints.game_api import game_api
from blueprints.admin_api import admin_api
import socket_events as _socket_events


def create_app(config_class=Config) -> Flask:
    """Flask application factory."""
    app = Flask(__name__, static_folder=None)
    app.config.from_object(config_class)

    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

    # Ensure the SQLite data directory exists
    db_uri = app.config.get("SQLALCHEMY_DATABASE_URI", "")
    if db_uri.startswith("sqlite:///"):
        db_path = db_uri[len("sqlite:///"):]
        db_dir = os.path.dirname(db_path)
        if db_dir:
            os.makedirs(db_dir, exist_ok=True)

    # Extensions
    db.init_app(app)

    # CORS: allow the Vite dev server during development
    CORS(app, origins=["http://localhost:5173", "http://127.0.0.1:5173"], supports_credentials=True)

    # SocketIO with configurable async mode (use "threading" for tests)
    socketio = SocketIO(
        app,
        async_mode=app.config.get("SOCKETIO_ASYNC_MODE", "threading"),
        cors_allowed_origins="*",
    )

    # Register blueprints
    app.register_blueprint(game_api, url_prefix="/api")
    app.register_blueprint(admin_api, url_prefix="/admin/api")

    # Bind socketio to socket_events module and register handlers
    _socket_events.init_socketio(socketio)

    # Create tables and seed initial GameSettings row
    with app.app_context():
        db.create_all()
        if db.session.get(GameSettings, 1) is None:
            db.session.add(GameSettings(id=1, award_message=""))
            db.session.commit()

    # ---------------------------------------------------------------------------
    # Serve frontend static files for all non-API routes
    # ---------------------------------------------------------------------------
    frontend_dist = os.path.join(os.path.dirname(__file__), "..", "static")
    frontend_dist = os.path.abspath(frontend_dist)

    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve_frontend(path):
        """Serve React SPA; fall back to index.html for client-side routing."""
        if path and os.path.exists(os.path.join(frontend_dist, path)):
            return send_from_directory(frontend_dist, path)
        return send_from_directory(frontend_dist, "index.html")

    return app


# Allow running with `python app.py` during development
if __name__ == "__main__":
    application = create_app()
    # Access the socketio bound to this app via the module-level reference
    _socket_events.socketio.run(application, host="0.0.0.0", port=5000, debug=True)
