"""
Block G: Admin API tests.
"""
import re
import pytest
from helpers import start_game, create_tag, register_player, scan_tag
from blueprints.game_api import rate_limiter

TAG_ID_PATTERN = re.compile(r'^[0-9A-F]{4}-[0-9A-F]{3}$')


class TestAdminAuth:
    # G1: All protected routes return 401 when not authenticated
    @pytest.mark.parametrize("method,path", [
        ("GET",    "/admin/api/game"),
        ("GET",    "/admin/api/players"),
        ("GET",    "/admin/api/tags"),
        ("GET",    "/admin/api/log"),
        ("GET",    "/admin/api/stats"),
        ("POST",   "/admin/api/game/start"),
        ("POST",   "/admin/api/game/stop"),
        ("DELETE", "/admin/api/players"),
        ("DELETE", "/admin/api/tags"),
        ("PUT",    "/admin/api/game"),
        ("POST",   "/admin/api/tags/batch"),
        ("DELETE", "/admin/api/players/nonexistent"),
        ("DELETE", "/admin/api/tags/nonexistent"),
        ("POST",   "/admin/api/tags/nonexistent/reset"),
        ("POST",   "/admin/api/players/nonexistent/adjust"),
    ])
    def test_all_admin_routes_require_auth(self, client, method, path):
        method_fn = getattr(client, method.lower())
        r = method_fn(path)
        assert r.status_code == 401, f"{method} {path} should return 401 without auth"

    # G2: Login success/failure and /me endpoint
    def test_admin_login_success_and_failure(self, client):
        # Correct password → 200 with ok: true
        r_ok = client.post("/admin/api/login", json={"password": "testpass"})
        assert r_ok.status_code == 200
        assert r_ok.get_json()["ok"] is True

        # /me should now show authenticated: true
        r_me = client.get("/admin/api/me")
        assert r_me.status_code == 200
        assert r_me.get_json()["authenticated"] is True

        # Logout
        r_logout = client.post("/admin/api/logout")
        assert r_logout.status_code == 200

        # /me should now show authenticated: false
        r_me2 = client.get("/admin/api/me")
        assert r_me2.get_json()["authenticated"] is False

        # Wrong password → 401
        r_fail = client.post("/admin/api/login", json={"password": "wrongpass"})
        assert r_fail.status_code == 401


class TestAdminGameControl:
    # G3: PUT game settings, start, stop, verify statuses
    def test_admin_game_control(self, admin_client, client):
        # PUT game settings
        r_put = admin_client.put(
            "/admin/api/game",
            json={
                "starts_at": "2099-01-01T00:00:00Z",
                "ends_at": "2099-06-01T00:00:00Z",
                "award_message": "test award",
            },
        )
        assert r_put.status_code == 200
        put_body = r_put.get_json()
        assert put_body["award_message"] == "test award"
        assert put_body["starts_at"] is not None
        assert put_body["ends_at"] is not None

        # Start the game — starts_at becomes approximately now
        r_start = admin_client.post("/admin/api/game/start")
        assert r_start.status_code == 200
        start_body = r_start.get_json()
        assert start_body["starts_at"] is not None
        assert start_body["ends_at"] is not None
        # Verify ends_at is at least 2 hours after starts_at (auto-set logic)
        from datetime import datetime, timedelta, timezone
        ends_at_dt = datetime.fromisoformat(start_body["ends_at"].replace("Z", "+00:00"))
        starts_at_dt = datetime.fromisoformat(start_body["starts_at"].replace("Z", "+00:00"))
        assert ends_at_dt >= starts_at_dt + timedelta(hours=2)

        # Stop the game — ends_at becomes now (game finished)
        r_stop = admin_client.post("/admin/api/game/stop")
        assert r_stop.status_code == 200

        # GET game should now have ends_at in the past → status is "finished"
        r_get = admin_client.get("/admin/api/game")
        assert r_get.status_code == 200
        game_body = r_get.get_json()
        assert game_body["ends_at"] is not None

        # Verify scoreboard reflects finished status
        r_sb = client.get("/api/scoreboard")
        assert r_sb.get_json()["game"]["status"] == "finished"


