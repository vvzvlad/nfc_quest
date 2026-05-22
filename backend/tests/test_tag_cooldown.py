"""
Block TC: Per-tag-per-player 60-second scan cooldown tests.

The cooldown is tracked in tag_scan_limiter keyed by (player_id, tag_id).
rate_limiter.clear() also clears tag_scan_limiter (via _ClearLinkedDict).

Key interaction: backdating rate_limiter[player_id] evicts all tag_scan_limiter
entries for that player. Tests that need the cooldown active must restore
tag_scan_limiter after each rate_limiter backdate.
"""
from datetime import datetime, timezone, timedelta

from helpers import start_game, create_tag, register_player, scan_tag, make_player_id
from blueprints.game_api import rate_limiter, tag_scan_limiter


class TestTagCooldown:
    # TC-1: Same player rescanning the same tag within 60 s is blocked by cooldown
    def test_cooldown_blocks_same_player_same_tag(self, client, admin_client):
        start_game(admin_client)
        tags = create_tag(admin_client, "random", {"min": 10, "max": 10})
        tag_id = tags[0]["id"]
        player_id = make_player_id("player-tc1")
        register_player(client, player_id, "PlayerTC1")

        # First scan must succeed
        r1 = scan_tag(client, player_id, tag_id)
        assert r1.status_code == 200
        assert r1.get_json()["status"] == "ok"

        # Bypass the 1-second rate_limiter without touching tag_scan_limiter:
        # backdating rate_limiter evicts the tag_scan_limiter entry, so we must
        # restore it immediately after to keep the 60-second cooldown active.
        scan_key = (player_id, tag_id)
        rate_limiter[player_id] = datetime.now(timezone.utc) - timedelta(seconds=2)
        tag_scan_limiter[scan_key] = datetime.now(timezone.utc)  # restore fresh cooldown

        # Second scan on the same tag within 60 s must be blocked
        r2 = scan_tag(client, player_id, tag_id)
        assert r2.status_code == 429
        body = r2.get_json()
        assert body["status"] == "cooldown"
        assert body["message"] == "метку можно повторно отсканировать только через минуту"

    # TC-2: After 60+ seconds the cooldown expires and the scan is allowed again
    def test_cooldown_allows_after_60_seconds(self, client, admin_client):
        start_game(admin_client)
        tags = create_tag(admin_client, "random", {"min": 10, "max": 10})
        tag_id = tags[0]["id"]
        player_id = make_player_id("player-tc2")
        register_player(client, player_id, "PlayerTC2")

        # First scan must succeed
        r1 = scan_tag(client, player_id, tag_id)
        assert r1.status_code == 200
        assert r1.get_json()["status"] == "ok"

        # Simulate 61 seconds passing:
        # 1. Backdate rate_limiter (evicts tag_scan_limiter entry for this player).
        # 2. Restore tag_scan_limiter with a 61-second-old timestamp so the cooldown
        #    is seen as expired by the scan endpoint.
        scan_key = (player_id, tag_id)
        rate_limiter[player_id] = datetime.now(timezone.utc) - timedelta(seconds=2)
        tag_scan_limiter[scan_key] = datetime.now(timezone.utc) - timedelta(seconds=61)

        # Third scan must succeed because the 60-second window has elapsed
        r2 = scan_tag(client, player_id, tag_id)
        assert r2.status_code == 200
        assert r2.get_json()["status"] == "ok"

    # TC-3: Cooldown is independent per tag — scanning a different tag is never blocked
    def test_cooldown_independent_per_tag(self, client, admin_client):
        start_game(admin_client)
        tags_a = create_tag(admin_client, "random", {"min": 10, "max": 10})
        tags_b = create_tag(admin_client, "random", {"min": 10, "max": 10})
        tag_a_id = tags_a[0]["id"]
        tag_b_id = tags_b[0]["id"]
        player_id = make_player_id("player-tc3")
        register_player(client, player_id, "PlayerTC3")

        # Scan tag A — succeeds
        r1 = scan_tag(client, player_id, tag_a_id)
        assert r1.status_code == 200
        assert r1.get_json()["status"] == "ok"

        # Reset both limiters so only the tag_b scan matters
        rate_limiter.clear()

        # Scan tag B — must succeed because (player_id, tag_b_id) has no cooldown entry
        r2 = scan_tag(client, player_id, tag_b_id)
        assert r2.status_code == 200
        assert r2.get_json()["status"] == "ok"

    # TC-4: Cooldown is independent per player — a different player scanning the same tag is allowed
    def test_cooldown_independent_per_player(self, client, admin_client):
        start_game(admin_client)
        tags = create_tag(admin_client, "random", {"min": 10, "max": 10})
        tag_id = tags[0]["id"]
        player_a_id = make_player_id("player-tc4a")
        player_b_id = make_player_id("player-tc4b")
        register_player(client, player_a_id, "PlayerTC4A")
        register_player(client, player_b_id, "PlayerTC4B")

        # Player A scans — succeeds
        r_a = scan_tag(client, player_a_id, tag_id)
        assert r_a.status_code == 200
        assert r_a.get_json()["status"] == "ok"

        # Reset both limiters so only player B's entry matters
        rate_limiter.clear()

        # Player B scans the same tag — must succeed because (player_b_id, tag_id) has no cooldown
        r_b = scan_tag(client, player_b_id, tag_id)
        assert r_b.status_code == 200
        assert r_b.get_json()["status"] == "ok"

    # TC-5: Cooldown response body contains exact status and message strings
    def test_cooldown_response_body(self, client, admin_client):
        start_game(admin_client)
        tags = create_tag(admin_client, "random", {"min": 10, "max": 10})
        tag_id = tags[0]["id"]
        player_id = make_player_id("player-tc5")
        register_player(client, player_id, "PlayerTC5")

        # First scan must succeed
        r1 = scan_tag(client, player_id, tag_id)
        assert r1.status_code == 200

        # Bypass rate_limiter, restore tag_scan_limiter with a fresh timestamp
        scan_key = (player_id, tag_id)
        rate_limiter[player_id] = datetime.now(timezone.utc) - timedelta(seconds=2)
        tag_scan_limiter[scan_key] = datetime.now(timezone.utc)  # restore fresh cooldown

        # Second scan must return 429 with exact body fields
        r2 = scan_tag(client, player_id, tag_id)
        assert r2.status_code == 429
        body = r2.get_json()
        assert body["status"] == "cooldown"
        assert body["message"] == "метку можно повторно отсканировать только через минуту"

    # TC-6: Cooldown fires before strategy — a one_time_per_player tag that was already scanned
    #        returns "cooldown", not "locked", when rescanned within the 60-second window
    def test_cooldown_fires_before_strategy(self, client, admin_client):
        start_game(admin_client)
        tags = create_tag(admin_client, "one_time_per_player", {"points": 20})
        tag_id = tags[0]["id"]
        player_id = make_player_id("player-tc6")
        register_player(client, player_id, "PlayerTC6")

        # First scan: player collects the tag — strategy creates a TagPlayerScan record
        r1 = scan_tag(client, player_id, tag_id)
        assert r1.status_code == 200
        assert r1.get_json()["status"] == "ok"

        # Bypass rate_limiter, restore tag_scan_limiter with a fresh timestamp.
        # The TagPlayerScan DB record still exists, so the strategy would return "locked"
        # if reached — but the cooldown must intercept first.
        scan_key = (player_id, tag_id)
        rate_limiter[player_id] = datetime.now(timezone.utc) - timedelta(seconds=2)
        tag_scan_limiter[scan_key] = datetime.now(timezone.utc)  # restore fresh cooldown

        # Second scan: cooldown must fire before strategy evaluation
        r2 = scan_tag(client, player_id, tag_id)
        assert r2.status_code == 429
        body = r2.get_json()
        assert body["status"] == "cooldown", (
            f"Expected 'cooldown' but got '{body.get('status')}' — "
            "cooldown should fire before strategy"
        )

    # TC-7: Cooldown fires before game status check — after the game is stopped,
    #        a rescan within 60 s returns "cooldown", not "finished"
    def test_cooldown_fires_before_game_status(self, client, admin_client):
        start_game(admin_client)
        tags = create_tag(admin_client, "random", {"min": 10, "max": 10})
        tag_id = tags[0]["id"]
        player_id = make_player_id("player-tc7")
        register_player(client, player_id, "PlayerTC7")

        # Scan while the game is running — must succeed
        r1 = scan_tag(client, player_id, tag_id)
        assert r1.status_code == 200
        assert r1.get_json()["status"] == "ok"

        # Stop the game so the next scan would normally return "finished"
        admin_client.post("/admin/api/game/stop")

        # Bypass rate_limiter, restore tag_scan_limiter with a fresh timestamp.
        # Without restoring the cooldown entry, the stopped game would return "finished".
        scan_key = (player_id, tag_id)
        rate_limiter[player_id] = datetime.now(timezone.utc) - timedelta(seconds=2)
        tag_scan_limiter[scan_key] = datetime.now(timezone.utc)  # restore fresh cooldown

        # Rescan: cooldown must fire before the game-status check
        r2 = scan_tag(client, player_id, tag_id)
        assert r2.status_code == 429
        body = r2.get_json()
        assert body["status"] == "cooldown", (
            f"Expected 'cooldown' but got '{body.get('status')}' — "
            "cooldown should fire before game status check"
        )
