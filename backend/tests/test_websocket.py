"""
WebSocket E2E tests (Block H).

H1 - Initial state on client connect
H2 - Broadcast after a successful HTTP scan
H3 - Broadcast to multiple simultaneous clients
"""

import pytest


def test_ws_initial_state_on_connect(ws_client):
    """H1: On connect, the server must immediately emit scoreboard_update with correct keys."""
    # on_connect handler emits "scoreboard_update" immediately
    received = ws_client.get_received()
    # on_connect must emit exactly one scoreboard_update event
    scoreboard_events = [e for e in received if e["name"] == "scoreboard_update"]
    assert len(scoreboard_events) == 1, f"Expected exactly 1 scoreboard_update on connect, got {len(scoreboard_events)}"
    # Find the scoreboard_update event
    event = next((e for e in received if e["name"] == "scoreboard_update"), None)
    assert event is not None, "Expected scoreboard_update event on connect"
    data = event["args"][0]
    # Payload must contain required top-level keys
    assert "players" in data
    assert "game" in data
    assert "stats" in data
    # game must contain status
    assert "status" in data["game"]


def test_ws_broadcast_after_scan(app, client, admin_client, ws_client):
    """H2: After a successful HTTP scan, all connected WS clients receive scoreboard_update."""
    from helpers import start_game, create_tag, register_player, scan_tag
    from blueprints.game_api import rate_limiter

    # Setup: start game, register player, create tag
    start_game(admin_client)
    register_player(client, "player-h2", "PlayerH2")
    tags = create_tag(admin_client, "unlimited", {"points": 30})
    tag_id = tags[0]["id"]

    # Clear initial connect events from the WS client buffer
    ws_client.get_received()

    # HTTP scan triggers a broadcast
    rate_limiter.clear()
    r = scan_tag(client, "player-h2", tag_id)
    assert r.get_json()["status"] == "ok"

    # WS client should receive scoreboard_update
    received = ws_client.get_received()
    event = next((e for e in received if e["name"] == "scoreboard_update"), None)
    assert event is not None, "Expected scoreboard_update broadcast after scan"

    data = event["args"][0]
    # Updated scoreboard should contain the player with 30 points
    player_nicks = [p["nick"] for p in data["players"]]
    assert "PlayerH2" in player_nicks
    player_data = next(p for p in data["players"] if p["nick"] == "PlayerH2")
    assert player_data["points"] == 30


def test_ws_broadcast_to_multiple_clients(app, client, admin_client):
    """H3: A single HTTP scan must broadcast scoreboard_update to ALL connected WS clients."""
    import socket_events
    from helpers import start_game, create_tag, register_player, scan_tag
    from blueprints.game_api import rate_limiter

    # Setup
    start_game(admin_client)
    register_player(client, "player-h3", "PlayerH3")
    tags = create_tag(admin_client, "unlimited", {"points": 10})
    tag_id = tags[0]["id"]

    # Connect two separate WS clients
    ws_client_1 = socket_events.socketio.test_client(app)
    ws_client_2 = socket_events.socketio.test_client(app)
    try:
        # Drain initial connect events from both
        ws_client_1.get_received()
        ws_client_2.get_received()

        # One HTTP scan should broadcast to ALL connected clients
        rate_limiter.clear()
        r = scan_tag(client, "player-h3", tag_id)
        assert r.get_json()["status"] == "ok"

        # Both clients must receive the scoreboard_update
        received_1 = ws_client_1.get_received()
        received_2 = ws_client_2.get_received()

        event_1 = next((e for e in received_1 if e["name"] == "scoreboard_update"), None)
        event_2 = next((e for e in received_2 if e["name"] == "scoreboard_update"), None)

        assert event_1 is not None, "Client 1 did not receive scoreboard_update"
        assert event_2 is not None, "Client 2 did not receive scoreboard_update"
    finally:
        # Always disconnect to release SocketIO resources
        ws_client_1.disconnect()
        ws_client_2.disconnect()