class TestAdminTags:
    # G4: Batch tag creation creates the correct number of tags with valid URLs
    def test_admin_batch_create_tags(self, admin_client):
        r = admin_client.post(
            "/admin/api/tags/batch",
            json={"strategy": "one_time_global", "count": 5, "strategy_params": {"points": 10}},
        )
        assert r.status_code == 201
        body = r.get_json()
        items = body["items"]
        assert len(items) == 5

        # Each item must have an id and a URL containing the expected base
        for item in items:
            assert "id" in item
            assert "url" in item
            assert "http://localhost:5000/tag/" in item["url"]
            # Verify TAG ID format is XXXX-XXX using uppercase hex characters
            assert TAG_ID_PATTERN.match(item["id"]), f"TAG ID '{item['id']}' does not match XXXX-XXX format"

        # GET /admin/api/tags should list 5 tags
        r_list = admin_client.get("/admin/api/tags")
        assert r_list.status_code == 200
        list_body = r_list.get_json()
        assert list_body["total"] == 5


class TestAdminPlayers:
    # G5: Deleting all players resets blocked tags so they can be scanned again
    def test_delete_all_players_resets_blocked_tags(self, client, admin_client):
        # Start the game, register a player, create a one_time_global tag
        start_game(admin_client)
        register_player(client, "player-g5", "PlayerG5")
        tags = create_tag(admin_client, "one_time_global", {"points": 50})
        tag_id = tags[0]["id"]

        # Player scans the tag — tag becomes blocked
        r_scan = scan_tag(client, "player-g5", tag_id)
        assert r_scan.get_json()["status"] == "ok"

        # Delete all players — should also reset tag blocked state
        r_del = admin_client.delete("/admin/api/players")
        assert r_del.status_code == 200
        del_body = r_del.get_json()
        assert del_body["ok"] is True
        assert del_body["deleted"] == 1

        # The tag should now show is_blocked: false
        r_tags = admin_client.get("/admin/api/tags")
        tags_list = r_tags.get_json()["items"]
        the_tag = next(t for t in tags_list if t["id"] == tag_id)
        assert the_tag["is_blocked"] is False

        # Register a new player and scan the tag — should succeed
        rate_limiter.clear()
        register_player(client, "player-g5-new", "PlayerG5New")
        r_scan2 = scan_tag(client, "player-g5-new", tag_id)
        assert r_scan2.status_code == 200
        assert r_scan2.get_json()["status"] == "ok"

    # G6: Adjust player points including negative and invalid delta
    def test_admin_adjust_player_points(self, client, admin_client):
        # Register a player (starts at 0 points)
        register_player(client, "player-g6", "PlayerG6")

        # Adjust +50
        r1 = admin_client.post(
            "/admin/api/players/player-g6/adjust", json={"delta": 50}
        )
        assert r1.status_code == 200
        assert r1.get_json()["points"] == 50

        # Adjust -30 → should be 20
        r2 = admin_client.post(
            "/admin/api/players/player-g6/adjust", json={"delta": -30}
        )
        assert r2.status_code == 200
        assert r2.get_json()["points"] == 20

        # Adjust -30 again → should be -10 (negatives are allowed)
        r3 = admin_client.post(
            "/admin/api/players/player-g6/adjust", json={"delta": -30}
        )
        assert r3.status_code == 200
        assert r3.get_json()["points"] == -10

        # Non-numeric delta → 400
        r4 = admin_client.post(
            "/admin/api/players/player-g6/adjust", json={"delta": "abc"}
        )
        assert r4.status_code == 400
        assert "error" in r4.get_json()


