"""
Scan log tests: locked events recorded, reset tag log entries, batch tag creation.
"""
from helpers import start_game, create_tag, register_player, scan_tag
from blueprints.game_api import rate_limiter


class TestLockedScanLog:
    def test_locked_scan_creates_log_entry(self, client, admin_client):
        """A locked scan DOES create a ScanEvent with result='locked' in the log."""
        start_game(admin_client)
        register_player(client, "player-lock-log", "LockLogPlayer")
        tags = create_tag(admin_client, "one_time_global", {"points": 50})
        tag_id = tags[0]["id"]

        rate_limiter.clear()
        r1 = scan_tag(client, "player-lock-log", tag_id)
        assert r1.get_json()["status"] == "ok"

        rate_limiter.clear()
        r2 = scan_tag(client, "player-lock-log", tag_id)
        assert r2.get_json()["status"] == "locked"

        r_log = admin_client.get("/admin/api/log?player_id=player-lock-log")
        items = r_log.get_json()["items"]
        results = [i["result"] for i in items]
        assert "ok" in results
        assert "locked" in results

    def test_locked_one_time_per_player_logged(self, client, admin_client):
        """A locked one_time_per_player scan is recorded in the log."""
        start_game(admin_client)
        register_player(client, "player-otp-lock", "OTPLockPlayer")
        tags = create_tag(admin_client, "one_time_per_player", {"points": 30})
        tag_id = tags[0]["id"]

        rate_limiter.clear()
        scan_tag(client, "player-otp-lock", tag_id)

        rate_limiter.clear()
        r2 = scan_tag(client, "player-otp-lock", tag_id)
        assert r2.get_json()["status"] == "locked"

        r_log = admin_client.get("/admin/api/log?player_id=player-otp-lock")
        items = r_log.get_json()["items"]
        locked_items = [i for i in items if i["result"] == "locked"]
        assert len(locked_items) >= 1

    def test_locked_scan_logged_with_zero_delta(self, client, admin_client):
        """Locked scan attempt is logged with delta_points=0."""
        start_game(admin_client)
        register_player(client, "player-lock-d", "LockDelta")
        register_player(client, "player-lock-e", "LockDeltaE")
        tags = create_tag(admin_client, "one_time_global", {"points": 100})
        tag_id = tags[0]["id"]

        rate_limiter.clear()
        scan_tag(client, "player-lock-d", tag_id)

        rate_limiter.clear()
        scan_tag(client, "player-lock-e", tag_id)

        r_log = admin_client.get("/admin/api/log?player_id=player-lock-e")
        items = r_log.get_json()["items"]
        locked_entry = next((i for i in items if i["result"] == "locked"), None)
        assert locked_entry is not None
        assert locked_entry["delta_points"] == 0


class TestResetTagLog:
    def test_reset_tag_doubles_points(self, client, admin_client):
        """After admin resets a one_time_per_player tag, player can earn again."""
        start_game(admin_client)
        register_player(client, "player-path5", "Path5Player")
        tags = create_tag(admin_client, "one_time_per_player", {"points": 30})
        tag_id = tags[0]["id"]

        rate_limiter.clear()
        r1 = scan_tag(client, "player-path5", tag_id)
        assert r1.get_json()["total"] == 30

        rate_limiter.clear()
        r2 = scan_tag(client, "player-path5", tag_id)
        assert r2.get_json()["status"] == "locked"

        admin_client.post(f"/admin/api/tags/{tag_id}/reset")

        rate_limiter.clear()
        r3 = scan_tag(client, "player-path5", tag_id)
        assert r3.get_json()["status"] == "ok"
        assert r3.get_json()["total"] == 60

    def test_reset_tag_creates_two_ok_events_in_log(self, client, admin_client):
        """After reset, log shows two 'ok' events for the same tag."""
        start_game(admin_client)
        register_player(client, "player-path5b", "Path5B")
        tags = create_tag(admin_client, "one_time_per_player", {"points": 20})
        tag_id = tags[0]["id"]

        rate_limiter.clear()
        scan_tag(client, "player-path5b", tag_id)

        admin_client.post(f"/admin/api/tags/{tag_id}/reset")

        rate_limiter.clear()
        scan_tag(client, "player-path5b", tag_id)

        r_log = admin_client.get("/admin/api/log?player_id=player-path5b")
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
