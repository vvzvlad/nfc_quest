"""
Block F: End-to-end integration flow tests.
"""
from helpers import start_game, create_tag, register_player, scan_tag, make_player_id
from blueprints.game_api import rate_limiter


class TestE2EFlows:
    # F1: Full happy-path journey: register → scan → appear on scoreboard
    def test_full_player_journey(self, client, admin_client):
        # 1. Start the game
        start_game(admin_client)

        # 2. Register a player
        r_reg = register_player(client, make_player_id("player-f1"), "HeroPlayer")
        assert r_reg.status_code == 201
        player_id = r_reg.get_json()["player_id"]

        # 3. Create an unlimited tag worth 25 points
        tags = create_tag(admin_client, "random", {"min": 25, "max": 25})
        tag_id = tags[0]["id"]

        # 4. Scan the tag
        r_scan = scan_tag(client, player_id, tag_id)
        assert r_scan.status_code == 200
        scan_body = r_scan.get_json()
        assert scan_body["status"] == "ok"
        assert scan_body["delta"] == 25
        assert scan_body["total"] == 25

        # 5. Check scoreboard — player should be first with 25 points, rank 1
        r_sb = client.get("/api/scoreboard")
        assert r_sb.status_code == 200
        sb_body = r_sb.get_json()
        assert len(sb_body["players"]) == 1
        assert sb_body["players"][0]["points"] == 25
        assert sb_body["players"][0]["rank"] == 1

    # F2: Two players compete for a one_time_global tag
    def test_two_players_compete_one_time_global(self, client, admin_client):
        # 1. Start the game
        start_game(admin_client)

        # 2. Register two players
        register_player(client, make_player_id("player-f2a"), "PlayerA")
        register_player(client, make_player_id("player-f2b"), "PlayerB")

        # 3. Create a one_time_global tag worth 50 points
        tags = create_tag(admin_client, "one_time_global", {"points": 50})
        tag_id = tags[0]["id"]

        # 4. Player A scans first — should succeed
        r_a = scan_tag(client, make_player_id("player-f2a"), tag_id)
        assert r_a.status_code == 200
        assert r_a.get_json()["status"] == "ok"

        # 5. Player B scans same tag — should be locked
        rate_limiter.clear()
        r_b = scan_tag(client, make_player_id("player-f2b"), tag_id)
        assert r_b.status_code == 200
        assert r_b.get_json()["status"] == "locked"

        # 6. Check scoreboard — A leads with 50 pts, B has 0 pts
        r_sb = client.get("/api/scoreboard")
        sb_body = r_sb.get_json()
        players = sb_body["players"]
        assert len(players) == 2
        # First place: Player A
        assert players[0]["nick"] == "PlayerA"
        assert players[0]["points"] == 50
        assert players[0]["rank"] == 1
        # Second place: Player B
        assert players[1]["nick"] == "PlayerB"
        assert players[1]["points"] == 0
        assert players[1]["rank"] == 2

    # F3: Full game lifecycle — not_yet → active → finished
    def test_game_lifecycle(self, client, admin_client):
        # Register a player and create a tag upfront
        register_player(client, make_player_id("player-f3"), "LifecyclePlayer")
        tags = create_tag(admin_client, "random", {"min": 10, "max": 10})
        tag_id = tags[0]["id"]

        # Step 1: Game not started yet — scan returns "not_yet"
        admin_client.put(
            "/admin/api/game",
            json={"starts_at": "2099-01-01T00:00:00Z", "ends_at": "2099-12-31T00:00:00Z"},
        )
        rate_limiter.clear()
        r1 = scan_tag(client, make_player_id("player-f3"), tag_id)
        assert r1.status_code == 200
        assert r1.get_json()["status"] == "not_yet"

        # Step 2: Start the game — scan returns "ok"
        rate_limiter.clear()
        admin_client.post("/admin/api/game/start")
        r2 = scan_tag(client, make_player_id("player-f3"), tag_id)
        assert r2.status_code == 200
        body2 = r2.get_json()
        assert body2["status"] == "ok"
        # F3-fix: verify scan response includes delta and total fields
        assert body2["delta"] == 10
        assert body2["total"] == 10

        # Step 3: Stop the game — scan returns "finished"
        rate_limiter.clear()
        admin_client.post("/admin/api/game/stop")
        r3 = scan_tag(client, make_player_id("player-f3"), tag_id)
        assert r3.status_code == 200
        assert r3.get_json()["status"] == "finished"

        # Step 4: Scoreboard should reflect finished status
        r_sb = client.get("/api/scoreboard")
        sb_body = r_sb.get_json()
        assert sb_body["game"]["status"] == "finished"

    # F4: Register a player and immediately scan (mimics real user flow)
    def test_register_then_immediately_scan(self, client, admin_client):
        start_game(admin_client)
        tags = create_tag(admin_client, "random", {"min": 10, "max": 10})
        tag_id = tags[0]["id"]

        # Register and scan back-to-back
        register_player(client, make_player_id("player-f4"), "PlayerF4")
        r_scan = scan_tag(client, make_player_id("player-f4"), tag_id)
        assert r_scan.status_code == 200
        body = r_scan.get_json()
        assert body["status"] == "ok"
        assert body["delta"] > 0

    # F5: Rate limit is checked even when game has not started yet
    def test_rate_limit_priority_when_game_not_started(self, client, admin_client):
        # Set game to not_started state (future starts_at)
        admin_client.put(
            "/admin/api/game",
            json={"starts_at": "2099-01-01T00:00:00Z", "ends_at": "2099-12-31T00:00:00Z"},
        )
        register_player(client, make_player_id("player-f5"), "PlayerF5")
        tags = create_tag(admin_client, "random", {"min": 10, "max": 10})
        tag_id = tags[0]["id"]

        # First scan returns "not_yet" and updates rate_limiter
        rate_limiter.clear()
        r1 = scan_tag(client, make_player_id("player-f5"), tag_id)
        assert r1.get_json()["status"] == "not_yet"

        # Second immediate scan WITHOUT clearing rate_limiter — must be rate-limited
        r2 = scan_tag(client, make_player_id("player-f5"), tag_id)
        assert r2.status_code == 429
        assert r2.get_json()["status"] == "rate_limit"
        assert r2.get_json()["message"] == "RATE_LIMIT_WAIT"

    # F6: Registration is blocked when game has already finished
    # WILL FAIL — current code returns 201 regardless of game state
    def test_registration_blocked_when_game_finished(self, client, admin_client):
        # Set game to finished state (both dates in the past)
        admin_client.put(
            "/admin/api/game",
            json={
                "starts_at": "2000-01-01T00:00:00Z",
                "ends_at": "2000-06-01T00:00:00Z",
            },
        )

        # Attempt to register a new player
        r = register_player(client, make_player_id("player-f6"), "PlayerF6")
        assert r.status_code == 403
        assert "error" in r.get_json()
        assert r.get_json()["error"] == "REGISTRATION_CLOSED"

    # F7: award_message from game settings is returned in scan response when game is finished
    def test_award_message_in_scan_response_matches_admin_setting(self, client, admin_client):
        # Configure game with a custom award_message and set it as finished
        admin_client.put(
            "/admin/api/game",
            json={
                "starts_at": "2000-01-01T00:00:00Z",
                "ends_at": "2000-06-01T00:00:00Z",
                "award_message": "Prize ceremony at 6pm",
            },
        )

        register_player(client, make_player_id("player-f7"), "PlayerF7")
        tags = create_tag(admin_client, "random", {"min": 10, "max": 10})
        tag_id = tags[0]["id"]

        # Scan in finished game state
        rate_limiter.clear()
        r = scan_tag(client, make_player_id("player-f7"), tag_id)
        assert r.status_code == 200
        body = r.get_json()
        assert body["status"] == "finished"
        assert body["award_message"] == "Prize ceremony at 6pm"
