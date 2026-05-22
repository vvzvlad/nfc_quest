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
    assert "server_uptime" in data, "server_uptime must be present so clients can detect server restarts"
    assert isinstance(data["server_uptime"], float), "server_uptime must be a float (seconds)"
    # game must contain status
    assert "status" in data["game"]


def test_ws_broadcast_after_scan(app, client, admin_client, ws_client):
    """H2: After a successful HTTP scan, all connected WS clients receive scoreboard_update."""
    from helpers import start_game, create_tag, register_player, scan_tag, make_player_id
    from blueprints.game_api import rate_limiter

    # Setup: start game, register player, create tag
    start_game(admin_client)
    register_player(client, make_player_id("player-h2"), "PlayerH2")
    tags = create_tag(admin_client, "random", {"min": 30, "max": 30})
    tag_id = tags[0]["id"]

    # Clear initial connect events from the WS client buffer
    ws_client.get_received()

    # HTTP scan triggers a broadcast
    rate_limiter.clear()
    r = scan_tag(client, make_player_id("player-h2"), tag_id)
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
    from helpers import start_game, create_tag, register_player, scan_tag, make_player_id
    from blueprints.game_api import rate_limiter

    # Setup
    start_game(admin_client)
    register_player(client, make_player_id("player-h3"), "PlayerH3")
    tags = create_tag(admin_client, "random", {"min": 10, "max": 10})
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
        r = scan_tag(client, make_player_id("player-h3"), tag_id)
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


def test_ws_no_broadcast_on_locked_scan(app, client, admin_client, ws_client):
    """H2b: A locked scan must NOT trigger a scoreboard_update broadcast."""
    from helpers import start_game, create_tag, register_player, scan_tag, make_player_id
    from blueprints.game_api import rate_limiter

    # Setup: start game, register player, create one_time_global tag
    start_game(admin_client)
    register_player(client, make_player_id("player-h2b"), "PlayerH2B")
    tags = create_tag(admin_client, "one_time_global", {"points": 10})
    tag_id = tags[0]["id"]

    # First scan succeeds and locks the tag
    rate_limiter.clear()
    r1 = scan_tag(client, make_player_id("player-h2b"), tag_id)
    assert r1.get_json()["status"] == "ok"

    # Drain all events so far (connect + first scan broadcast)
    ws_client.get_received()

    # Second scan on the same one_time_global tag — must be locked
    rate_limiter.clear()
    r2 = scan_tag(client, make_player_id("player-h2b"), tag_id)
    assert r2.get_json()["status"] == "locked"

    # A locked scan must NOT produce a scoreboard_update broadcast
    received = ws_client.get_received()
    broadcast_events = [e for e in received if e["name"] == "scoreboard_update"]
    assert len(broadcast_events) == 0, (
        "scoreboard_update must not be broadcast after a locked scan"
    )


def test_ws_no_broadcast_on_not_yet_scan(app, client, admin_client, ws_client):
    """WS-M1: Scanning while game has not started must NOT broadcast scoreboard_update."""
    from helpers import create_tag, register_player, scan_tag, make_player_id
    from blueprints.game_api import rate_limiter

    # Set game far in the future so it has not started yet
    admin_client.put(
        "/admin/api/game",
        json={"starts_at": "2099-01-01T00:00:00Z", "ends_at": "2099-12-31T00:00:00Z"},
    )

    # Drain initial connect events
    ws_client.get_received()

    register_player(client, make_player_id("player-wm1"), "PlayerWM1")
    tags = create_tag(admin_client, "random", {"min": 10, "max": 10})
    tag_id = tags[0]["id"]

    # Scan — should return "not_yet"
    rate_limiter.clear()
    r = scan_tag(client, make_player_id("player-wm1"), tag_id)
    assert r.get_json()["status"] == "not_yet"

    # No scoreboard_update broadcast should have been emitted
    received = ws_client.get_received()
    broadcast_events = [e for e in received if e["name"] == "scoreboard_update"]
    assert len(broadcast_events) == 0, (
        "scoreboard_update must not be broadcast after a not_yet scan"
    )


def test_ws_no_broadcast_on_finished_scan(app, client, admin_client, ws_client):
    """WS-M1b: Scanning when game is finished must NOT broadcast scoreboard_update."""
    from helpers import create_tag, register_player, scan_tag, make_player_id
    from blueprints.game_api import rate_limiter

    # Set game in the distant past so it is finished
    admin_client.put(
        "/admin/api/game",
        json={"starts_at": "2000-01-01T00:00:00Z", "ends_at": "2000-06-01T00:00:00Z"},
    )

    # Drain initial connect events
    ws_client.get_received()

    register_player(client, make_player_id("player-wm1b"), "PlayerWM1B")
    tags = create_tag(admin_client, "random", {"min": 10, "max": 10})
    tag_id = tags[0]["id"]

    # Scan — should return "finished"
    rate_limiter.clear()
    r = scan_tag(client, make_player_id("player-wm1b"), tag_id)
    assert r.get_json()["status"] == "finished"

    # No scoreboard_update broadcast should have been emitted
    received = ws_client.get_received()
    broadcast_events = [e for e in received if e["name"] == "scoreboard_update"]
    assert len(broadcast_events) == 0, (
        "scoreboard_update must not be broadcast after a finished scan"
    )


def test_ws_broadcast_after_admin_adjust(app, client, admin_client, ws_client):
    """WS-M2: Admin adjusting player points must broadcast scoreboard_update.
    WILL FAIL — current adjust_player() does NOT call broadcast_scoreboard().
    """
    from helpers import start_game, register_player, make_player_id

    start_game(admin_client)
    r_reg = register_player(client, make_player_id("player-wm2"), "PlayerWM2")
    player_id = r_reg.get_json()["player_id"]

    # Drain connect event
    ws_client.get_received()

    # Admin adjusts player points — this should trigger a broadcast
    r_adj = admin_client.post(f"/admin/api/players/{player_id}/adjust", json={"delta": 100})
    assert r_adj.status_code == 200

    # WS client should receive scoreboard_update
    received = ws_client.get_received()
    event = next((e for e in received if e["name"] == "scoreboard_update"), None)
    assert event is not None, (
        "Expected scoreboard_update broadcast after admin point adjustment, but none received"
    )
