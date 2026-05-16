"""
Block G: Admin API tests.
"""
import re
import pytest
from datetime import datetime, timezone, timedelta
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

    # G-M3a: Starting game with null ends_at sets it to approximately now + 2 hours
    def test_game_start_sets_ends_at_when_null(self, admin_client):
        # PUT only award_message so starts_at/ends_at remain null
        admin_client.put("/admin/api/game", json={"award_message": "test"})

        r_start = admin_client.post("/admin/api/game/start")
        assert r_start.status_code == 200
        body = r_start.get_json()

        assert body["ends_at"] is not None
        ends_at_dt = datetime.fromisoformat(body["ends_at"].replace("Z", "+00:00"))
        starts_at_dt = datetime.fromisoformat(body["starts_at"].replace("Z", "+00:00"))
        # ends_at should be approximately starts_at + 2h (within 1 minute tolerance)
        expected_ends = starts_at_dt + timedelta(hours=2)
        assert abs((ends_at_dt - expected_ends).total_seconds()) < 60

    # G-M3b: Starting game with a far-future ends_at does not overwrite it
    def test_game_start_preserves_future_ends_at(self, admin_client):
        future_ends = "2099-01-01T12:00:00Z"
        admin_client.put("/admin/api/game", json={"ends_at": future_ends})

        r_start = admin_client.post("/admin/api/game/start")
        assert r_start.status_code == 200

        r_get = admin_client.get("/admin/api/game")
        game_body = r_get.get_json()
        # ends_at must be preserved (not overwritten by start logic)
        assert game_body["ends_at"] is not None
        # Check date portion matches the future date we set
        assert game_body["ends_at"].startswith("2099-01-01")


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

    # G-M4: Deleting all tags does NOT erase players' accumulated points
    def test_delete_all_tags_preserves_player_points(self, client, admin_client):
        start_game(admin_client)
        register_player(client, "player-gm4", "PlayerGM4")
        tags = create_tag(admin_client, "unlimited", {"points": 25})
        tag_id = tags[0]["id"]

        # Player scans and earns 25 points
        r_scan = scan_tag(client, "player-gm4", tag_id)
        assert r_scan.get_json()["status"] == "ok"

        # Delete all tags
        r_del = admin_client.delete("/admin/api/tags")
        assert r_del.status_code == 200

        # Player's points must still be 25 on the scoreboard
        sb = client.get("/api/scoreboard").get_json()
        player_data = next(p for p in sb["players"] if p["nick"] == "PlayerGM4")
        assert player_data["points"] == 25

    # G-M6: Deleting a nonexistent tag returns 404 with error key
    def test_delete_nonexistent_tag_returns_404(self, admin_client):
        r = admin_client.delete("/admin/api/tags/ZZZZ-ZZZ")
        assert r.status_code == 404
        assert "error" in r.get_json()

    # G-M7: Resetting a tag allows a player to scan it again after being locked
    def test_reset_tag_allows_rescan(self, client, admin_client):
        start_game(admin_client)
        register_player(client, "player-gm7", "PlayerGM7")
        tags = create_tag(admin_client, "one_time_per_player", {"points": 20})
        tag_id = tags[0]["id"]

        # First scan succeeds
        rate_limiter.clear()
        r1 = scan_tag(client, "player-gm7", tag_id)
        assert r1.get_json()["status"] == "ok"

        # Second scan is locked
        rate_limiter.clear()
        r2 = scan_tag(client, "player-gm7", tag_id)
        assert r2.get_json()["status"] == "locked"

        # Reset the tag via admin API
        r_reset = admin_client.post(f"/admin/api/tags/{tag_id}/reset")
        assert r_reset.status_code == 200
        assert r_reset.get_json()["ok"] is True

        # After reset, the player can scan again
        rate_limiter.clear()
        r3 = scan_tag(client, "player-gm7", tag_id)
        assert r3.get_json()["status"] == "ok"

    # G-M8: Batch creating 0 tags returns 201 with empty items list
    def test_batch_create_tags_count_zero(self, admin_client):
        r = admin_client.post(
            "/admin/api/tags/batch",
            json={"strategy": "unlimited", "strategy_params": {"points": 10}, "count": 0},
        )
        assert r.status_code == 201
        body = r.get_json()
        assert body["items"] == []

    # G-M9: Tag with unknown strategy — scanning returns status "unknown"
    def test_batch_create_unknown_strategy_scan_returns_unknown(self, client, admin_client):
        r_batch = admin_client.post(
            "/admin/api/tags/batch",
            json={"strategy": "unknown_xyz", "strategy_params": {}, "count": 1},
        )
        assert r_batch.status_code == 201
        tag_id = r_batch.get_json()["items"][0]["id"]

        start_game(admin_client)
        register_player(client, "player-gm9", "PlayerGM9")

        r = scan_tag(client, "player-gm9", tag_id)
        assert r.status_code == 200
        assert r.get_json()["status"] == "unknown"


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

    # G-M5: Deleting a nonexistent player returns 404 with error key
    def test_delete_nonexistent_player_returns_404(self, admin_client):
        r = admin_client.delete("/admin/api/players/nonexistent-id")
        assert r.status_code == 404
        assert "error" in r.get_json()


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


