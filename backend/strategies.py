import random as _random
from abc import ABC, abstractmethod

from sqlalchemy import update


class ScoringStrategy(ABC):
    """Base class for all tag scoring strategies."""

    name: str  # Unique identifier used in Tag.strategy field

    @abstractmethod
    def apply(self, tag, player_id: str, db_session) -> tuple[int, str]:
        """
        Apply the strategy and return (delta_points, result_status).

        result_status is one of:
          "ok"     — points were awarded
          "locked" — this scan was blocked (already used, etc.)
        """
        raise NotImplementedError


class OneTimeGlobalStrategy(ScoringStrategy):
    """
    Tag can be scanned only once by anyone.
    Once triggered, tag.is_blocked is set to True.
    strategy_params: {"points": N}
    """

    name = "one_time_global"

    def apply(self, tag, player_id: str, db_session) -> tuple[int, str]:
        from models import Tag

        result = db_session.execute(
            update(Tag).where(Tag.id == tag.id, Tag.is_blocked == False).values(is_blocked=True)
        )
        if result.rowcount == 0:
            return 0, "locked"

        points = int((tag.strategy_params or {}).get("points", 0))
        return points, "ok"


class OneTimePerPlayerStrategy(ScoringStrategy):
    """
    Each player can scan this tag only once.
    Uses TagPlayerScan table to track per-player usage.
    strategy_params: {"points": N}
    """

    name = "one_time_per_player"

    def apply(self, tag, player_id: str, db_session) -> tuple[int, str]:
        from models import TagPlayerScan  # local import to avoid circular deps

        existing = db_session.get(TagPlayerScan, (tag.id, player_id))
        if existing is not None:
            return 0, "locked"

        points = int((tag.strategy_params or {}).get("points", 0))
        record = TagPlayerScan(tag_id=tag.id, player_id=player_id)
        db_session.add(record)
        return points, "ok"


class UnlimitedStrategy(ScoringStrategy):
    """
    Always awards a fixed number of points, no restrictions.
    strategy_params: {"points": N}
    """

    name = "unlimited"

    def apply(self, tag, player_id: str, db_session) -> tuple[int, str]:
        points = int((tag.strategy_params or {}).get("points", 0))
        return points, "ok"


class RandomStrategy(ScoringStrategy):
    """
    Awards a random number of points within [min, max].
    strategy_params: {"min": N, "max": M}
    """

    name = "random"

    def apply(self, tag, player_id: str, db_session) -> tuple[int, str]:
        params = tag.strategy_params or {}
        lo = int(params.get("min", 0))
        hi = int(params.get("max", 0))
        if hi < lo:
            lo, hi = hi, lo
        points = _random.randint(lo, hi)
        return points, "ok"


# Registry: strategy name -> strategy instance
# To add a new strategy: create a subclass and add it here.
STRATEGIES: dict[str, ScoringStrategy] = {
    s.name: s
    for s in [
        OneTimeGlobalStrategy(),
        OneTimePerPlayerStrategy(),
        UnlimitedStrategy(),
        RandomStrategy(),
    ]
}

# Aliases: "fixed" and "penalty" map to existing strategies for UI compatibility
STRATEGIES["fixed"] = STRATEGIES["unlimited"]
STRATEGIES["oneshot"] = STRATEGIES["one_time_global"]
STRATEGIES["penalty"] = STRATEGIES["unlimited"]


def get_strategy(name: str) -> ScoringStrategy | None:
    """Look up a strategy by name. Returns None if not found."""
    return STRATEGIES.get(name)
