import re
import random
import string
from datetime import datetime, timezone, timedelta
from functools import wraps

from flask import Blueprint, request, jsonify, session, current_app
from sqlalchemy import func, case

from models import db, Player, Tag, ScanEvent, GameSettings, TagPlayerScan
from strategies import STRATEGIES

admin_api = Blueprint("admin_api", __name__)

# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

# Login rate limiter: {ip: [timestamp, timestamp, ...]}
_login_attempts: dict[str, list[datetime]] = {}
LOGIN_RATE_LIMIT_WINDOW = 60  # seconds
LOGIN_RATE_LIMIT_MAX = 5  # max attempts per window


def _require_admin(f):
    """Decorator: reject request if not logged in as admin."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get("admin"):
            return jsonify({"error": "UNAUTHORIZED"}), 401
        return f(*args, **kwargs)
    return decorated


def _check_login_rate_limit() -> bool:
    """Return True if the request is rate-limited."""
    ip = request.remote_addr or "unknown"
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(seconds=LOGIN_RATE_LIMIT_WINDOW)

    attempts = _login_attempts.get(ip, [])
    attempts = [t for t in attempts if t > cutoff]
    _login_attempts[ip] = attempts

    return len(attempts) >= LOGIN_RATE_LIMIT_MAX


# ---------------------------------------------------------------------------
# Auth endpoints
# ---------------------------------------------------------------------------


@admin_api.route("/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    password = data.get("password", "")
    ip = request.remote_addr or "unknown"
    now = datetime.now(timezone.utc)

    # Correct password always succeeds — clears any pending failures
    if password == current_app.config["ADMIN_PASSWORD"]:
        _login_attempts.pop(ip, None)
        session["admin"] = True
        return jsonify({"ok": True}), 200

    # Wrong password: check rate limit THEN record failure
    if _check_login_rate_limit():
        return jsonify({"error": "LOGIN_RATE_LIMIT"}), 429
    _login_attempts.setdefault(ip, []).append(now)
    return jsonify({"error": "WRONG_PASSWORD"}), 401


@admin_api.route("/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"ok": True}), 200


@admin_api.route("/me", methods=["GET"])
def me():
    return jsonify({"authenticated": bool(session.get("admin"))}), 200


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------


@admin_api.route("/strategies", methods=["GET"])
@_require_admin
def list_strategies():
    """Return metadata for all available tag strategies."""
    from strategies import get_strategies_meta
    return jsonify({"strategies": get_strategies_meta()}), 200


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
            return jsonify({"error": "GAME_END_BEFORE_START"}), 400
        if (settings.ends_at - settings.starts_at) < min_duration:
            return jsonify({"error": "GAME_TOO_SHORT"}), 400

    db.session.commit()
    return jsonify(settings.to_dict()), 200


@admin_api.route("/game/start", methods=["POST"])
@_require_admin
def start_game():
    """Set starts_at=now; if ends_at is missing or in the past, set ends_at=now+2h."""
    from socket_events import broadcast_scoreboard

    settings = _get_or_create_settings()
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    settings.starts_at = now
    if settings.ends_at is None or settings.ends_at < now:
        settings.ends_at = now + timedelta(hours=2)

    db.session.commit()
    broadcast_scoreboard()
    return jsonify(settings.to_dict()), 200


@admin_api.route("/game/stop", methods=["POST"])
@_require_admin
def stop_game():
    """Set ends_at=now to immediately finish the game."""
    from socket_events import broadcast_scoreboard

    settings = _get_or_create_settings()
    settings.ends_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.session.commit()
    broadcast_scoreboard()
    return jsonify(settings.to_dict()), 200


# ---------------------------------------------------------------------------
# Players bulk operations
# ---------------------------------------------------------------------------


@admin_api.route("/players", methods=["DELETE"])
@_require_admin
def delete_all_players():
    """Delete all players and tag-player scan records. Scan events are preserved."""
    from socket_events import broadcast_scoreboard

    count = db.session.query(Player).count()
    db.session.query(TagPlayerScan).delete()
    db.session.query(ScanEvent).update({"player_id": None})  # nullify FK before bulk delete
    db.session.query(Player).delete()
    # Reset all tag block states so tags work for new players after a game restart
    db.session.query(Tag).update({"is_blocked": False})
    db.session.commit()
    broadcast_scoreboard()
    return jsonify({"ok": True, "deleted": count}), 200


@admin_api.route("/players", methods=["GET"])
@_require_admin
def list_players():
    """Paginated player list with search, sort, and scan stats."""
    page, per_page = _get_pagination_args()
    search = request.args.get("search", "").strip()
    sort_by = request.args.get("sort_by", "points")

    query = db.session.query(Player)
    if search:
        query = query.filter(Player.nick.ilike(f"%{search}%"))

    total = query.count()

    # Apply sort order: by points desc (default) or by last scan activity desc (nulls last)
    if sort_by == "last_seen":
        last_scan_subq = (
            db.session.query(ScanEvent.player_id, func.max(ScanEvent.scanned_at).label("last_scan"))
            .filter(ScanEvent.result != "adjust")  # exclude admin adjustments from sort order
            .group_by(ScanEvent.player_id)
            .subquery()
        )
        query = query.outerjoin(last_scan_subq, Player.id == last_scan_subq.c.player_id)
        query = query.order_by(last_scan_subq.c.last_scan.desc().nullslast())
    else:
        query = query.order_by(Player.points.desc())

    players = query.offset((page - 1) * per_page).limit(per_page).all()

    # Pre-load last scan times for all returned players in one query (avoids N+1)
    player_ids = [p.id for p in players]
    last_seen_rows = (
        db.session.query(ScanEvent.player_id, func.max(ScanEvent.scanned_at).label("last_scan"))
        .filter(ScanEvent.player_id.in_(player_ids), ScanEvent.result != "adjust")
        .group_by(ScanEvent.player_id)
        .all()
    )
    last_seen_map = {row.player_id: row.last_scan for row in last_seen_rows}

    # Batch-load scan_count and penalty_count for all page players in one query
    scan_stats_rows = (
        db.session.query(
            ScanEvent.player_id,
            func.count(case((ScanEvent.result == "ok", 1))).label("scan_count"),
            func.count(
                case(((ScanEvent.delta_points < 0) & (ScanEvent.result != "adjust"), 1))
            ).label("penalty_count"),
        )
        .filter(ScanEvent.player_id.in_(player_ids))
        .group_by(ScanEvent.player_id)
        .all()
    )
    scan_stats_map = {row.player_id: (row.scan_count, row.penalty_count) for row in scan_stats_rows}

    items = []
    for p in players:
        scan_count, penalty_count = scan_stats_map.get(p.id, (0, 0))
        last_scan_dt = last_seen_map.get(p.id)
        item = p.to_dict()
        item["scan_count"] = scan_count
        item["penalty_count"] = penalty_count
        item["last_seen"] = last_scan_dt.strftime("%Y-%m-%dT%H:%M:%SZ") if last_scan_dt else None
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
        return jsonify({"error": "PLAYER_NOT_FOUND"}), 404

    try:
        delta_int = int(delta)
    except (TypeError, ValueError):
        return jsonify({"error": "INVALID_DELTA"}), 400

    if not (-10000 <= delta_int <= 10000):
        return jsonify({"error": "DELTA_OUT_OF_RANGE"}), 400

    player.points += delta_int

    # Log the adjustment as a special scan event for audit trail
    adjustment_event = ScanEvent(
        tag_id=None,
        player_id=player_id,
        delta_points=delta_int,
        result="adjust",
    )
    db.session.add(adjustment_event)
    db.session.commit()

    # Broadcast updated scoreboard to all connected WebSocket clients
    from socket_events import broadcast_scoreboard  # deferred import to avoid circular deps
    broadcast_scoreboard()

    return jsonify({"player_id": player.id, "nick": player.nick, "points": player.points}), 200


@admin_api.route("/players/<player_id>", methods=["DELETE"])
@_require_admin
def delete_player(player_id):
    """Delete a single player and their game-state records. Scan events are preserved."""
    from socket_events import broadcast_scoreboard

    player = db.session.get(Player, player_id)
    if player is None:
        return jsonify({"error": "PLAYER_NOT_FOUND"}), 404

    db.session.query(TagPlayerScan).filter_by(player_id=player_id).delete()
    db.session.query(ScanEvent).filter_by(player_id=player_id).update({"player_id": None})  # nullify FK before delete
    db.session.delete(player)
    db.session.commit()
    broadcast_scoreboard()
    return jsonify({"ok": True}), 200


# ---------------------------------------------------------------------------
# Tags bulk operations
# ---------------------------------------------------------------------------


@admin_api.route("/tags", methods=["DELETE"])
@_require_admin
def delete_all_tags():
    """Delete all tags and tag-player scan records. Scan events are preserved."""
    count = db.session.query(Tag).count()
    db.session.query(TagPlayerScan).delete()
    db.session.query(ScanEvent).update({"tag_id": None})  # nullify FK before bulk delete
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
    strategy = data.get("strategy", "one_time_per_player")
    strategy_params = data.get("strategy_params", {})
    try:
        count = min(int(data.get("count", 1)), 500)
    except (TypeError, ValueError):
        return jsonify({"error": "INVALID_COUNT"}), 400

    if strategy not in STRATEGIES:
        return jsonify({"error": "UNKNOWN_STRATEGY"}), 400
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


# ---------------------------------------------------------------------------
# Tags bulk operations
# ---------------------------------------------------------------------------


@admin_api.route("/tags/bulk_update", methods=["POST"])
@_require_admin
def bulk_update_tags():
    """Update strategy and/or strategy_params for a list of tag IDs."""
    data = request.get_json(silent=True) or {}
    ids = data.get("ids", [])
    # Validate: ids must be a non-empty list of strings, max 500
    if not isinstance(ids, list) or not ids:
        return jsonify({"error": "INVALID_IDS"}), 400
    ids = [str(i) for i in ids[:500]]

    # Validate strategy against known strategies if provided
    if "strategy" in data and data["strategy"] not in STRATEGIES:
        return jsonify({"error": "UNKNOWN_STRATEGY"}), 400

    # Validate strategy_params is a dict if provided
    if "strategy_params" in data and not isinstance(data.get("strategy_params"), dict):
        return jsonify({"error": "INVALID_STRATEGY_PARAMS"}), 400

    # Batch-load all existing tags in one query instead of N separate SELECTs
    tags_map = {t.id: t for t in db.session.query(Tag).filter(Tag.id.in_(ids)).all()}
    updated = 0
    for tag_id in ids:
        tag = tags_map.get(tag_id)
        if tag is None:
            continue
        if "strategy" in data:
            tag.strategy = data["strategy"]
        if "strategy_params" in data:
            tag.strategy_params = data["strategy_params"]
        updated += 1

    db.session.commit()
    return jsonify({"updated": updated}), 200


@admin_api.route("/tags/bulk_delete", methods=["POST"])
@_require_admin
def bulk_delete_tags():
    """Delete a list of tags by ID with proper FK cleanup."""
    data = request.get_json(silent=True) or {}
    ids = data.get("ids", [])
    if not isinstance(ids, list) or not ids:
        return jsonify({"error": "INVALID_IDS"}), 400
    ids = [str(i) for i in ids[:500]]

    # Find which of the requested IDs actually exist, to compute accurate deleted count
    existing_ids = [t.id for t in db.session.query(Tag.id).filter(Tag.id.in_(ids)).all()]
    deleted = len(existing_ids)

    if existing_ids:
        # Batch FK cleanup: remove per-player scan records and nullify scan event references
        db.session.query(TagPlayerScan).filter(TagPlayerScan.tag_id.in_(existing_ids)).delete(synchronize_session=False)
        db.session.query(ScanEvent).filter(ScanEvent.tag_id.in_(existing_ids)).update({"tag_id": None}, synchronize_session=False)
        db.session.query(Tag).filter(Tag.id.in_(existing_ids)).delete(synchronize_session=False)

    db.session.commit()
    return jsonify({"deleted": deleted}), 200


@admin_api.route("/tags/<tag_id>", methods=["PUT"])
@_require_admin
def update_tag(tag_id):
    """Update a tag's strategy, params, label, or rename its ID."""
    tag = db.session.get(Tag, tag_id)
    if tag is None:
        return jsonify({"error": "TAG_NOT_FOUND"}), 404

    data = request.get_json(silent=True) or {}

    # Handle tag_id rename if new_id is provided
    if "new_id" in data:
        raw_new_id = data["new_id"]
        if not isinstance(raw_new_id, str):
            return jsonify({"error": "INVALID_TAG_ID_FORMAT"}), 400
        new_id = raw_new_id.strip().upper()
        if not re.match(r'^[0-9A-F]{4}-[0-9A-F]{4}$', new_id):
            return jsonify({"error": "INVALID_TAG_ID_FORMAT"}), 400
        if new_id != tag_id:
            if db.session.get(Tag, new_id) is not None:
                return jsonify({"error": "TAG_ID_ALREADY_EXISTS"}), 409
            # Create new tag with new ID, preserving all existing fields
            new_tag = Tag(
                id=new_id,
                label=tag.label,
                strategy=tag.strategy,
                strategy_params=tag.strategy_params,
                is_blocked=tag.is_blocked,
                created_at=tag.created_at,
            )
            db.session.add(new_tag)
            db.session.flush()
            # Migrate FK references to the new tag_id
            db.session.query(ScanEvent).filter_by(tag_id=tag_id).update({"tag_id": new_id})
            db.session.query(TagPlayerScan).filter_by(tag_id=tag_id).update({"tag_id": new_id})
            db.session.flush()
            # Use direct SQL DELETE to bypass ORM cascade and avoid accidental orphan deletion
            db.session.execute(db.delete(Tag).where(Tag.id == tag_id))
            db.session.flush()
            tag = new_tag  # continue applying other fields to the new tag

    if "strategy" in data:
        tag.strategy = data["strategy"]
    if "strategy_params" in data:
        tag.strategy_params = data["strategy_params"]
    if "label" in data:
        tag.label = data["label"] or None

    db.session.commit()
    return jsonify(tag.to_dict()), 200


