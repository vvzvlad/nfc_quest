from datetime import datetime, timezone
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


class Player(db.Model):
    __tablename__ = "players"

    id = db.Column(db.String(36), primary_key=True)          # UUID string
    nick = db.Column(db.String(64), unique=True, nullable=False)
    points = db.Column(db.Integer, default=0, nullable=False)
    registered_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    scan_events = db.relationship("ScanEvent", back_populates="player", cascade="save-update, merge")
    tag_scans = db.relationship("TagPlayerScan", back_populates="player", cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "nick": self.nick,
            "points": self.points,
            "registered_at": self.registered_at.strftime("%Y-%m-%dT%H:%M:%SZ") if self.registered_at else None,
        }


class Tag(db.Model):
    __tablename__ = "tags"

    id = db.Column(db.String(16), primary_key=True)           # format: "4A7F-C01"
    label = db.Column(db.String(128), nullable=True)
    strategy = db.Column(db.String(64), nullable=False)
    strategy_params = db.Column(db.JSON, nullable=False, default=dict)
    is_blocked = db.Column(db.Boolean, default=False, nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    scan_events = db.relationship("ScanEvent", back_populates="tag", cascade="save-update, merge")
    player_scans = db.relationship("TagPlayerScan", back_populates="tag", cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "label": self.label,
            "strategy": self.strategy,
            "strategy_params": self.strategy_params,
            "is_blocked": self.is_blocked,
            "created_at": self.created_at.strftime("%Y-%m-%dT%H:%M:%SZ") if self.created_at else None,
        }


class ScanEvent(db.Model):
    __tablename__ = "scan_events"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    tag_id = db.Column(db.String(16), db.ForeignKey("tags.id", ondelete="SET NULL"), nullable=True)
    player_id = db.Column(db.String(36), db.ForeignKey("players.id", ondelete="SET NULL"), nullable=True)
    delta_points = db.Column(db.Integer, nullable=False, default=0)
    result = db.Column(db.String(32), nullable=False)         # "ok" | "locked" | "not_yet" | "finished" | "unknown" | "rate_limit"
    scanned_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    tag = db.relationship("Tag", back_populates="scan_events")
    player = db.relationship("Player", back_populates="scan_events")

    def to_dict(self):
        return {
            "id": self.id,
            "tag_id": self.tag_id,
            "player_id": self.player_id,
            "delta_points": self.delta_points,
            "result": self.result,
            "scanned_at": self.scanned_at.strftime("%Y-%m-%dT%H:%M:%SZ") if self.scanned_at else None,
        }


class GameSettings(db.Model):
    __tablename__ = "game_settings"

    id = db.Column(db.Integer, primary_key=True, default=1)   # always 1
    starts_at = db.Column(db.DateTime, nullable=True)
    ends_at = db.Column(db.DateTime, nullable=True)
    award_message = db.Column(db.String(512), default="")
    promo_html = db.Column(db.Text, default="")  # arbitrary HTML shown pre-game on welcome and not-yet screens

    def to_dict(self):
        return {
            "id": self.id,
            "starts_at": self.starts_at.strftime("%Y-%m-%dT%H:%M:%SZ") if self.starts_at else None,
            "ends_at": self.ends_at.strftime("%Y-%m-%dT%H:%M:%SZ") if self.ends_at else None,
            "award_message": self.award_message or "",
            "promo_html": self.promo_html or "",
        }

    def get_status(self, now=None):
        """Compute current game status based on starts_at/ends_at and current time."""
        if now is None:
            now = datetime.now(timezone.utc)
        # Strip timezone for comparison if stored as naive datetime
        now_naive = now.replace(tzinfo=None) if now.tzinfo else now

        if self.starts_at is None:
            return "not_started"
        if now_naive < self.starts_at:
            return "not_started"
        if self.ends_at is not None and now_naive > self.ends_at:
            return "finished"
        return "active"


class TagPlayerScan(db.Model):
    """Tracks which players have already scanned which tags (for one_time_per_player strategy)."""
    __tablename__ = "tag_player_scans"

    tag_id = db.Column(db.String(16), db.ForeignKey("tags.id"), primary_key=True)
    player_id = db.Column(db.String(36), db.ForeignKey("players.id"), primary_key=True)
    scanned_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    tag = db.relationship("Tag", back_populates="player_scans")
    player = db.relationship("Player", back_populates="tag_scans")
