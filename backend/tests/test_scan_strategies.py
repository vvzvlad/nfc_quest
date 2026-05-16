"""
Block C: Strategy tests.
Block D: Rate limiting tests.
"""
from datetime import datetime, timezone, timedelta

from helpers import start_game, create_tag, register_player, scan_tag
from blueprints.game_api import rate_limiter


class TestStrategies:
    # C1: unlimited strategy — player can scan same tag many times, points accumulate
    def test_scan_unlimited_multiple_times(self, client, admin_client):
        start_game(admin_client)
        tags = create_tag(admin_client, "unlimited", {"points": 10})
        tag_id = tags[0]["id"]
        register_player(client, "player-c1", "PlayerC1")

        for expected_total in [10, 20, 30]:
            # Clear rate limiter between each scan so we don't hit the 1-second limit
            rate_limiter.clear()
            r = scan_tag(client, "player-c1", tag_id)
            assert r.status_code == 200
            body = r.get_json()
            assert body["status"] == "ok"
            assert body["delta"] == 10
            assert body["total"] == expected_total

    # C2: one_time_global — first player gets points, second player gets "locked"
    def test_scan_one_time_global_blocks_second_player(self, client, admin_client):
        start_game(admin_client)
        tags = create_tag(admin_client, "one_time_global", {"points": 50})
        tag_id = tags[0]["id"]

        register_player(client, "player-c2a", "PlayerC2A")
        r_a = scan_tag(client, "player-c2a", tag_id)
        assert r_a.status_code == 200
        assert r_a.get_json()["status"] == "ok"

        # Different player; clear rate limiter so it is not blocked by rate limit
        rate_limiter.clear()
        register_player(client, "player-c2b", "PlayerC2B")
        r_b = scan_tag(client, "player-c2b", tag_id)
        assert r_b.status_code == 200
        assert r_b.get_json()["status"] == "locked"

    # C3: one_time_per_player — each player can scan once; second scan by same player → "locked"
    def test_scan_one_time_per_player_isolation(self, client, admin_client):
        start_game(admin_client)
        tags = create_tag(admin_client, "one_time_per_player", {"points": 20})
        tag_id = tags[0]["id"]

        register_player(client, "player-c3a", "PlayerC3A")
        register_player(client, "player-c3b", "PlayerC3B")

        # Player A scans — should succeed
        r_a = scan_tag(client, "player-c3a", tag_id)
        assert r_a.get_json()["status"] == "ok"

        # Player B scans same tag — should also succeed (independent per-player)
        rate_limiter.clear()
        r_b = scan_tag(client, "player-c3b", tag_id)
        assert r_b.get_json()["status"] == "ok"

        # Player A tries again — should be locked
        rate_limiter.clear()
        r_a2 = scan_tag(client, "player-c3a", tag_id)
        assert r_a2.get_json()["status"] == "locked"

    # C4: random strategy — delta falls within [min, max] across multiple players
    def test_scan_random_in_range(self, client, admin_client):
        start_game(admin_client)
        # Use unlimited strategy so the same tag can be scanned many times
        tags = create_tag(admin_client, "random", {"min": 5, "max": 10})
        tag_id = tags[0]["id"]

        deltas = []
        for i in range(20):
            pid = f"player-c4-{i}"
            nick = f"PlayerC4_{i}"
            register_player(client, pid, nick)
            rate_limiter.clear()
            r = scan_tag(client, pid, tag_id)
            body = r.get_json()
            assert body["status"] == "ok", f"Expected ok but got: {body}"
            deltas.append(body["delta"])

        # All deltas must be within the [min, max] range (inclusive)
        for d in deltas:
            assert 5 <= d <= 10, f"Delta {d} out of range [5, 10]"

    # C5: Negative points — player total can go below zero
    def test_scan_negative_points(self, client, admin_client):
        start_game(admin_client)
        tags = create_tag(admin_client, "unlimited", {"points": -15})
        tag_id = tags[0]["id"]
        register_player(client, "player-c5", "PlayerC5")

        r1 = scan_tag(client, "player-c5", tag_id)
        assert r1.status_code == 200
        body1 = r1.get_json()
        assert body1["status"] == "ok"
        assert body1["total"] == -15

        rate_limiter.clear()
        r2 = scan_tag(client, "player-c5", tag_id)
        body2 = r2.get_json()
        assert body2["total"] == -30


class TestRateLimit:
    # D1: Two immediate scans by the same player → second returns 429
    def test_rate_limit_blocks_fast_rescan(self, client, admin_client):
        start_game(admin_client)
        tags = create_tag(admin_client, "unlimited", {"points": 10})
        tag_id = tags[0]["id"]
        register_player(client, "player-d1", "PlayerD1")

        # First scan should succeed
        r1 = scan_tag(client, "player-d1", tag_id)
        assert r1.status_code == 200

        # Second immediate scan should be rate-limited
        r2 = scan_tag(client, "player-d1", tag_id)
        assert r2.status_code == 429

    # D2: After manually backdating the rate limiter entry, next scan succeeds
    def test_rate_limit_allows_after_cooldown(self, client, admin_client):
        start_game(admin_client)
        tags = create_tag(admin_client, "unlimited", {"points": 10})
        tag_id = tags[0]["id"]
        register_player(client, "player-d2", "PlayerD2")

        # First scan goes through
        r1 = scan_tag(client, "player-d2", tag_id)
        assert r1.status_code == 200

        # Simulate time passing by backdating the rate limiter entry
        rate_limiter["player-d2"] = datetime.now(timezone.utc) - timedelta(seconds=2)

        # Second scan should succeed now that the cooldown has "expired"
        r2 = scan_tag(client, "player-d2", tag_id)
        assert r2.status_code == 200
        assert r2.get_json()["status"] == "ok"
