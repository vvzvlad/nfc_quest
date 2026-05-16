"""
Shared helper functions for E2E test modules.
These are plain functions (not fixtures) that call the Flask test client.
"""


def start_game(admin_client):
    """Start the game via admin API."""
    admin_client.post("/admin/api/game/start")


def create_tag(admin_client, strategy, params, count=1):
    """Create tags via batch admin endpoint and return the list of items."""
    r = admin_client.post(
        "/admin/api/tags/batch",
        json={"strategy": strategy, "strategy_params": params, "count": count},
    )
    return r.get_json()["items"]


def register_player(client, player_id, nick):
    """Register a player and return the response."""
    return client.post("/api/register", json={"player_id": player_id, "nick": nick})


def scan_tag(client, player_id, tag_id):
    """Scan a tag for a player and return the response."""
    return client.post("/api/scan", json={"player_id": player_id, "tag_id": tag_id})
