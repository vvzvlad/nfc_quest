"""
Game lifecycle tests: restart after stop, game boundary timing, game_status via scoreboard.
"""
from datetime import datetime, timezone, timedelta

from helpers import start_game, create_tag, register_player, scan_tag
from blueprints.game_api import rate_limiter


class TestGameStatusViaScoreboard:
    def test_game_status_not_started(self, client):
        """GET /api/scoreboard returns game status 'not_started' by default."""
        r = client.get("/api/scoreboard")
        assert r.status_code == 200
        assert r.get_json()["game"]["status"] == "not_started"

    def test_game_status_active(self, client, admin_client):
        """After starting the game, status is 'active'."""
        start_game(admin_client)
        r = client.get("/api/scoreboard")
        assert r.status_code == 200
        assert r.get_json()["game"]["status"] == "active"

    def test_game_status_finished(self, client, admin_client):
        """After stopping the game, status is 'finished'."""
        start_game(admin_client)
        admin_client.post("/admin/api/game/stop")
        r = client.get("/api/scoreboard")
        assert r.status_code == 200
        assert r.get_json()["game"]["status"] == "finished"


class TestGameRestart:
    def test_start_stop_start_scan_works(self, client, admin_client):
        """After start → stop → start, scanning should succeed again."""
        start_game(admin_client)
        register_player(client, "player-restart", "RestartPlayer")
        tags = create_tag(admin_client, "unlimited", {"points": 10})
        tag_id = tags[0]["id"]

        rate_limiter.clear()
        r1 = scan_tag(client, "player-restart", tag_id)
        assert r1.get_json()["status"] == "ok"

        admin_client.post("/admin/api/game/stop")

        rate_limiter.clear()
        r2 = scan_tag(client, "player-restart", tag_id)
        assert r2.get_json()["status"] == "finished"

        admin_client.post("/admin/api/game/start")

        rate_limiter.clear()
        r3 = scan_tag(client, "player-restart", tag_id)
        assert r3.get_json()["status"] == "ok"
        assert r3.get_json()["delta"] == 10


class TestGameEdgeCases:
    def test_starts_at_null_ends_at_set_means_not_started(self, client, admin_client):
        """If starts_at is null but ends_at is set, game stays 'not_started' forever."""
        admin_client.put(
            "/admin/api/game",
            json={"starts_at": None, "ends_at": "2099-12-31T00:00:00Z"},
        )

        register_player(client, "player-edge1", "EdgePlayer1")
        tags = create_tag(admin_client, "unlimited", {"points": 10})
        tag_id = tags[0]["id"]

        rate_limiter.clear()
        r = scan_tag(client, "player-edge1", tag_id)
        assert r.status_code == 200
        assert r.get_json()["status"] == "not_yet"

        # Scoreboard should also show not_started
        sb = client.get("/api/scoreboard").get_json()
        assert sb["game"]["status"] == "not_started"

    def test_starts_at_null_ends_at_past_means_not_started(self, client, admin_client):
        """Even if ends_at is in the past, null starts_at means not_started (not finished)."""
        admin_client.put(
            "/admin/api/game",
            json={"starts_at": None, "ends_at": "2000-01-01T00:00:00Z"},
        )

        sb = client.get("/api/scoreboard").get_json()
        assert sb["game"]["status"] == "not_started"


class TestGameBoundary:
    def test_scan_just_before_game_ends(self, client, admin_client):
        """Scan during active game (far from end) should succeed."""
        admin_client.put(
            "/admin/api/game",
            json={
                "starts_at": "2000-01-01T00:00:00Z",
                "ends_at": "2099-12-31T23:59:59Z",
            },
        )
        register_player(client, "player-boundary", "BoundaryPlayer")
        tags = create_tag(admin_client, "unlimited", {"points": 20})
        tag_id = tags[0]["id"]

        rate_limiter.clear()
        r = scan_tag(client, "player-boundary", tag_id)
        assert r.status_code == 200
        assert r.get_json()["status"] == "ok"

    def test_scan_just_after_game_ends(self, client, admin_client):
        """Scan after game end should return 'finished'."""
        now = datetime.now(timezone.utc)
        starts_at = (now - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
        ends_at = (now - timedelta(seconds=1)).strftime("%Y-%m-%dT%H:%M:%SZ")

        admin_client.put(
            "/admin/api/game",
            json={"starts_at": starts_at, "ends_at": ends_at},
        )
        register_player(client, "player-boundary2", "BoundaryPlayer2")
        tags = create_tag(admin_client, "unlimited", {"points": 20})
        tag_id = tags[0]["id"]

        rate_limiter.clear()
        r = scan_tag(client, "player-boundary2", tag_id)
        assert r.status_code == 200
        assert r.get_json()["status"] == "finished"
