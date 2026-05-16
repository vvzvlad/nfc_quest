"""
Block B: Scan endpoint — game status gating tests.
"""
import pytest
from helpers import start_game, create_tag, register_player, scan_tag
from blueprints.game_api import rate_limiter


class TestScanGameStatus:
    # B1: Scan while game has not started yet → status "not_yet"
    def test_scan_game_not_started(self, client, admin_client):
        # Set starts_at far in the future so the game hasn't started
        admin_client.put(
            "/admin/api/game",
            json={"starts_at": "2099-01-01T00:00:00Z", "ends_at": "2099-12-31T00:00:00Z"},
        )
        tags = create_tag(admin_client, "unlimited", {"points": 10})
        register_player(client, "player-b1", "PlayerB1")

        r = scan_tag(client, "player-b1", tags[0]["id"])
        assert r.status_code == 200
        body = r.get_json()
        assert body["status"] == "not_yet"
        # starts_at should be an ISO-8601 string
        assert isinstance(body.get("starts_at"), str)
        assert "T" in body["starts_at"]  # basic ISO-8601 sanity check

    # B2: Scan after game has finished → status "finished"
    def test_scan_game_finished(self, client, admin_client):
        # Set ends_at in the distant past so the game is already finished
        admin_client.put(
            "/admin/api/game",
            json={"starts_at": "2000-01-01T00:00:00Z", "ends_at": "2020-01-01T00:00:00Z"},
        )
        tags = create_tag(admin_client, "unlimited", {"points": 10})
        register_player(client, "player-b2", "PlayerB2")

        r = scan_tag(client, "player-b2", tags[0]["id"])
        assert r.status_code == 200
        body = r.get_json()
        assert body["status"] == "finished"
        assert "award_message" in body

    # B3: Scan with unknown player while game is active → 404
    def test_scan_unknown_player(self, client, admin_client):
        start_game(admin_client)
        tags = create_tag(admin_client, "unlimited", {"points": 10})

        r = scan_tag(client, "nonexistent-player", tags[0]["id"])
        assert r.status_code == 404
        body = r.get_json()
        assert "error" in body
        assert body["error"] == "PLAYER_NOT_FOUND"

    # B4: Scan with unknown tag while game is active → status "unknown"
    def test_scan_unknown_tag(self, client, admin_client):
        start_game(admin_client)
        register_player(client, "player-b4", "PlayerB4")

        r = scan_tag(client, "player-b4", "FFFF-FFF")
        assert r.status_code == 200
        body = r.get_json()
        assert body["status"] == "unknown"

    # S-M1: Missing or empty required fields in scan request → 400
    @pytest.mark.parametrize("payload,expected_status", [
        ({}, 400),                                                    # empty body
        ({"player_id": "p1"}, 400),                                   # no tag_id
        ({"tag_id": "AAAA-AAA"}, 400),                                # no player_id
        ({"player_id": "", "tag_id": "AAAA-AAA"}, 400),               # empty player_id
    ])
    def test_scan_missing_fields(self, client, admin_client, payload, expected_status):
        start_game(admin_client)
        r = client.post("/api/scan", json=payload)
        assert r.status_code == expected_status
        assert r.get_json()["error"] == "MISSING_FIELDS"

    # S-M1b: Scan with wrong content-type returns 400
    def test_scan_wrong_content_type(self, client, admin_client):
        start_game(admin_client)
        r = client.post(
            "/api/scan",
            data="tag_id=AAAA-AAA&player_id=someone",
            content_type="text/plain",
        )
        assert r.status_code == 400
        assert r.get_json()["error"] == "MISSING_FIELDS"

    # S-M1c: Scan with no body at all returns 400
    def test_scan_no_body(self, client, admin_client):
        start_game(admin_client)
        r = client.post("/api/scan")
        assert r.status_code == 400
        assert r.get_json()["error"] == "MISSING_FIELDS"

    # B5: Rate limit check happens BEFORE game status check
    # When game is stopped and player scans immediately after first scan (no rate_limiter.clear()),
    # the second scan returns 429, not the game-finished response.
    def test_rate_limit_priority_over_game_status(self, client, admin_client):
        # Start game, register player, create tag
        start_game(admin_client)
        register_player(client, "player-b5", "PlayerB5")
        tags = create_tag(admin_client, "unlimited", {"points": 10})
        tag_id = tags[0]["id"]

        # First scan succeeds while game is active
        rate_limiter.clear()
        r1 = scan_tag(client, "player-b5", tag_id)
        assert r1.status_code == 200
        assert r1.get_json()["status"] == "ok"

        # Stop the game so it's now finished
        admin_client.post("/admin/api/game/stop")

        # Immediately scan again WITHOUT clearing rate_limiter — should get 429, not "finished"
        r2 = scan_tag(client, "player-b5", tag_id)
        assert r2.status_code == 429
        assert r2.get_json()["status"] == "rate_limit"
        assert r2.get_json()["message"] == "RATE_LIMIT_WAIT"
