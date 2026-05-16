from datetime import datetime, timezone, timedelta
from flask import Blueprint, request, jsonify
from models import db, Player, Tag, ScanEvent, GameSettings, TagPlayerScan
from sqlalchemy.exc import IntegrityError
from strategies import get_strategy

game_api = Blueprint("game_api", __name__)

# In-memory rate limiter: {player_id: last_scan_datetime}
rate_limiter: dict[str, datetime] = {}
RATE_LIMIT_SECONDS = 1
RATE_LIMIT_CLEANUP_AGE = 10  # seconds; entries older than this are purged


def _cleanup_rate_limiter():
    """Remove stale entries from the rate limiter dict."""
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=RATE_LIMIT_CLEANUP_AGE)
    stale = [pid for pid, ts in rate_limiter.items() if ts < cutoff]
    for pid in stale:
        del rate_limiter[pid]


def _get_rank(player_id: str, points_override: int | None = None) -> int:
    """Return 1-based rank of a player by points (higher is better)."""
    if points_override is not None:
        # Count players with strictly more points than the override value
        better = db.session.query(Player).filter(
            Player.points > points_override,
            Player.id != player_id,
        ).count()
        return better + 1
    player = db.session.get(Player, player_id)
    if player is None:
        return 0
    better = db.session.query(Player).filter(Player.points > player.points).count()
    return better + 1


@game_api.route("/register", methods=["POST"])
def register():
    """Register a new player or return existing one (idempotent by player_id)."""
    data = request.get_json(silent=True) or {}
    player_id = (data.get("player_id") or "").strip()
    nick = (data.get("nick") or "").strip()

    if not player_id or not nick:
        return jsonify({"error": "Необходимы player_id и nick"}), 400

    # Block registration if the game has already ended
    settings = db.session.get(GameSettings, 1)
    if settings is not None:
        now = datetime.now(timezone.utc)
        if settings.get_status(now) == "finished":
            return jsonify({"error": "Регистрация закрыта — игра завершена"}), 403

    # Idempotency: if player_id already exists, return existing player
    existing_by_id = db.session.get(Player, player_id)
    if existing_by_id:
        return jsonify({
            "player_id": existing_by_id.id,
            "nick": existing_by_id.nick,
            "points": existing_by_id.points,
        }), 200

    # Nick conflict: another player already holds this nick
    existing_by_nick = db.session.query(Player).filter_by(nick=nick).first()
    if existing_by_nick and existing_by_nick.id != player_id:
        return jsonify({"error": "Никнейм уже занят"}), 409

    player = Player(id=player_id, nick=nick, points=0)
    db.session.add(player)
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"error": "Никнейм уже занят"}), 409

    return jsonify({
        "player_id": player.id,
        "nick": player.nick,
        "points": player.points,
    }), 201


@game_api.route("/scan", methods=["POST"])
def scan():
    """Process an NFC tag scan for a player."""
    from socket_events import broadcast_scoreboard  # deferred to avoid circular import

    _cleanup_rate_limiter()

    data = request.get_json(silent=True) or {}
    tag_id = (data.get("tag_id") or "").strip()
    player_id = (data.get("player_id") or "").strip()

    if not tag_id or not player_id:
        return jsonify({"error": "Необходимы tag_id и player_id"}), 400

    # --- Rate limit check ---
    now = datetime.now(timezone.utc)
    last_scan = rate_limiter.get(player_id)
    if last_scan and (now - last_scan).total_seconds() < RATE_LIMIT_SECONDS:
        return jsonify({"status": "rate_limit", "message": "Подождите секунду и попробуйте снова."}), 429

    # Update rate limiter immediately after passing the rate limit check
    rate_limiter[player_id] = now

    # --- Game status check ---
    settings = db.session.get(GameSettings, 1)
    if settings is None:
        # Safety fallback: create default settings
        settings = GameSettings(id=1)
        db.session.add(settings)
        db.session.commit()

    game_status = settings.get_status(now)
    registered_count = db.session.query(Player).count()

    if game_status == "not_started":
        return jsonify({
            "status": "not_yet",
            "starts_at": settings.starts_at.strftime("%Y-%m-%dT%H:%M:%SZ") if settings.starts_at else None,
            "registered_count": registered_count,
        }), 200

    if game_status == "finished":
        return jsonify({
            "status": "finished",
            "award_message": settings.award_message or "",
        }), 200

    # --- Player lookup ---
    player = db.session.get(Player, player_id)
    if player is None:
        return jsonify({"error": "Игрок не найден"}), 404

    # --- Tag lookup ---
    tag = db.session.get(Tag, tag_id)
    if tag is None:
        return jsonify({"status": "unknown", "tag_id": tag_id}), 200

    # --- Strategy application ---
    strategy = get_strategy(tag.strategy)
    if strategy is None:
        return jsonify({"status": "unknown", "tag_id": tag_id}), 200

    rank_before = _get_rank(player_id, points_override=player.points)
    points_before = player.points

    delta, result_status = strategy.apply(tag, player_id, db.session)

    if result_status == "locked":
        # Record the locked scan event
        event = ScanEvent(tag_id=tag_id, player_id=player_id, delta_points=0, result="locked")
        db.session.add(event)
        db.session.commit()
        return jsonify({"status": "locked", "tag_id": tag_id}), 200

    # --- Award points ---
    player.points += delta
    db.session.add(player)

    event = ScanEvent(tag_id=tag_id, player_id=player_id, delta_points=delta, result="ok")
    db.session.add(event)
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"status": "locked", "tag_id": tag_id}), 200

    rank_after = _get_rank(player_id, points_override=player.points)
    points_after = player.points

    # Build strategy_display string
    sign = "+" if delta >= 0 else ""
    if tag.strategy == "random":
        strategy_display = f"hidden · random {sign}{delta}"
    elif tag.strategy in ("one_time_global", "one_time_per_player"):
        strategy_display = f"hidden · {tag.strategy} {sign}{delta}"
    else:
        strategy_display = f"hidden · {tag.strategy} {sign}{delta}"

    meta = f"{points_before} → {points_after}  ·  место #{rank_before} → #{rank_after}"

    # Broadcast updated scoreboard to all WebSocket clients
    broadcast_scoreboard()

    return jsonify({
        "status": "ok",
        "delta": delta,
        "total": points_after,
        "tag_id": tag_id,
        "strategy": tag.strategy,
        "strategy_display": strategy_display,
        "meta": meta,
    }), 200


@game_api.route("/scoreboard", methods=["GET"])
def scoreboard():
    """Return current scoreboard with player rankings and game stats."""
    now = datetime.now(timezone.utc)

    players = db.session.query(Player).order_by(Player.points.desc(), Player.registered_at.asc()).all()
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

    # scans_per_minute: count ScanEvents in last 5 minutes
    five_min_ago = now.replace(tzinfo=None) - timedelta(minutes=5)
    recent_scans = db.session.query(ScanEvent).filter(ScanEvent.scanned_at >= five_min_ago).count()
    scans_per_minute = round(recent_scans / 5.0, 1)

    return jsonify({
        "players": players_data,
        "game": game_data,
        "stats": {
            "total_players": total_players,
            "total_tags": total_tags,
            "scans_per_minute": scans_per_minute,
        },
    }), 200