class TestAdminGameValidation:
    # G-M1: PUT game with ends_at before starts_at should return 400 (WILL FAIL — returns 200)
    def test_put_game_ends_at_before_starts_at(self, admin_client):
        r = admin_client.put(
            "/admin/api/game",
            json={
                "starts_at": "2099-06-01T00:00:00Z",
                "ends_at": "2099-01-01T00:00:00Z",  # ends_at is BEFORE starts_at
            },
        )
        assert r.status_code == 400
        assert "error" in r.get_json()

    # G-M1 sub-case 2: ends_at - starts_at < 10 minutes → 400 (WILL FAIL)
    def test_put_game_duration_too_short(self, admin_client):
        r = admin_client.put(
            "/admin/api/game",
            json={
                "starts_at": "2099-01-01T00:00:00Z",
                "ends_at": "2099-01-01T00:05:00Z",  # only 5 minutes apart
            },
        )
        assert r.status_code == 400
        assert "error" in r.get_json()

    # G-M1 sub-case 3: ends_at - starts_at == 10 minutes exactly → 200
    # NOTE: currently passes because no validation exists yet.
    # Will continue to pass once validation is added — 10 min is the minimum allowed boundary.
    def test_put_game_duration_exactly_10_minutes(self, admin_client):
        r = admin_client.put(
            "/admin/api/game",
            json={
                "starts_at": "2099-01-01T00:00:00Z",
                "ends_at": "2099-01-01T00:10:00Z",  # exactly 10 minutes
            },
        )
        assert r.status_code == 200

    # G-M1 sub-case 4: ends_at - starts_at > 10 minutes → 200 (should PASS with current code)
    def test_put_game_duration_valid(self, admin_client):
        r = admin_client.put(
            "/admin/api/game",
            json={
                "starts_at": "2099-01-01T00:00:00Z",
                "ends_at": "2099-01-01T01:00:00Z",  # 1 hour apart — valid
            },
        )
        assert r.status_code == 200

    # G-M2: PUT with invalid datetime string — server silently ignores it, sets field to None
    def test_put_game_invalid_datetime(self, admin_client):
        r = admin_client.put(
            "/admin/api/game",
            json={"starts_at": "not-a-date"},
        )
        # Current code returns 200 and sets the field to None silently
        assert r.status_code == 200
        body = r.get_json()
        assert body["starts_at"] is None


