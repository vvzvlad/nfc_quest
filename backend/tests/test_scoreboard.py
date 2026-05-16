"""
Block E: Scoreboard endpoint tests.
"""
from helpers import start_game, create_tag, register_player, scan_tag
from blueprints.game_api import rate_limiter


class TestScoreboard:
    # E1: Players are ordered by points descending; ranks are correct
    def test_scoreboard_ordering(self, client, admin_client):
        start_game(admin_client)

        # Register three players
        register_player(client, "player-e1a", "Alice")
        register_player(client, "player-e1b", "Bob")
        register_player(client, "player-e1c", "Charlie")

        # Give them different point totals via admin adjust
        admin_client.post("/admin/api/players/player-e1a/adjust", json={"delta": 100})
        admin_client.post("/admin/api/players/player-e1b/adjust", json={"delta": 50})
        admin_client.post("/admin/api/players/player-e1c/adjust", json={"delta": 200})

        r = client.get("/api/scoreboard")
        assert r.status_code == 200
        body = r.get_json()

        players = body["players"]
        assert len(players) == 3

        # First place: Charlie with 200 points
        assert players[0]["points"] == 200
        assert players[0]["rank"] == 1
        assert players[0]["nick"] == "Charlie"

        # Second place: Alice with 100 points
        assert players[1]["points"] == 100
        assert players[1]["rank"] == 2

        # Third place: Bob with 50 points
        assert players[2]["points"] == 50
        assert players[2]["rank"] == 3

    # E2: Empty database → 200 with empty players list and game status "not_started"
    def test_scoreboard_empty_db(self, client):
        r = client.get("/api/scoreboard")
        assert r.status_code == 200
        body = r.get_json()

        assert body["players"] == []
        assert body["game"]["status"] == "not_started"
        # stats key must be present and contain expected sub-keys
        assert "stats" in body
        assert "total_players" in body["stats"]
        assert "total_tags" in body["stats"]
        assert "scans_per_minute" in body["stats"]
        assert body["stats"]["total_players"] == 0
        assert body["stats"]["total_tags"] == 0
        assert body["stats"]["scans_per_minute"] == 0.0
