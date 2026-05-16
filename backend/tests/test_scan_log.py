"""
Scan log tests: locked events recorded, reset tag log entries, batch tag creation.
"""
from helpers import start_game, create_tag, register_player, scan_tag, make_player_id
from blueprints.game_api import rate_limiter


class TestLockedScanLog:
    def test_locked_scan_creates_log_entry(self, client, admin_client):
        """A locked scan DOES create a ScanEvent with result='locked' in the log."""
        start_game(admin_client)
        register_player(client, make_player_id("player-lock-log"), "LockLogPlayer")
        tags = create_tag(admin_client, "one_time_global", {"points": 50})
        tag_id = tags[0]["id"]

        rate_limiter.clear()
        r1 = scan_tag(client, make_player_id("player-lock-log"), tag_id)
        assert r1.get_json()["status"] == "ok"

        rate_limiter.clear()
        r2 = scan_tag(client, make_player_id("player-lock-log"), tag_id)
        assert r2.get_json()["status"] == "locked"

        r_log = admin_client.get(f"/admin/api/log?player_id={make_player_id('player-lock-log')}")
        items = r_log.get_json()["items"]
        results = [i["result"] for i in items]
        assert "ok" in results
        assert "locked" in results

    def test_locked_one_time_per_player_logged(self, client, admin_client):
        """A locked one_time_per_player scan is recorded in the log."""
        start_game(admin_client)
        register_player(client, make_player_id("player-otp-lock"), "OTPLockPlayer")
        tags = create_tag(admin_client, "one_time_per_player", {"points": 30})
        tag_id = tags[0]["id"]

        rate_limiter.clear()
        scan_tag(client, make_player_id("player-otp-lock"), tag_id)

        rate_limiter.clear()
        r2 = scan_tag(client, make_player_id("player-otp-lock"), tag_id)
        assert r2.get_json()["status"] == "locked"

        r_log = admin_client.get(f"/admin/api/log?player_id={make_player_id('player-otp-lock')}")
        items = r_log.get_json()["items"]
        locked_items = [i for i in items if i["result"] == "locked"]
        assert len(locked_items) >= 1

    def test_locked_scan_logged_with_zero_delta(self, client, admin_client):
        """Locked scan attempt is logged with delta_points=0."""
        start_game(admin_client)
        register_player(client, make_player_id("player-lock-d"), "LockDelta")
        register_player(client, make_player_id("player-lock-e"), "LockDeltaE")
        tags = create_tag(admin_client, "one_time_global", {"points": 100})
        tag_id = tags[0]["id"]

        rate_limiter.clear()
        scan_tag(client, make_player_id("player-lock-d"), tag_id)

        rate_limiter.clear()
        scan_tag(client, make_player_id("player-lock-e"), tag_id)

        r_log = admin_client.get(f"/admin/api/log?player_id={make_player_id('player-lock-e')}")
        items = r_log.get_json()["items"]
        locked_entry = next((i for i in items if i["result"] == "locked"), None)
        assert locked_entry is not None
        assert locked_entry["delta_points"] == 0


class TestResetTagLog:
    def test_reset_tag_doubles_points(self, client, admin_client):
        """After admin resets a one_time_per_player tag, player can earn again."""
        start_game(admin_client)
        register_player(client, make_player_id("player-path5"), "Path5Player")
        tags = create_tag(admin_client, "one_time_per_player", {"points": 30})
        tag_id = tags[0]["id"]

        rate_limiter.clear()
        r1 = scan_tag(client, make_player_id("player-path5"), tag_id)
        assert r1.get_json()["total"] == 30

        rate_limiter.clear()
        r2 = scan_tag(client, make_player_id("player-path5"), tag_id)
        assert r2.get_json()["status"] == "locked"

        admin_client.post(f"/admin/api/tags/{tag_id}/reset")

        rate_limiter.clear()
        r3 = scan_tag(client, make_player_id("player-path5"), tag_id)
        assert r3.get_json()["status"] == "ok"
        assert r3.get_json()["total"] == 60

    def test_reset_tag_creates_two_ok_events_in_log(self, client, admin_client):
        """After reset, log shows two 'ok' events for the same tag."""
        start_game(admin_client)
        register_player(client, make_player_id("player-path5b"), "Path5B")
        tags = create_tag(admin_client, "one_time_per_player", {"points": 20})
        tag_id = tags[0]["id"]

        rate_limiter.clear()
        scan_tag(client, make_player_id("player-path5b"), tag_id)

        admin_client.post(f"/admin/api/tags/{tag_id}/reset")

        rate_limiter.clear()
        scan_tag(client, make_player_id("player-path5b"), tag_id)

        r_log = admin_client.get(f"/admin/api/log?player_id={make_player_id('player-path5b')}")
        items = r_log.get_json()["items"]
        ok_items = [i for i in items if i["result"] == "ok"]
        assert len(ok_items) == 2
        for item in ok_items:
            assert item["tag_id"] == tag_id


class TestBatchCreateLarge:
    def test_batch_create_100_tags(self, admin_client):
        """Creating 100 tags should succeed and return 100 unique IDs."""
        r = admin_client.post(
            "/admin/api/tags/batch",
            json={"strategy": "unlimited", "strategy_params": {"points": 5}, "count": 100},
        )
        assert r.status_code == 201
        items = r.get_json()["items"]
        assert len(items) == 100
        ids = [item["id"] for item in items]
        assert len(set(ids)) == 100


class TestLogCombinedFilter:
    def test_log_filter_by_player_and_tag(self, client, admin_client):
        """
        GET /admin/api/log?player_id=X&tag_id=Y applies AND logic:
        only entries where BOTH player_id=X and tag_id=Y match are returned.
        """
        start_game(admin_client)

        # Register two players
        register_player(client, make_player_id("player-cf-1"), "CF1")
        register_player(client, make_player_id("player-cf-2"), "CF2")

        # Create two distinct tags
        shared_tags = create_tag(admin_client, "unlimited", {"points": 10})
        exclusive_tags = create_tag(admin_client, "unlimited", {"points": 20})
        shared_tag_id = shared_tags[0]["id"]
        exclusive_tag_id = exclusive_tags[0]["id"]

        # player1 scans shared_tag
        rate_limiter.clear()
        r1 = scan_tag(client, make_player_id("player-cf-1"), shared_tag_id)
        assert r1.get_json()["status"] == "ok"

        # player2 scans shared_tag — same tag, different player
        rate_limiter.clear()
        r2 = scan_tag(client, make_player_id("player-cf-2"), shared_tag_id)
        assert r2.get_json()["status"] == "ok"

        # player1 scans exclusive_tag — same player, different tag
        rate_limiter.clear()
        r3 = scan_tag(client, make_player_id("player-cf-1"), exclusive_tag_id)
        assert r3.get_json()["status"] == "ok"

        # Query log with BOTH filters: player_id=player-cf-1 AND tag_id=shared_tag_id
        r = admin_client.get(f"/admin/api/log?player_id={make_player_id('player-cf-1')}&tag_id={shared_tag_id}")
        assert r.status_code == 200

        data = r.get_json()
        items = data["items"]

        # Exactly one entry must match: player1 + shared_tag
        assert len(items) == 1
        assert items[0]["result"] == "ok"

        # Log items expose player_nick (not player_id) and tag_id
        # Confirm the combined filter excludes player2+shared and player1+exclusive
        assert items[0]["player_nick"] == "CF1"
        assert items[0]["tag_id"] == shared_tag_id

        # total in response must also reflect the filtered count
        assert data["total"] == 1
