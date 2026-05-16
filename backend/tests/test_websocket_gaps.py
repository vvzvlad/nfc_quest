"""
WebSocket gap tests: broadcast after player deletion, bulk delete.
"""
from helpers import start_game, register_player


class TestWebSocketDeletePlayerBroadcast:
    def test_delete_player_broadcasts_scoreboard(self, app, client, admin_client, ws_client):
        """delete_player() must broadcast scoreboard_update."""
        start_game(admin_client)
        register_player(client, "player-ws-del", "WSDelPlayer")
        admin_client.post("/admin/api/players/player-ws-del/adjust", json={"delta": 50})

        ws_client.get_received()

        admin_client.delete("/admin/api/players/player-ws-del")

        received = ws_client.get_received()
        event = next((e for e in received if e["name"] == "scoreboard_update"), None)
        assert event is not None, "Expected scoreboard_update after player deletion"

    def test_bulk_delete_players_broadcasts_scoreboard(self, app, client, admin_client, ws_client):
        """delete_all_players() must broadcast scoreboard_update."""
        start_game(admin_client)
        register_player(client, "player-ws-bulk", "WSBulkPlayer")

        ws_client.get_received()

        admin_client.delete("/admin/api/players")

        received = ws_client.get_received()
        event = next((e for e in received if e["name"] == "scoreboard_update"), None)
        assert event is not None, "Expected scoreboard_update after bulk player deletion"
