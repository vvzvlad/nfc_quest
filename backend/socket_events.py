import logging
import time
import threading
from datetime import datetime, timezone, timedelta
from flask_socketio import emit

logger = logging.getLogger(__name__)

# socketio instance is injected from app.py after creation
socketio = None  # will be set by app.py via init_socketio()

_app = None
_last_broadcast_status: str | None = None
_broadcast_thread: threading.Thread | None = None
# Server start timestamp — set in init_socketio(), not at import time.
# Used to compute server_uptime in every scoreboard_update payload so clients can detect a restart.
_server_start_time: float | None = None


def init_socketio(sio, app=None):
    """Bind the SocketIO instance and register event handlers."""
    global socketio, _app, _server_start_time
    socketio = sio
    _app = app
    _server_start_time = time.time()  # record actual server start time (not module import time)

    @sio.on("connect")
    def on_connect():
        """Send current scoreboard data to the newly connected client."""
        data = _build_scoreboard_data()
        emit("scoreboard_update", data)

    if app is not None:
        _start_periodic_broadcast(sio, app)


def _start_periodic_broadcast(sio, app):
    """Broadcast scoreboard every 5s so clients see status transitions (active->finished, not_started->active)."""
    global _broadcast_thread
    if _broadcast_thread is not None and _broadcast_thread.is_alive():
        return

    def _tick():
        global _last_broadcast_status
        while True:
            time.sleep(5)
            try:
                with app.app_context():
                    data = _build_scoreboard_data()
                    new_status = data.get("game", {}).get("status")
                    if new_status != _last_broadcast_status:
                        sio.emit("scoreboard_update", data)
                        _last_broadcast_status = new_status
            except Exception as e:
                logger.exception("Periodic broadcast failed: %s", e)

    _broadcast_thread = threading.Thread(target=_tick, daemon=True)
    _broadcast_thread.start()


def broadcast_scoreboard():
    """Emit scoreboard_update to all connected clients (called after a scan)."""
    if socketio is None:
        return
    data = _build_scoreboard_data()
    socketio.emit("scoreboard_update", data)


def _build_scoreboard_data() -> dict:
    """Assemble scoreboard payload (same shape as GET /api/scoreboard)."""
    from models import db, Player, Tag, ScanEvent, GameSettings  # deferred to avoid circular import
    from sqlalchemy import func
    from sqlalchemy.orm import joinedload

    now = datetime.now(timezone.utc)

    players = db.session.query(Player).order_by(Player.points.desc()).all()

    # Build a map player_id -> latest successful scan timestamp
    player_ids = [p.id for p in players]
    last_scan_rows = (
        db.session.query(ScanEvent.player_id, func.max(ScanEvent.scanned_at).label("last_scan"))
        .filter(ScanEvent.player_id.in_(player_ids), ScanEvent.result == "ok")
        .group_by(ScanEvent.player_id)
        .all()
    ) if player_ids else []
    last_scan_map = {row.player_id: row.last_scan for row in last_scan_rows}

    players_data = [
        {
            "rank": i + 1,
            "nick": p.nick,
            "points": p.points,
            "last_scan_at": last_scan_map[p.id].strftime("%Y-%m-%dT%H:%M:%SZ") if p.id in last_scan_map else None,
        }
        for i, p in enumerate(players)
    ]

    settings = db.session.get(GameSettings, 1)
    game_status = settings.get_status(now) if settings else "not_started"

    game_data = {
        "status": game_status,
        "starts_at": settings.starts_at.strftime("%Y-%m-%dT%H:%M:%SZ") if settings and settings.starts_at else None,
        "ends_at": settings.ends_at.strftime("%Y-%m-%dT%H:%M:%SZ") if settings and settings.ends_at else None,
        "award_message": settings.award_message or "" if settings else "",
        "promo_html": settings.promo_html or "" if settings else "",  # keep WS payload in sync with HTTP scoreboard
    }

    total_players = len(players)
    total_tags = db.session.query(Tag).count()

    five_min_ago = now.replace(tzinfo=None) - timedelta(minutes=5)
    recent_scans_count = db.session.query(ScanEvent).filter(ScanEvent.scanned_at >= five_min_ago).count()
    scans_per_minute = round(recent_scans_count / 5.0, 1)

    # Guard: _server_start_time is None only if _build_scoreboard_data() is called before
    # init_socketio() — should not happen in production, but can occur in isolated unit tests.
    # Fall back to 0.0 to ensure the field is always present in the payload.
    # Note: 0.0 would trigger a client reload if the client previously saw a larger uptime,
    # but this path is unreachable in production (init_socketio always runs before any connect).
    server_uptime = (time.time() - _server_start_time) if _server_start_time is not None else 0.0

    recent_events = (
        db.session.query(ScanEvent)
        .options(joinedload(ScanEvent.player))  # eagerly load player to avoid N+1 queries
        .filter(ScanEvent.result == "ok", ScanEvent.player_id.isnot(None))  # exclude orphaned events (deleted players)
        .order_by(ScanEvent.scanned_at.desc())
        .limit(10)
        .all()
    )
    recent_scans_data = [
        {
            "nick": ev.player.nick if ev.player else (ev.player_id or "<deleted>"),
            "delta": ev.delta_points,
            "scanned_at": ev.scanned_at.strftime("%Y-%m-%dT%H:%M:%SZ") if ev.scanned_at else None,
        }
        for ev in recent_events
    ]

    return {
        "players": players_data,
        "game": game_data,
        "stats": {
            "total_players": total_players,
            "total_tags": total_tags,
            "scans_per_minute": scans_per_minute,
        },
        "recent_scans": recent_scans_data,
        "server_uptime": server_uptime,  # seconds since server start; client reloads when this drops
    }
