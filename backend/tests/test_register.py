"""
Block A: Player registration tests.
"""
import pytest
from helpers import register_player


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