class TestAdminScanLog:
    # G7: Scan log records scans in descending order with correct fields and filters
    def test_admin_scan_log(self, client, admin_client):
        start_game(admin_client)
        register_player(client, "player-g7", "PlayerG7")
        tags = create_tag(admin_client, "unlimited", {"points": 10})
        tag_id = tags[0]["id"]

        # Perform 3 scans
        for _ in range(3):
            rate_limiter.clear()
            scan_tag(client, "player-g7", tag_id)

        # GET log — should contain 3 records
        r_log = admin_client.get("/admin/api/log")
        assert r_log.status_code == 200
        log_body = r_log.get_json()
        items = log_body["items"]
        assert len(items) >= 3

        # Only the ok events (3 of them)
        ok_items = [i for i in items if i["result"] == "ok"]
        assert len(ok_items) == 3

        # Records are in descending chronological order
        timestamps = [i["scanned_at"] for i in ok_items]
        assert timestamps == sorted(timestamps, reverse=True)

        # Required fields are present
        for item in ok_items:
            assert "player_nick" in item
            assert item["delta_points"] == 10
            assert item["result"] == "ok"
            assert "player_total_after" in item

        # player_total_after should grow: 10, 20, 30 (log is newest-first, so reversed)
        totals = [i["player_total_after"] for i in ok_items]
        assert sorted(totals) == [10, 20, 30]

        # Filter by player_id — should only return this player's events
        r_filtered = admin_client.get(f"/admin/api/log?player_id=player-g7")
        filtered_body = r_filtered.get_json()
        for item in filtered_body["items"]:
            assert item["player_nick"] == "PlayerG7"

        # Filter by result=ok — should only return ok events
        r_ok_filter = admin_client.get("/admin/api/log?result=ok")
        ok_filter_body = r_ok_filter.get_json()
        for item in ok_filter_body["items"]:
            assert item["result"] == "ok"

    def test_admin_scan_log_mixed_deltas(self, client, admin_client):
        """Verify player_total_after is a running cumulative sum even with mixed-sign deltas."""
        start_game(admin_client)
        register_player(client, "player-g7b", "PlayerG7B")

        # Create two tags: one positive, one negative
        tags_pos = create_tag(admin_client, "unlimited", {"points": 20})
        tags_neg = create_tag(admin_client, "unlimited", {"points": -5})
        tag_pos_id = tags_pos[0]["id"]
        tag_neg_id = tags_neg[0]["id"]

        # Scan positive tag: total should be 20
        rate_limiter.clear()
        scan_tag(client, "player-g7b", tag_pos_id)

        # Scan negative tag: total should be 15
        rate_limiter.clear()
        scan_tag(client, "player-g7b", tag_neg_id)

        # Get log filtered to this player
        r_log = admin_client.get("/admin/api/log?player_id=player-g7b")
        items = r_log.get_json()["items"]
        ok_items = [i for i in items if i["result"] == "ok"]
        assert len(ok_items) == 2

        # Log is newest-first: [neg scan (total=15), pos scan (total=20)]
        assert ok_items[0]["player_total_after"] == 15
        assert ok_items[1]["player_total_after"] == 20

    def test_admin_scan_log_player_nick_present(self, client, admin_client):
        """Log entries carry the correct player_nick while the player exists;
        deleting a player also removes their scan events from the log."""
        start_game(admin_client)
        register_player(client, "player-g7c", "PlayerG7C")
        tags = create_tag(admin_client, "unlimited", {"points": 5})
        tag_id = tags[0]["id"]

        # Player scans the tag
        rate_limiter.clear()
        scan_tag(client, "player-g7c", tag_id)

        # While the player exists, player_nick should equal the registered nick
        r_log = admin_client.get("/admin/api/log?player_id=player-g7c")
        items = r_log.get_json()["items"]
        ok_items = [i for i in items if i["result"] == "ok"]
        assert len(ok_items) >= 1
        assert ok_items[0]["player_nick"] == "PlayerG7C"

        # Delete the player — backend also removes their scan events
        r_del = admin_client.delete("/admin/api/players/player-g7c")
        assert r_del.status_code == 200

        # After deletion the scan events are gone; log returns empty for this player_id
        r_log_after = admin_client.get("/admin/api/log?player_id=player-g7c")
        assert r_log_after.get_json()["items"] == []
