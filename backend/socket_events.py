from datetime import datetime, timezone, timedelta
from flask_socketio import emit

# socketio instance is injected from app.py after creation
socketio = None  # will be set by app.py via init_socketio()


def init_socketio(sio):
    """Bind the SocketIO instance and register event handlers."""
    global socketio
    socketio = sio

    @sio.on("connect")
    def on_connect():
        """Send current scoreboard data to the newly connected client."""
        data = _build_scoreboard_data()
        emit("scoreboard_update", data)


def broadcast_scoreboard():
    """Emit scoreboard_update to all connected clients (called after a scan)."""
    if socketio is None:
        return
    data = _build_scoreboard_data()
    socketio.emit("scoreboard_update", data)


def _build_scoreboard_data() -> dict:
    """Assemble scoreboard payload (same shape as GET /api/scoreboard)."""
    from models import db, Player, Tag, ScanEvent, GameSettings  # deferred to avoid circular import
    from sqlalchemy.orm import joinedload

    now = datetime.now(timezone.utc)

    players = db.session.query(Player).order_by(Player.points.desc()).all()
    players_data = [
        {"rank": i + 1, "nick": p.nick, "points": p.points}
        for i, p in enumerate(players)
    ]

    settings = db.session.get(GameSettings, 1)
    game_status = settings.get_status(now) if settings else "not_started"

    game_data = {
        "status": game_status,
        "starts_at": settings.starts_at.strftime("%Y-%m-%dT%H:%M:%SZ") if settings and settings.starts_at else None,
        "ends_at": settings.ends_at.strftime("%Y-%m-%dT%H:%M:%SZ") if settings and settings.ends_at else None,
        "award_message": settings.award_message if settings else "",
    }

    total_players = len(players)
    total_tags = db.session.query(Tag).count()

    five_min_ago = now.replace(tzinfo=None) - timedelta(minutes=5)
    recent_scans_count = db.session.query(ScanEvent).filter(ScanEvent.scanned_at >= five_min_ago).count()
    scans_per_minute = round(recent_scans_count / 5.0, 1)

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
    }