@admin_api.route("/tags/<tag_id>", methods=["DELETE"])
@_require_admin
def delete_tag(tag_id):
    """Delete a tag and its game-state records. Scan events are preserved."""
    tag = db.session.get(Tag, tag_id)
    if tag is None:
        return jsonify({"error": "TAG_NOT_FOUND"}), 404

    db.session.query(TagPlayerScan).filter_by(tag_id=tag_id).delete()
    db.session.query(ScanEvent).filter_by(tag_id=tag_id).update({"tag_id": None})  # nullify FK before delete
    db.session.delete(tag)
    db.session.commit()
    return jsonify({"ok": True}), 200


@admin_api.route("/tags/<tag_id>/reset", methods=["POST"])
@_require_admin
def reset_tag(tag_id):
    """Unblock tag and clear per-player scan records."""
    tag = db.session.get(Tag, tag_id)
    if tag is None:
        return jsonify({"error": "TAG_NOT_FOUND"}), 404

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
        # Guard against None PKs to avoid SAWarning / future SQLAlchemy errors
        player = db.session.get(Player, e.player_id) if e.player_id is not None else None
        tag = db.session.get(Tag, e.tag_id) if e.tag_id is not None else None

        # Compute cumulative points for this player up to this event
        # For orphaned events (player deleted), total_after is meaningless — return 0
        if e.player_id is None:
            total_after = 0
        else:
            total_after = db.session.query(func.sum(ScanEvent.delta_points)).filter(
                ScanEvent.player_id == e.player_id,
                ScanEvent.id <= e.id,
            ).scalar() or 0

        items.append({
            "id": e.id,
            "tag_id": e.tag_id,
            "player_id": e.player_id,
            "player_nick": player.nick if player else (e.player_id or "<deleted>"),
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
    """Generate a TAG ID in format XXXX-XXXX using uppercase hex chars."""
    chars = string.digits + "ABCDEF"
    part1 = "".join(random.choices(chars, k=4))
    part2 = "".join(random.choices(chars, k=4))
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
