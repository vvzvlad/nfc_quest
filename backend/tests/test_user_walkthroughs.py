"""
User walkthrough tests: complete user paths from test-gap-analysis.md.
Register→scan, two accounts, scan response fields, random negative display.
"""
from helpers import start_game, create_tag, register_player, scan_tag, make_player_id
from blueprints.game_api import rate_limiter


class TestRegisterThenScan:
    def test_register_does_not_set_rate_limiter(self, client, admin_client):
        """Registration must NOT populate rate_limiter — first scan passes immediately."""
        start_game(admin_client)
        tags = create_tag(admin_client, "unlimited", {"points": 25})
        tag_id = tags[0]["id"]

        rate_limiter.clear()
        register_player(client, make_player_id("player-path1"), "Path1Player")

        r = scan_tag(client, make_player_id("player-path1"), tag_id)
        assert r.status_code == 200
        assert r.get_json()["status"] == "ok"
        assert r.get_json()["total"] == 25


class TestTwoAccounts:
    def test_one_time_global_blocked_for_second_account(self, client, admin_client):
        """one_time_global tag blocked by account1 is also blocked for account2."""
        start_game(admin_client)
        register_player(client, make_player_id("player-2acc-1"), "TwoAcc1")
        register_player(client, make_player_id("player-2acc-2"), "TwoAcc2")
        tags = create_tag(admin_client, "one_time_global", {"points": 75})
        tag_id = tags[0]["id"]

        rate_limiter.clear()
        r1 = scan_tag(client, make_player_id("player-2acc-1"), tag_id)
        assert r1.get_json()["status"] == "ok"

        rate_limiter.clear()
        r2 = scan_tag(client, make_player_id("player-2acc-2"), tag_id)
        assert r2.get_json()["status"] == "locked"

    def test_one_time_per_player_allows_second_account(self, client, admin_client):
        """one_time_per_player: second account CAN scan even after first did."""
        start_game(admin_client)
        register_player(client, make_player_id("player-2acc-a"), "TwoAccA")
        register_player(client, make_player_id("player-2acc-b"), "TwoAccB")
        tags = create_tag(admin_client, "one_time_per_player", {"points": 40})
        tag_id = tags[0]["id"]

        rate_limiter.clear()
        r1 = scan_tag(client, make_player_id("player-2acc-a"), tag_id)
        assert r1.get_json()["status"] == "ok"

        rate_limiter.clear()
        r2 = scan_tag(client, make_player_id("player-2acc-b"), tag_id)
        assert r2.get_json()["status"] == "ok"

        sb = client.get("/api/scoreboard").get_json()
        a_data = next(p for p in sb["players"] if p["nick"] == "TwoAccA")
        b_data = next(p for p in sb["players"] if p["nick"] == "TwoAccB")
        assert a_data["points"] == 40
        assert b_data["points"] == 40


class TestScanResponseFields:
    def test_ok_scan_includes_strategy_fields(self, client, admin_client):
        """Successful scan response includes strategy and strategy_display."""
        start_game(admin_client)
        tags = create_tag(admin_client, "unlimited", {"points": 10})
        tag_id = tags[0]["id"]
        register_player(client, make_player_id("player-path9"), "Path9Player")

        rate_limiter.clear()
        r = scan_tag(client, make_player_id("player-path9"), tag_id)
        body = r.get_json()
        assert body["status"] == "ok"
        assert "strategy" in body
        assert body["strategy"] == "unlimited"
        assert "strategy_display" in body
        assert isinstance(body["strategy_display"], str)

    def test_ok_scan_includes_meta_field(self, client, admin_client):
        """Successful scan response includes meta with rank info."""
        start_game(admin_client)
        tags = create_tag(admin_client, "unlimited", {"points": 10})
        tag_id = tags[0]["id"]
        register_player(client, make_player_id("player-path9b"), "Path9B")

        rate_limiter.clear()
        r = scan_tag(client, make_player_id("player-path9b"), tag_id)
        body = r.get_json()
        assert "meta" in body
        assert "→" in body["meta"]


class TestRandomNegativeDisplay:
    def test_random_negative_delta_strategy_display(self, client, admin_client):
        """Random tag with negative range: documents strategy_display format."""
        start_game(admin_client)
        tags = create_tag(admin_client, "random", {"min": -50, "max": -10})
        tag_id = tags[0]["id"]
        register_player(client, make_player_id("player-path8"), "Path8Player")

        rate_limiter.clear()
        r = scan_tag(client, make_player_id("player-path8"), tag_id)
        body = r.get_json()
        assert body["status"] == "ok"
        assert body["delta"] < 0
        assert "strategy_display" in body
        display = body["strategy_display"]
        assert "+-" not in display, f"Double-sign bug: {display}"
        assert f"random {body['delta']}" in display
