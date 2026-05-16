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

    # E-M1: Players with equal points should receive different ranks based on registration order.
    # NOTE: scoreboard() assigns ranks as i+1 (positional), NOT via _get_rank().
    # The ORDER BY points DESC has no secondary sort, so order for equal-points players
    # is SQLite-implementation-defined. This test currently passes because the lexicographic
    # order of PKs ("player-em1a" < "player-em1b") happens to match registration order.
    # Once a proper secondary sort by registered_at is added, the test will be deterministic.
    def test_scoreboard_tie_breaking_by_registration_order(self, client, admin_client):
        start_game(admin_client)

        # Alice registers first, Bob second
        register_player(client, "player-em1a", "Alice")
        register_player(client, "player-em1b", "Bob")

        # Give both players exactly 50 points
        admin_client.post("/admin/api/players/player-em1a/adjust", json={"delta": 50})
        admin_client.post("/admin/api/players/player-em1b/adjust", json={"delta": 50})

        r = client.get("/api/scoreboard")
        assert r.status_code == 200
        players = r.get_json()["players"]
        assert len(players) == 2

        # Find Alice and Bob by nick
        alice = next(p for p in players if p["nick"] == "Alice")
        bob = next(p for p in players if p["nick"] == "Bob")

        # Alice registered first, so she should be rank 1; Bob rank 2
        assert alice["rank"] == 1, f"Alice should be rank 1 but got {alice['rank']}"
        assert bob["rank"] == 2, f"Bob should be rank 2 but got {bob['rank']}"

    # E-M2: Scoreboard for a not_started game includes a starts_at ISO-8601 string
    def test_scoreboard_not_started_has_starts_at(self, client, admin_client):
        future_starts = "2099-06-01T12:00:00Z"
        admin_client.put(
            "/admin/api/game",
            json={"starts_at": future_starts, "ends_at": "2099-12-31T00:00:00Z"},
        )

        r = client.get("/api/scoreboard")
        assert r.status_code == 200
        body = r.get_json()

        assert body["game"]["status"] == "not_started"
        assert body["game"]["starts_at"] is not None
        # Must be a valid ISO-8601 string (contains date separator)
        assert isinstance(body["game"]["starts_at"], str)
        assert "T" in body["game"]["starts_at"]

    # E-M3: Scoreboard for a finished game exposes the configured award_message
    def test_scoreboard_finished_has_award_message(self, client, admin_client):
        admin_client.put(
            "/admin/api/game",
            json={
                "starts_at": "2000-01-01T00:00:00Z",
                "ends_at": "2000-06-01T00:00:00Z",
                "award_message": "Ceremony at 6pm",
            },
        )

        r = client.get("/api/scoreboard")
        assert r.status_code == 200
        body = r.get_json()

        assert body["game"]["status"] == "finished"
        assert body["game"]["award_message"] == "Ceremony at 6pm"

    # E-M4: Scoreboard includes players with zero points
    def test_scoreboard_includes_zero_points_players(self, client, admin_client):
        start_game(admin_client)
        register_player(client, "player-em4a", "PlayerEM4A")
        register_player(client, "player-em4b", "PlayerEM4B")

        # Only give points to player A; player B stays at 0
        admin_client.post("/admin/api/players/player-em4a/adjust", json={"delta": 50})

        r = client.get("/api/scoreboard")
        assert r.status_code == 200
        players = r.get_json()["players"]
        assert len(players) == 2

        nicks = {p["nick"] for p in players}
        assert "PlayerEM4A" in nicks
        assert "PlayerEM4B" in nicks

        player_b = next(p for p in players if p["nick"] == "PlayerEM4B")
        assert player_b["points"] == 0

    # E-M5: scans_per_minute is > 0 after recent scans
    def test_scoreboard_scans_per_minute_nonzero(self, client, admin_client):
        start_game(admin_client)
        register_player(client, "player-em5", "PlayerEM5")
        tags = create_tag(admin_client, "unlimited", {"points": 5})
        tag_id = tags[0]["id"]

        # Perform 3 scans
        for _ in range(3):
            rate_limiter.clear()
            scan_tag(client, "player-em5", tag_id)

        r = client.get("/api/scoreboard")
        assert r.status_code == 200
        stats = r.get_json()["stats"]
        assert stats["scans_per_minute"] > 0