class TestAdminScanLogExtra:
    # L-M1: Non-ok scan results (not_yet, finished, rate_limit) are NOT recorded in the log
    def test_log_not_recorded_for_non_ok_results(self, client, admin_client):
        # --- Sub-case: scan when game has not started yet ---
        admin_client.put(
            "/admin/api/game",
            json={"starts_at": "2099-01-01T00:00:00Z", "ends_at": "2099-12-31T00:00:00Z"},
        )
        register_player(client, "player-lm1", "PlayerLM1")
        tags = create_tag(admin_client, "unlimited", {"points": 10})
        tag_id = tags[0]["id"]

        rate_limiter.clear()
        r_not_yet = scan_tag(client, "player-lm1", tag_id)
        assert r_not_yet.get_json()["status"] == "not_yet"

        # Log should have 0 entries (not_yet never records an event)
        r_log_ny = admin_client.get(f"/admin/api/log?player_id=player-lm1")
        assert r_log_ny.get_json()["items"] == []

        # --- Sub-case: scan when game has already finished ---
        admin_client.put(
            "/admin/api/game",
            json={"starts_at": "2000-01-01T00:00:00Z", "ends_at": "2000-06-01T00:00:00Z"},
        )
        rate_limiter.clear()
        r_finished = scan_tag(client, "player-lm1", tag_id)
        assert r_finished.get_json()["status"] == "finished"

        # Log should still have 0 entries
        r_log_fin = admin_client.get(f"/admin/api/log?player_id=player-lm1")
        assert r_log_fin.get_json()["items"] == []

        # --- Sub-case: rate-limited second scan (only first ok scan should be logged) ---
        # Start game and do two rapid scans; only the first should appear in log
        admin_client.post("/admin/api/game/start")
        rate_limiter.clear()
        r1 = scan_tag(client, "player-lm1", tag_id)
        assert r1.get_json()["status"] == "ok"

        # Second scan — rate limited, must NOT create a log entry
        r2 = scan_tag(client, "player-lm1", tag_id)
        assert r2.status_code == 429

        r_log_rl = admin_client.get(f"/admin/api/log?player_id=player-lm1")
        ok_items = [i for i in r_log_rl.get_json()["items"] if i["result"] == "ok"]
        # Only the first scan should be in the log
        assert len(ok_items) == 1

    # L-M2: Log can be filtered by tag_id
    def test_log_filter_by_tag_id(self, client, admin_client):
        start_game(admin_client)
        register_player(client, "player-lm2a", "PlayerLM2A")
        register_player(client, "player-lm2b", "PlayerLM2B")

        tags1 = create_tag(admin_client, "unlimited", {"points": 10})
        tags2 = create_tag(admin_client, "unlimited", {"points": 20})
        tag1_id = tags1[0]["id"]
        tag2_id = tags2[0]["id"]

        # Player A scans tag1
        rate_limiter.clear()
        scan_tag(client, "player-lm2a", tag1_id)

        # Player B scans tag2
        rate_limiter.clear()
        scan_tag(client, "player-lm2b", tag2_id)

        # Filter log by tag1 — only player A's scan should appear
        r_log = admin_client.get(f"/admin/api/log?tag_id={tag1_id}")
        items = r_log.get_json()["items"]
        assert len(items) >= 1
        for item in items:
            assert item["tag_id"] == tag1_id

    # L-M3: Log supports pagination
    def test_log_pagination(self, client, admin_client):
        start_game(admin_client)
        register_player(client, "player-lm3", "PlayerLM3")
        tags = create_tag(admin_client, "unlimited", {"points": 5})
        tag_id = tags[0]["id"]

        # Perform 5 scans
        for _ in range(5):
            rate_limiter.clear()
            scan_tag(client, "player-lm3", tag_id)

        # Page 1 with per_page=2 → 2 items
        r_p1 = admin_client.get(f"/admin/api/log?player_id=player-lm3&page=1&per_page=2")
        assert r_p1.status_code == 200
        body_p1 = r_p1.get_json()
        assert len(body_p1["items"]) == 2

        # Page 2 → 2 items
        r_p2 = admin_client.get(f"/admin/api/log?player_id=player-lm3&page=2&per_page=2")
        assert r_p2.status_code == 200
        body_p2 = r_p2.get_json()
        assert len(body_p2["items"]) == 2

        # Page 3 → 1 item (the last one)
        r_p3 = admin_client.get(f"/admin/api/log?player_id=player-lm3&page=3&per_page=2")
        assert r_p3.status_code == 200
        body_p3 = r_p3.get_json()
        assert len(body_p3["items"]) == 1
