"""
WebSocket gap tests: broadcast after player deletion, bulk delete, game start/stop.
"""
from helpers import start_game, register_player


class TestWebSocketGameLifecycleBroadcast:
    def test_game_start_broadcasts_scoreboard(self, app, client, admin_client, ws_client):
        """POST /admin/api/game/start must broadcast scoreboard_update with status 'active'."""
        ws_client.get_received()

        admin_client.post("/admin/api/game/start")

        received = ws_client.get_received()
        event = next((e for e in received if e["name"] == "scoreboard_update"), None)
        assert event is not None, "Expected scoreboard_update after game start"
        assert event["args"][0]["game"]["status"] == "active"

    def test_game_stop_broadcasts_scoreboard(self, app, client, admin_client, ws_client):
        """POST /admin/api/game/stop must broadcast scoreboard_update with status 'finished'."""
        start_game(admin_client)
        ws_client.get_received()

        admin_client.post("/admin/api/game/stop")

        received = ws_client.get_received()
        event = next((e for e in received if e["name"] == "scoreboard_update"), None)
        assert event is not None, "Expected scoreboard_update after game stop"
        assert event["args"][0]["game"]["status"] == "finished"


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
