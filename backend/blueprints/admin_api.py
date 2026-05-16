import random
import string
from datetime import datetime, timezone, timedelta
from functools import wraps

from flask import Blueprint, request, jsonify, session, current_app
from sqlalchemy import func

from models import db, Player, Tag, ScanEvent, GameSettings, TagPlayerScan

admin_api = Blueprint("admin_api", __name__)

# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------


def _require_admin(f):
    """Decorator: reject request if not logged in as admin."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get("admin"):
            return jsonify({"error": "Unauthorized"}), 401
        return f(*args, **kwargs)
    return decorated


# ---------------------------------------------------------------------------
# Auth endpoints
# ---------------------------------------------------------------------------


@admin_api.route("/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    password = data.get("password", "")
    if password == current_app.config["ADMIN_PASSWORD"]:
        session["admin"] = True
        return jsonify({"ok": True}), 200
    return jsonify({"error": "Invalid password"}), 401


@admin_api.route("/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"ok": True}), 200


@admin_api.route("/me", methods=["GET"])
def me():
    return jsonify({"authenticated": bool(session.get("admin"))}), 200


# ---------------------------------------------------------------------------
# Game settings
# ---------------------------------------------------------------------------


@admin_api.route("/game", methods=["GET"])
@_require_admin
def get_game():
    settings = _get_or_create_settings()
    return jsonify(settings.to_dict()), 200


@admin_api.route("/game", methods=["PUT"])
@_require_admin
def put_game():
    data = request.get_json(silent=True) or {}
    settings = _get_or_create_settings()

    if "starts_at" in data:
        val = data["starts_at"]
        settings.starts_at = _parse_dt(val) if val else None

    if "ends_at" in data:
        val = data["ends_at"]
        settings.ends_at = _parse_dt(val) if val else None

    if "award_message" in data:
        settings.award_message = data["award_message"]

    # Validate: if both dates are set, ends_at must be at least 10 minutes after starts_at
    if settings.starts_at is not None and settings.ends_at is not None:
        min_duration = timedelta(minutes=10)
        if settings.ends_at <= settings.starts_at:
            return jsonify({"error": "ends_at must be after starts_at"}), 400
        if (settings.ends_at - settings.starts_at) < min_duration:
            return jsonify({"error": "Game must last at least 10 minutes"}), 400

    db.session.commit()
    return jsonify(settings.to_dict()), 200


@admin_api.route("/game/start", methods=["POST"])
@_require_admin
def start_game():
    """Set starts_at=now; if ends_at is missing or in the past, set ends_at=now+2h."""
    settings = _get_or_create_settings()
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    settings.starts_at = now
    if settings.ends_at is None or settings.ends_at < now:
        settings.ends_at = now + timedelta(hours=2)

    db.session.commit()
    return jsonify(settings.to_dict()), 200


@admin_api.route("/game/stop", methods=["POST"])
@_require_admin
def stop_game():
    """Set ends_at=now to immediately finish the game."""
    settings = _get_or_create_settings()
    settings.ends_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.session.commit()
    return jsonify(settings.to_dict()), 200


# ---------------------------------------------------------------------------
# Players bulk operations
# ---------------------------------------------------------------------------


@admin_api.route("/players", methods=["DELETE"])
@_require_admin
def delete_all_players():
    """Delete all players, scan events, and tag-player scan records."""
    count = db.session.query(Player).count()
    db.session.query(TagPlayerScan).delete()
    db.session.query(ScanEvent).delete()
    db.session.query(Player).delete()
    # Reset all tag block states so tags work for new players after a game restart
    db.session.query(Tag).update({"is_blocked": False})
    db.session.commit()
    return jsonify({"ok": True, "deleted": count}), 200


@admin_api.route("/players", methods=["GET"])
@_require_admin
def list_players():
    """Paginated player list with search and scan stats."""
    page, per_page = _get_pagination_args()
    search = request.args.get("search", "").strip()

    query = db.session.query(Player)
    if search:
        query = query.filter(Player.nick.ilike(f"%{search}%"))

    total = query.count()
    players = query.order_by(Player.points.desc()).offset((page - 1) * per_page).limit(per_page).all()

    items = []
    for p in players:
        scan_count = db.session.query(ScanEvent).filter_by(player_id=p.id, result="ok").count()
        penalty_count = db.session.query(ScanEvent).filter(
            ScanEvent.player_id == p.id,
            ScanEvent.delta_points < 0,
        ).count()
        item = p.to_dict()
        item["scan_count"] = scan_count
        item["penalty_count"] = penalty_count
        items.append(item)

    return jsonify({"items": items, "total": total, "page": page, "per_page": per_page}), 200


@admin_api.route("/players/<player_id>/adjust", methods=["POST"])
@_require_admin
def adjust_player(player_id):
    """Add or subtract points from a player."""
    data = request.get_json(silent=True) or {}
    delta = data.get("delta", 0)

    player = db.session.get(Player, player_id)
    if player is None:
        return jsonify({"error": "Player not found"}), 404

    try:
        delta_int = int(delta)
    except (TypeError, ValueError):
        return jsonify({"error": "delta must be a number"}), 400

    player.points += delta_int
    db.session.commit()

    # Broadcast updated scoreboard to all connected WebSocket clients
    from socket_events import broadcast_scoreboard  # deferred import to avoid circular deps
    broadcast_scoreboard()

    return jsonify({"player_id": player.id, "nick": player.nick, "points": player.points}), 200


@admin_api.route("/players/<player_id>", methods=["DELETE"])
@_require_admin
def delete_player(player_id):
    """Delete a single player and their scan events."""
    player = db.session.get(Player, player_id)
    if player is None:
        return jsonify({"error": "Player not found"}), 404

    db.session.query(TagPlayerScan).filter_by(player_id=player_id).delete()
    db.session.query(ScanEvent).filter_by(player_id=player_id).delete()
    db.session.delete(player)
    db.session.commit()
    return jsonify({"ok": True}), 200


# ---------------------------------------------------------------------------
# Tags bulk operations
# ---------------------------------------------------------------------------


@admin_api.route("/tags", methods=["DELETE"])
@_require_admin
def delete_all_tags():
    """Delete all tags, related scan events, and tag-player scan records."""
    count = db.session.query(Tag).count()
    db.session.query(TagPlayerScan).delete()
    db.session.query(ScanEvent).delete()
    db.session.query(Tag).delete()
    db.session.commit()
    return jsonify({"ok": True, "deleted": count}), 200


@admin_api.route("/tags", methods=["GET"])
@_require_admin
def list_tags():
    """Paginated tag list with optional filters."""
    page, per_page = _get_pagination_args()
    strategy_filter = request.args.get("strategy", "all")
    status_filter = request.args.get("status", "all")
    search = request.args.get("search", "").strip()

    query = db.session.query(Tag)
    if strategy_filter and strategy_filter != "all":
        query = query.filter(Tag.strategy == strategy_filter)
    if status_filter == "blocked":
        query = query.filter(Tag.is_blocked == True)  # noqa: E712
    elif status_filter == "active":
        query = query.filter(Tag.is_blocked == False)  # noqa: E712
    if search:
        query = query.filter(
            (Tag.id.ilike(f"%{search}%")) | (Tag.label.ilike(f"%{search}%"))
        )

    total = query.count()
    tags = query.order_by(Tag.created_at.desc()).offset((page - 1) * per_page).limit(per_page).all()

    items = []
    for t in tags:
        scan_count = db.session.query(ScanEvent).filter_by(tag_id=t.id, result="ok").count()
        unique_players = db.session.query(func.count(func.distinct(ScanEvent.player_id))).filter(
            ScanEvent.tag_id == t.id,
            ScanEvent.result == "ok",
        ).scalar() or 0
        item = t.to_dict()
        item["scan_count"] = scan_count
        item["unique_players_count"] = unique_players
        items.append(item)

    return jsonify({"items": items, "total": total, "page": page, "per_page": per_page}), 200


@admin_api.route("/tags/batch", methods=["POST"])
@_require_admin
def create_tags_batch():
    """Generate a batch of new tags with the given strategy."""
    data = request.get_json(silent=True) or {}
    strategy = data.get("strategy", "unlimited")
    strategy_params = data.get("strategy_params", {})
    count = int(data.get("count", 1))
    label_prefix = data.get("label_prefix", "")

    base_url = current_app.config.get("BASE_URL", "http://localhost:5000")

    created = []
    attempts = 0
    while len(created) < count and attempts < count * 10:
        attempts += 1
        tag_id = _generate_tag_id()
        if db.session.get(Tag, tag_id) is not None:
            continue  # collision, try again

        label = f"{label_prefix}{tag_id}" if label_prefix else None
        tag = Tag(
            id=tag_id,
            label=label,
            strategy=strategy,
            strategy_params=strategy_params,
            is_blocked=False,
        )
        db.session.add(tag)
        created.append({"id": tag_id, "url": f"{base_url}/tag/{tag_id}"})

    db.session.commit()
    return jsonify({"items": created}), 201


@admin_api.route("/tags/<tag_id>", methods=["DELETE"])
@_require_admin
def delete_tag(tag_id):
    """Delete a tag and all related records."""
    tag = db.session.get(Tag, tag_id)
    if tag is None:
        return jsonify({"error": "Tag not found"}), 404

    db.session.query(TagPlayerScan).filter_by(tag_id=tag_id).delete()
    db.session.query(ScanEvent).filter_by(tag_id=tag_id).delete()
    db.session.delete(tag)
    db.session.commit()
    return jsonify({"ok": True}), 200


@admin_api.route("/tags/<tag_id>/reset", methods=["POST"])
@_require_admin
def reset_tag(tag_id):
    """Unblock tag and clear per-player scan records."""
    tag = db.session.get(Tag, tag_id)
    if tag is None:
        return jsonify({"error": "Tag not found"}), 404

    tag.is_blocked = False
    db.session.query(TagPlayerScan).filter_by(tag_id=tag_id).delete()
    db.session.commit()
    return jsonify({"ok": True}), 200


# ---------------------------------------------------------------------------
# Scan log
# ---------------------------------------------------------------------------


@admin_api.route("/log", methods=["GET"])
@_require_admin
def get_log():
    """Paginated scan event log with optional filters."""
    page, per_page = _get_pagination_args()
    player_id_filter = request.args.get("player_id", "").strip()
    tag_id_filter = request.args.get("tag_id", "").strip()
    result_filter = request.args.get("result", "").strip()

    query = db.session.query(ScanEvent)
    if player_id_filter:
        query = query.filter(ScanEvent.player_id == player_id_filter)
    if tag_id_filter:
        query = query.filter(ScanEvent.tag_id == tag_id_filter)
    if result_filter:
        query = query.filter(ScanEvent.result == result_filter)

    total = query.count()
    events = query.order_by(ScanEvent.scanned_at.desc()).offset((page - 1) * per_page).limit(per_page).all()

    items = []
    for e in events:
        player = db.session.get(Player, e.player_id)
        tag = db.session.get(Tag, e.tag_id)

        # Compute player's total points after this scan by summing all events up to and including this one
        total_after = db.session.query(func.sum(ScanEvent.delta_points)).filter(
            ScanEvent.player_id == e.player_id,
            ScanEvent.id <= e.id,
        ).scalar() or 0

        items.append({
            "id": e.id,
            "tag_id": e.tag_id,
            "player_nick": player.nick if player else e.player_id,
            "delta_points": e.delta_points,
            "result": e.result,
            "scanned_at": e.scanned_at.strftime("%Y-%m-%dT%H:%M:%SZ") if e.scanned_at else None,
            "player_total_after": total_after,
            "strategy": tag.strategy if tag else None,
        })

    return jsonify({"items": items, "total": total, "page": page, "per_page": per_page}), 200


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------


@admin_api.route("/stats", methods=["GET"])
@_require_admin
def get_stats():
    """Aggregate statistics about the game."""
    now = datetime.now(timezone.utc)
    five_min_ago = now.replace(tzinfo=None) - timedelta(minutes=5)

    total_players = db.session.query(Player).count()
    total_tags = db.session.query(Tag).count()
    total_scans = db.session.query(ScanEvent).count()
    active_tags = db.session.query(Tag).filter(Tag.is_blocked == False).count()  # noqa: E712

    recent_scans = db.session.query(ScanEvent).filter(ScanEvent.scanned_at >= five_min_ago).count()
    scans_per_minute = round(recent_scans / 5.0, 1)

    top_player = db.session.query(Player).order_by(Player.points.desc()).first()
    avg_score_result = db.session.query(func.avg(Player.points)).scalar()
    avg_score = int(avg_score_result) if avg_score_result is not None else 0

    return jsonify({
        "total_players": total_players,
        "total_tags": total_tags,
        "total_scans": total_scans,
        "active_tags": active_tags,
        "scans_per_minute": scans_per_minute,
        "max_score": {"nick": top_player.nick, "points": top_player.points} if top_player else None,
        "avg_score": avg_score,
    }), 200


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _generate_tag_id() -> str:
    """Generate a TAG ID in format XXXX-XXX using uppercase hex chars."""
    chars = string.digits + "ABCDEF"
    part1 = "".join(random.choices(chars, k=4))
    part2 = "".join(random.choices(chars, k=3))
    return f"{part1}-{part2}"


def _parse_dt(value: str) -> datetime | None:
    """Parse an ISO 8601 datetime string into a naive UTC datetime."""
    if not value:
        return None
    value = value.strip()
    try:
        # Replace trailing Z with +00:00 so fromisoformat handles it uniformly
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        # Normalize timezone-aware datetimes to naive UTC
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except ValueError:
        return None


def _get_or_create_settings() -> GameSettings:
    """Return the singleton GameSettings row, creating it if absent."""
    settings = db.session.get(GameSettings, 1)
    if settings is None:
        settings = GameSettings(id=1, award_message="")
        db.session.add(settings)
        db.session.commit()
    return settings


def _get_pagination_args() -> tuple[int, int]:
    """Extract and validate pagination query parameters."""
    try:
        page = max(1, int(request.args.get("page", 1)))
    except (ValueError, TypeError):
        page = 1
    try:
        per_page = min(200, max(1, int(request.args.get("per_page", 50))))
    except (ValueError, TypeError):
        per_page = 50
    return page, per_page
