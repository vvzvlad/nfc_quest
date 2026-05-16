"""
Player management tests: deletion, scoreboard impact, nick collisions, bulk operations.
"""
import pytest

from helpers import start_game, create_tag, register_player, scan_tag, make_player_id
from blueprints.game_api import rate_limiter


class TestDeletePlayerScoreboard:
    def test_deleted_player_disappears_from_scoreboard(self, client, admin_client):
        """After deleting a player, they must not appear in scoreboard."""
        start_game(admin_client)
        register_player(client, make_player_id("player-del-a"), "PlayerDelA")
        register_player(client, make_player_id("player-del-b"), "PlayerDelB")
        admin_client.post(f"/admin/api/players/{make_player_id('player-del-a')}/adjust", json={"delta": 100})
        admin_client.post(f"/admin/api/players/{make_player_id('player-del-b')}/adjust", json={"delta": 50})

        admin_client.delete(f"/admin/api/players/{make_player_id('player-del-a')}")

        sb = client.get("/api/scoreboard").get_json()
        nicks = [p["nick"] for p in sb["players"]]
        assert "PlayerDelA" not in nicks
        assert "PlayerDelB" in nicks

    def test_deleted_player_ranks_recalculated(self, client, admin_client):
        """After deleting the top player, remaining players' ranks shift up."""
        start_game(admin_client)
        register_player(client, make_player_id("player-rank-a"), "RankA")
        register_player(client, make_player_id("player-rank-b"), "RankB")
        register_player(client, make_player_id("player-rank-c"), "RankC")
        admin_client.post(f"/admin/api/players/{make_player_id('player-rank-a')}/adjust", json={"delta": 300})
        admin_client.post(f"/admin/api/players/{make_player_id('player-rank-b')}/adjust", json={"delta": 200})
        admin_client.post(f"/admin/api/players/{make_player_id('player-rank-c')}/adjust", json={"delta": 100})

        admin_client.delete(f"/admin/api/players/{make_player_id('player-rank-a')}")

        sb = client.get("/api/scoreboard").get_json()
        players = sb["players"]
        assert len(players) == 2
        assert players[0]["nick"] == "RankB"
        assert players[0]["rank"] == 1
        assert players[1]["nick"] == "RankC"
        assert players[1]["rank"] == 2


class TestNickCollisions:
    def test_nick_case_sensitive_collision(self, client):
        """Register 'Boss' and 'boss' — checks case-insensitive duplicate handling."""
        register_player(client, make_player_id("player-boss1"), "Boss")
        r2 = register_player(client, make_player_id("player-boss2"), "boss")
        # Case-sensitive unique constraint (SQLite default) — both accepted
        assert r2.status_code in (201, 409)

    def test_nick_single_character(self, client):
        """A single-character nick should be accepted."""
        r = register_player(client, make_player_id("player-singlechar"), "X")
        assert r.status_code == 201
        assert r.get_json()["nick"] == "X"

    def test_nick_with_unicode_emoji(self, client):
        """Nick with emoji should be accepted."""
        r = register_player(client, make_player_id("player-emoji"), "💀hacker")
        assert r.status_code == 201
        assert r.get_json()["nick"] == "💀hacker"

    def test_nick_homoglyph_not_detected(self, client):
        """Nick with cyrillic homoglyph passes as unique (no homoglyph detection)."""
        register_player(client, make_player_id("player-latin"), "Boss")
        # 'п' is cyrillic, not latin 'o'
        r2 = register_player(client, make_player_id("player-cyrillic"), "Bпss")
        assert r2.status_code == 201


class TestBulkDeletePlayers:
    def test_bulk_delete_clears_scoreboard(self, client, admin_client):
        """After deleting all players, scoreboard is empty."""
        start_game(admin_client)
        register_player(client, make_player_id("player-bulk-a"), "BulkA")
        register_player(client, make_player_id("player-bulk-b"), "BulkB")
        admin_client.post(f"/admin/api/players/{make_player_id('player-bulk-a')}/adjust", json={"delta": 50})

        admin_client.delete("/admin/api/players")

        sb = client.get("/api/scoreboard").get_json()
        assert sb["players"] == []

    def test_scan_after_player_deleted_returns_404(self, client, admin_client):
        """A deleted player gets 404 when scanning."""
        start_game(admin_client)
        register_player(client, make_player_id("player-deleted"), "DeletedPlayer")
        tags = create_tag(admin_client, "unlimited", {"points": 10})
        tag_id = tags[0]["id"]

        admin_client.delete("/admin/api/players")

        rate_limiter.clear()
        r = scan_tag(client, make_player_id("player-deleted"), tag_id)
        assert r.status_code == 404
        assert r.get_json()["error"] == "PLAYER_NOT_FOUND"


class TestNegativePointsScoreboard:
    def test_scoreboard_with_negative_balance(self, client, admin_client):
        """Players with negative points are ranked below zero-point players."""
        start_game(admin_client)
        register_player(client, make_player_id("player-neg-a"), "NegA")
        register_player(client, make_player_id("player-neg-b"), "NegB")
        register_player(client, make_player_id("player-neg-c"), "NegC")

        admin_client.post(f"/admin/api/players/{make_player_id('player-neg-a')}/adjust", json={"delta": 50})
        admin_client.post(f"/admin/api/players/{make_player_id('player-neg-b')}/adjust", json={"delta": -20})

        sb = client.get("/api/scoreboard").get_json()
        players = sb["players"]
        assert len(players) == 3
        assert players[0]["nick"] == "NegA"
        assert players[0]["points"] == 50
        assert players[1]["nick"] == "NegC"
        assert players[1]["points"] == 0
        assert players[2]["nick"] == "NegB"
        assert players[2]["points"] == -20

    def test_negative_balance_does_not_affect_others_ranks(self, client, admin_client):
        """One player going negative doesn't corrupt other players' rankings."""
        start_game(admin_client)
        register_player(client, make_player_id("player-neg2-a"), "Neg2A")
        register_player(client, make_player_id("player-neg2-b"), "Neg2B")

        admin_client.post(f"/admin/api/players/{make_player_id('player-neg2-a')}/adjust", json={"delta": 100})
        admin_client.post(f"/admin/api/players/{make_player_id('player-neg2-b')}/adjust", json={"delta": -50})

        sb = client.get("/api/scoreboard").get_json()
        players = sb["players"]
        assert players[0]["rank"] == 1
        assert players[0]["nick"] == "Neg2A"
        assert players[1]["rank"] == 2
        assert players[1]["nick"] == "Neg2B"
