"""
Block A: Player registration tests.
"""
import pytest
from helpers import register_player, start_game


class TestRegister:
    # A1: Registering a new player returns 201 with expected fields
    def test_register_new_player(self, client):
        r = register_player(client, "uuid-1", "Alice")
        assert r.status_code == 201
        body = r.get_json()
        assert body["player_id"] == "uuid-1"
        assert body["nick"] == "Alice"
        assert body["points"] == 0

    # A2: Registering with the same player_id is idempotent — returns existing data
    def test_register_idempotent(self, client):
        register_player(client, "uuid-1", "Alice")
        # Second call with a different nick should return original data unchanged
        r2 = register_player(client, "uuid-1", "AliceChanged")
        assert r2.status_code == 200
        body = r2.get_json()
        assert body["player_id"] == "uuid-1"
        assert body["nick"] == "Alice"  # nick not overwritten
        assert body["points"] == 0

    # A3: Two different player_ids with the same nick → 409 on the second
    def test_register_nick_conflict(self, client):
        register_player(client, "uuid-1", "SharedNick")
        r2 = register_player(client, "uuid-2", "SharedNick")
        assert r2.status_code == 409
        body = r2.get_json()
        assert "error" in body
        assert body["error"] == "NICK_TAKEN"

    # A4: Missing required fields → 400
    @pytest.mark.parametrize("payload", [
        {"player_id": "", "nick": "Alice"},      # empty player_id
        {"player_id": "uuid-1", "nick": ""},     # empty nick
        {},                                       # completely empty body
        {"player_id": "   ", "nick": "Alice"},   # whitespace-only player_id
        {"player_id": "uuid-1", "nick": "   "}, # whitespace-only nick
    ])
    def test_register_missing_fields(self, client, payload):
        r = client.post("/api/register", json=payload)
        assert r.status_code == 400
        body = r.get_json()
        assert "error" in body
        assert body["error"] == "MISSING_FIELDS"

    # R-M1: SQLite doesn't enforce VARCHAR(64); a 100-char nick is accepted silently
    def test_register_nick_too_long(self, client):
        long_nick = "A" * 100
        r = register_player(client, "uuid-long-nick", long_nick)
        assert r.status_code == 201
        body = r.get_json()
        assert body["nick"] == long_nick

    # R-M2: SQLite doesn't enforce VARCHAR length on player_id either
    def test_register_player_id_too_long(self, client):
        long_id = "x" * 100
        r = register_player(client, long_id, "PlayerLongId")
        assert r.status_code == 201
        body = r.get_json()
        assert body["player_id"] == long_id

    # R-M3: Registration should work in not_started/active states,
    # but the sub-case for "finished" state expects 403 (WILL FAIL — current code returns 201)
    @pytest.mark.parametrize("game_state,expected_status", [
        ("not_started", 201),
        ("active", 201),
        ("finished", 403),  # desired behavior: block registration after game ends
    ])
    def test_register_works_in_any_game_state(self, client, admin_client, game_state, expected_status):
        if game_state == "not_started":
            # Default state — no setup needed
            pass
        elif game_state == "active":
            start_game(admin_client)
        elif game_state == "finished":
            admin_client.put(
                "/admin/api/game",
                json={
                    "starts_at": "2000-01-01T00:00:00Z",
                    "ends_at": "2000-06-01T00:00:00Z",
                },
            )

        r = register_player(client, f"uuid-state-{game_state}", f"Player_{game_state}")
        assert r.status_code == expected_status
        if expected_status == 403:
            assert "error" in r.get_json()
            assert r.get_json()["error"] == "REGISTRATION_CLOSED"

    # R-M4: Sending wrong content type (text/plain) should return 400
    def test_register_wrong_content_type(self, client):
        r = client.post(
            "/api/register",
            data="player_id=uuid-1&nick=Alice",
            content_type="text/plain",
        )
        assert r.status_code == 400

    # A2-fix: Idempotent re-registration returns the player's CURRENT points (not zero)
    def test_register_idempotent_returns_current_points(self, client, admin_client):
        # Register player, then give them 50 points via admin adjust
        register_player(client, "uuid-pts", "PlayerPts")
        admin_client.post("/admin/api/players/uuid-pts/adjust", json={"delta": 50})

        # Re-register with the same player_id — should return current points (50)
        r2 = register_player(client, "uuid-pts", "PlayerPtsChanged")
        assert r2.status_code == 200
        body = r2.get_json()
        assert body["points"] == 50
