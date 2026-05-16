"""
Block B: Scan endpoint — game status gating tests.
"""
from helpers import start_game, create_tag, register_player, scan_tag


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
        assert "Player not found" in body["error"]

    # B4: Scan with unknown tag while game is active → status "unknown"
    def test_scan_unknown_tag(self, client, admin_client):
        start_game(admin_client)
        register_player(client, "player-b4", "PlayerB4")

        r = scan_tag(client, "player-b4", "FFFF-FFF")
        assert r.status_code == 200
        body = r.get_json()
        assert body["status"] == "unknown"
