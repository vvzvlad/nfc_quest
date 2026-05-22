"""
Block E: Scoreboard endpoint tests.
"""
from helpers import start_game, create_tag, register_player, scan_tag, make_player_id
from blueprints.game_api import rate_limiter, tag_scan_limiter


class TestScoreboard:
    # E1: Players are ordered by points descending; ranks are correct
    def test_scoreboard_ordering(self, client, admin_client):
        start_game(admin_client)

        # Register three players
        register_player(client, make_player_id("player-e1a"), "Alice")
        register_player(client, make_player_id("player-e1b"), "Bob")
        register_player(client, make_player_id("player-e1c"), "Charlie")

        # Give them different point totals via admin adjust
        admin_client.post(f"/admin/api/players/{make_player_id('player-e1a')}/adjust", json={"delta": 100})
        admin_client.post(f"/admin/api/players/{make_player_id('player-e1b')}/adjust", json={"delta": 50})
        admin_client.post(f"/admin/api/players/{make_player_id('player-e1c')}/adjust", json={"delta": 200})

        r = client.get("/api/scoreboard")
        assert r.status_code == 200
        body = r.get_json()

        players = body["players"]
        assert len(players) == 3

        # First place: Charlie with 200 points
        assert players[0]["points"] == 200
        assert players[0]["rank"] == 1
        assert players[0]["nick"] == "Charlie"

        # Second place: Alice with 100 points
        assert players[1]["points"] == 100
        assert players[1]["rank"] == 2

        # Third place: Bob with 50 points
        assert players[2]["points"] == 50
        assert players[2]["rank"] == 3

    # E2: Empty database → 200 with empty players list and game status "not_started"
    def test_scoreboard_empty_db(self, client):
        r = client.get("/api/scoreboard")
        assert r.status_code == 200
        body = r.get_json()

        assert body["players"] == []
        assert body["game"]["status"] == "not_started"
        # stats key must be present and contain expected sub-keys
        assert "stats" in body
        assert "total_players" in body["stats"]
        assert "total_tags" in body["stats"]
        assert "scans_per_minute" in body["stats"]
        assert body["stats"]["total_players"] == 0
        assert body["stats"]["total_tags"] == 0
        assert body["stats"]["scans_per_minute"] == 0.0

    # E-M1: Tie-breaking by registration time (earlier registration = higher rank).
    # Uses PKs where lexicographic order is OPPOSITE to registration order,
    # so the test fails if the query relies on PK order instead of registered_at.
    def test_scoreboard_tie_breaking_by_registration_order(self, client, admin_client):
        import time
        start_game(admin_client)

        # Bob registers first but has PK "player-em1z" (lexicographically LATER)
        register_player(client, make_player_id("player-em1z"), "Bob")
        time.sleep(0.05)
        # Alice registers second but has PK "player-em1a" (lexicographically EARLIER)
        register_player(client, make_player_id("player-em1a"), "Alice")

        # Give both exactly 50 points
        admin_client.post(f"/admin/api/players/{make_player_id('player-em1z')}/adjust", json={"delta": 50})
        admin_client.post(f"/admin/api/players/{make_player_id('player-em1a')}/adjust", json={"delta": 50})

        r = client.get("/api/scoreboard")
        assert r.status_code == 200
        players = r.get_json()["players"]
        assert len(players) == 2

        # Bob registered first → rank 1; Alice registered second → rank 2
        assert players[0]["nick"] == "Bob", (
            f"Expected Bob (registered first) at rank 1, got {players[0]['nick']}"
        )
        assert players[0]["rank"] == 1
        assert players[1]["nick"] == "Alice", (
            f"Expected Alice (registered second) at rank 2, got {players[1]['nick']}"
        )
        assert players[1]["rank"] == 2

    # E-M2: Scoreboard for a not_started game includes a starts_at ISO-8601 string
    def test_scoreboard_not_started_has_starts_at(self, client, admin_client):
        future_starts = "2099-06-01T12:00:00Z"
        admin_client.put(
            "/admin/api/game",
            json={"starts_at": future_starts, "ends_at": "2099-12-31T00:00:00Z"},
        )

        r = client.get("/api/scoreboard")
        assert r.status_code == 200
        body = r.get_json()

        assert body["game"]["status"] == "not_started"
        assert body["game"]["starts_at"] is not None
        # Must be a valid ISO-8601 string (contains date separator)
        assert isinstance(body["game"]["starts_at"], str)
        assert "T" in body["game"]["starts_at"]

    # E-M3: Scoreboard for a finished game exposes the configured award_message
    def test_scoreboard_finished_has_award_message(self, client, admin_client):
        admin_client.put(
            "/admin/api/game",
            json={
                "starts_at": "2000-01-01T00:00:00Z",
                "ends_at": "2000-06-01T00:00:00Z",
                "award_message": "Ceremony at 6pm",
            },
        )

        r = client.get("/api/scoreboard")
        assert r.status_code == 200
        body = r.get_json()

        assert body["game"]["status"] == "finished"
        assert body["game"]["award_message"] == "Ceremony at 6pm"

    # E-M4: Scoreboard includes players with zero points
    def test_scoreboard_includes_zero_points_players(self, client, admin_client):
        start_game(admin_client)
        register_player(client, make_player_id("player-em4a"), "PlayerEM4A")
        register_player(client, make_player_id("player-em4b"), "PlayerEM4B")

        # Only give points to player A; player B stays at 0
        admin_client.post(f"/admin/api/players/{make_player_id('player-em4a')}/adjust", json={"delta": 50})

        r = client.get("/api/scoreboard")
        assert r.status_code == 200
        players = r.get_json()["players"]
        assert len(players) == 2

        nicks = {p["nick"] for p in players}
        assert "PlayerEM4A" in nicks
        assert "PlayerEM4B" in nicks

        player_b = next(p for p in players if p["nick"] == "PlayerEM4B")
        assert player_b["points"] == 0

    # E-M6: Rank is computed correctly as players accumulate points via scans
    def test_scoreboard_rank_computed_correctly(self, client, admin_client):
        start_game(admin_client)

        # Create tags with different point values
        tags_10 = create_tag(admin_client, "random", {"min": 10, "max": 10})
        tags_20 = create_tag(admin_client, "random", {"min": 20, "max": 20})
        tags_5 = create_tag(admin_client, "random", {"min": 5, "max": 5})

        # Register four players
        register_player(client, make_player_id("rank-a"), "Alpha")
        register_player(client, make_player_id("rank-b"), "Beta")
        register_player(client, make_player_id("rank-c"), "Gamma")
        register_player(client, make_player_id("rank-d"), "Delta")

        # Alpha scans 10-point tag twice → 20 pts
        rate_limiter.clear()
        scan_tag(client, make_player_id("rank-a"), tags_10[0]["id"])
        rate_limiter.clear()
        scan_tag(client, make_player_id("rank-a"), tags_10[0]["id"])

        # Beta scans 20-point tag three times → 60 pts
        rate_limiter.clear()
        scan_tag(client, make_player_id("rank-b"), tags_20[0]["id"])
        rate_limiter.clear()
        scan_tag(client, make_player_id("rank-b"), tags_20[0]["id"])
        rate_limiter.clear()
        scan_tag(client, make_player_id("rank-b"), tags_20[0]["id"])

        # Gamma scans 5-point tag once → 5 pts
        rate_limiter.clear()
        scan_tag(client, make_player_id("rank-c"), tags_5[0]["id"])

        # Delta has no scans → 0 pts

        r = client.get("/api/scoreboard")
        assert r.status_code == 200
        players = r.get_json()["players"]
        assert len(players) == 4

        # Expected order: Beta(60) > Alpha(20) > Gamma(5) > Delta(0)
        assert players[0]["nick"] == "Beta"
        assert players[0]["points"] == 60
        assert players[0]["rank"] == 1

        assert players[1]["nick"] == "Alpha"
        assert players[1]["points"] == 20
        assert players[1]["rank"] == 2

        assert players[2]["nick"] == "Gamma"
        assert players[2]["points"] == 5
        assert players[2]["rank"] == 3

        assert players[3]["nick"] == "Delta"
        assert players[3]["points"] == 0
        assert players[3]["rank"] == 4

    # E-M7: Rank updates correctly after leapfrogging another player
    def test_scoreboard_rank_updates_on_leapfrog(self, client, admin_client):
        start_game(admin_client)

        tags_50 = create_tag(admin_client, "random", {"min": 50, "max": 50})

        register_player(client, make_player_id("leap-a"), "Leader")
        register_player(client, make_player_id("leap-b"), "Chaser")

        # Leader gets 50 pts
        rate_limiter.clear()
        scan_tag(client, make_player_id("leap-a"), tags_50[0]["id"])

        r = client.get("/api/scoreboard")
        players = r.get_json()["players"]
        assert players[0]["nick"] == "Leader"
        assert players[0]["rank"] == 1
        assert players[1]["nick"] == "Chaser"
        assert players[1]["rank"] == 2

        # Chaser scans twice → 100 pts, leapfrogs Leader
        rate_limiter.clear()
        scan_tag(client, make_player_id("leap-b"), tags_50[0]["id"])
        rate_limiter.clear()
        scan_tag(client, make_player_id("leap-b"), tags_50[0]["id"])

        r = client.get("/api/scoreboard")
        players = r.get_json()["players"]
        assert players[0]["nick"] == "Chaser"
        assert players[0]["points"] == 100
        assert players[0]["rank"] == 1
        assert players[1]["nick"] == "Leader"
        assert players[1]["points"] == 50
        assert players[1]["rank"] == 2

    # E-M8: Players with tied points get consecutive ranks (no gaps)
    def test_scoreboard_rank_no_gaps_on_ties(self, client, admin_client):
        import time
        start_game(admin_client)

        tags_30 = create_tag(admin_client, "random", {"min": 30, "max": 30})

        # Register in controlled order to make tie-breaking deterministic
        register_player(client, make_player_id("tie-first"), "First")
        time.sleep(0.05)
        register_player(client, make_player_id("tie-second"), "Second")
        time.sleep(0.05)
        register_player(client, make_player_id("tie-third"), "Third")

        # All three get the same points (30 each)
        rate_limiter.clear()
        scan_tag(client, make_player_id("tie-first"), tags_30[0]["id"])
        rate_limiter.clear()
        scan_tag(client, make_player_id("tie-second"), tags_30[0]["id"])
        rate_limiter.clear()
        scan_tag(client, make_player_id("tie-third"), tags_30[0]["id"])

        r = client.get("/api/scoreboard")
        players = r.get_json()["players"]
        assert len(players) == 3

        # All have 30 points; ranks must be 1, 2, 3 (consecutive, no gaps)
        ranks = [p["rank"] for p in players]
        assert ranks == [1, 2, 3]

        # Tie-breaking by registration order: First, Second, Third
        assert players[0]["nick"] == "First"
        assert players[1]["nick"] == "Second"
        assert players[2]["nick"] == "Third"

        # All points equal
        assert all(p["points"] == 30 for p in players)

    # E-M5: scans_per_minute is > 0 after recent scans
    def test_scoreboard_scans_per_minute_nonzero(self, client, admin_client):
        start_game(admin_client)
        register_player(client, make_player_id("player-em5"), "PlayerEM5")
        tags = create_tag(admin_client, "random", {"min": 5, "max": 5})
        tag_id = tags[0]["id"]

        # Perform 3 scans
        for _ in range(3):
            rate_limiter.clear()
            scan_tag(client, make_player_id("player-em5"), tag_id)

        r = client.get("/api/scoreboard")
        assert r.status_code == 200
        stats = r.get_json()["stats"]
        assert stats["scans_per_minute"] > 0


class TestScoreboardRecentScans:
    # E-RS1: recent_scans is present in the response and has the correct structure
    def test_recent_scans_present_and_structured(self, client, admin_client):
        start_game(admin_client)
        register_player(client, make_player_id("seed-rs1"), "NickRS1")
        tags = create_tag(admin_client, "random", {"min": 10, "max": 10})
        rate_limiter.clear()
        scan_tag(client, make_player_id("seed-rs1"), tags[0]["id"])

        r = client.get("/api/scoreboard")
        assert r.status_code == 200
        body = r.get_json()

        # recent_scans key must exist and be a list
        assert "recent_scans" in body
        assert isinstance(body["recent_scans"], list)

        # At least one scan entry must be present
        assert len(body["recent_scans"]) >= 1

        # Every entry must contain the required keys
        for entry in body["recent_scans"]:
            assert "nick" in entry, f"Entry missing 'nick': {entry}"
            assert "delta" in entry, f"Entry missing 'delta': {entry}"
            assert "scanned_at" in entry, f"Entry missing 'scanned_at': {entry}"

    # E-RS2: scanned_at has the correct UTC format with Z-suffix
    def test_recent_scans_scanned_at_utc_format(self, client, admin_client):
        from datetime import datetime

        start_game(admin_client)
        register_player(client, make_player_id("seed-rs2"), "NickRS2")
        tags = create_tag(admin_client, "random", {"min": 10, "max": 10})
        rate_limiter.clear()
        scan_tag(client, make_player_id("seed-rs2"), tags[0]["id"])

        r = client.get("/api/scoreboard")
        assert r.status_code == 200
        body = r.get_json()

        first = body["recent_scans"][0]
        scanned_at = first["scanned_at"]

        # Must be a string
        assert isinstance(scanned_at, str), f"scanned_at is not a string: {scanned_at!r}"

        # Must end with 'Z' and contain 'T' separator
        assert scanned_at.endswith("Z"), f"scanned_at does not end with 'Z': {scanned_at!r}"
        assert "T" in scanned_at, f"scanned_at missing 'T' separator: {scanned_at!r}"

        # Must be parseable as YYYY-MM-DDTHH:MM:SSZ
        datetime.strptime(scanned_at, "%Y-%m-%dT%H:%M:%SZ")

    # E-RS3: recent_scans is an empty list when no successful scans have occurred
    def test_recent_scans_empty_when_no_scans(self, client, admin_client):
        start_game(admin_client)
        register_player(client, make_player_id("seed-rs3"), "NickRS3")
        # No scan performed

        r = client.get("/api/scoreboard")
        assert r.status_code == 200
        body = r.get_json()

        assert "recent_scans" in body
        assert body["recent_scans"] == []
    
    
class TestScoreboardLastScanAt:
    # LSA-1: last_scan_at key is always present in every player entry (even without a scan)
    def test_last_scan_at_key_always_present(self, client, admin_client):
        start_game(admin_client)
        register_player(client, make_player_id("lsa1-player"), "NickLSA1")
        # No scan performed — key must still be present

        r = client.get("/api/scoreboard")
        assert r.status_code == 200
        players = r.get_json()["players"]

        player = next(p for p in players if p["nick"] == "NickLSA1")
        assert "last_scan_at" in player, f"'last_scan_at' key missing from player dict: {player}"

    # LSA-2: last_scan_at is null for a player who has never scanned
    def test_last_scan_at_null_before_any_scan(self, client, admin_client):
        start_game(admin_client)
        register_player(client, make_player_id("lsa2-player"), "NickLSA2")
        # No scan performed

        r = client.get("/api/scoreboard")
        assert r.status_code == 200
        players = r.get_json()["players"]

        player = next(p for p in players if p["nick"] == "NickLSA2")
        assert player["last_scan_at"] is None, (
            f"Expected last_scan_at to be None for player with no scans, got {player['last_scan_at']!r}"
        )

    # LSA-3: last_scan_at is a valid ISO 8601 UTC string after a successful scan
    def test_last_scan_at_iso8601_after_successful_scan(self, client, admin_client):
        from datetime import datetime, timezone, timedelta

        start_game(admin_client)
        register_player(client, make_player_id("lsa3-player"), "NickLSA3")
        tags = create_tag(admin_client, "random", {"min": 10, "max": 10})

        rate_limiter.clear()
        r_scan = scan_tag(client, make_player_id("lsa3-player"), tags[0]["id"])
        assert r_scan.get_json()["status"] == "ok"

        r = client.get("/api/scoreboard")
        assert r.status_code == 200
        players = r.get_json()["players"]

        player = next(p for p in players if p["nick"] == "NickLSA3")
        last_scan_at = player["last_scan_at"]

        # Must be a non-null string
        assert last_scan_at is not None, "Expected last_scan_at to be non-null after a successful scan"
        assert isinstance(last_scan_at, str), f"last_scan_at must be a string, got {type(last_scan_at)}"

        # Must end with 'Z' and contain 'T' separator
        assert last_scan_at.endswith("Z"), f"last_scan_at must end with 'Z', got {last_scan_at!r}"
        assert "T" in last_scan_at, f"last_scan_at must contain 'T' separator, got {last_scan_at!r}"

        # Must be parseable as YYYY-MM-DDTHH:MM:SSZ
        parsed = datetime.strptime(last_scan_at, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        assert now - timedelta(seconds=30) < parsed <= now, (
            f"last_scan_at {last_scan_at!r} is not within the last 30 seconds"
        )

    # LSA-4: last_scan_at advances to the second scan's timestamp after multiple scans
    def test_last_scan_at_updated_after_multiple_scans(self, client, admin_client):
        import time
        start_game(admin_client)
        register_player(client, make_player_id("lsa4-player"), "NickLSA4")
        tags = create_tag(admin_client, "random", {"min": 5, "max": 5})
        tag_id = tags[0]["id"]

        # First scan — record its timestamp
        rate_limiter.clear()
        r1 = scan_tag(client, make_player_id("lsa4-player"), tag_id)
        assert r1.get_json()["status"] == "ok"

        r_mid = client.get("/api/scoreboard")
        player_mid = next(p for p in r_mid.get_json()["players"] if p["nick"] == "NickLSA4")
        first_scan_at = player_mid["last_scan_at"]
        assert first_scan_at is not None, "last_scan_at must be set after the first scan"

        # Wait 1 second so the second scan gets a strictly later timestamp
        time.sleep(1)

        # Second scan on the same tag
        rate_limiter.clear()
        r2 = scan_tag(client, make_player_id("lsa4-player"), tag_id)
        assert r2.get_json()["status"] == "ok"

        r_final = client.get("/api/scoreboard")
        player_final = next(p for p in r_final.get_json()["players"] if p["nick"] == "NickLSA4")
        last_scan_at = player_final["last_scan_at"]

        # last_scan_at must have advanced to the second scan's timestamp
        assert last_scan_at is not None, "last_scan_at must be non-null after multiple scans"
        assert last_scan_at > first_scan_at, (
            f"last_scan_at must advance after second scan; "
            f"first={first_scan_at!r}, second={last_scan_at!r}"
        )

    # LSA-6: last_scan_at is unchanged (reflects the first successful scan) after a cooldown rejection
    def test_last_scan_at_unchanged_after_cooldown_scan(self, client, admin_client):
        from datetime import datetime, timezone, timedelta

        start_game(admin_client)
        player_id = make_player_id("lsa6-player")
        register_player(client, player_id, "NickLSA6")
        tags = create_tag(admin_client, "random", {"min": 10, "max": 10})
        tag_id = tags[0]["id"]

        # First scan succeeds and sets the per-tag cooldown
        rate_limiter.clear()
        r1 = scan_tag(client, player_id, tag_id)
        assert r1.get_json()["status"] == "ok", "First scan should succeed"

        # Bypass the 1-second global rate limit WITHOUT clearing tag_scan_limiter:
        # backdate rate_limiter entry so the rate limit check passes, then restore
        # tag_scan_limiter[scan_key] with a fresh timestamp so the 60s per-tag
        # cooldown is still active for the second scan.
        scan_key = (player_id, tag_id)
        rate_limiter[player_id] = datetime.now(timezone.utc) - timedelta(seconds=2)
        tag_scan_limiter[scan_key] = datetime.now(timezone.utc)  # restore fresh cooldown

        # Second scan must be blocked by the 60s per-tag cooldown
        r2 = scan_tag(client, player_id, tag_id)
        assert r2.get_json()["status"] == "cooldown", "Second scan should be blocked by per-tag cooldown"

        # last_scan_at must still reflect only the first (successful) scan — NOT be null
        # (the cooldown scan does not create a ScanEvent with result="ok")
        r = client.get("/api/scoreboard")
        players = r.get_json()["players"]
        player = next(p for p in players if p["nick"] == "NickLSA6")
        assert player["last_scan_at"] is not None, (
            "last_scan_at should reflect the first successful scan even after a cooldown rejection"
        )

    # LSA-5: last_scan_at is null for a player whose only scan result was "locked"
    def test_last_scan_at_null_for_locked_scan_only(self, client, admin_client):
        start_game(admin_client)

        # First player scans and locks the one_time_global tag
        register_player(client, make_player_id("lsa5-player-first"), "NickLSA5First")
        tags = create_tag(admin_client, "one_time_global", {"points": 20})
        tag_id = tags[0]["id"]

        rate_limiter.clear()
        r_first = scan_tag(client, make_player_id("lsa5-player-first"), tag_id)
        assert r_first.get_json()["status"] == "ok", "First player's scan should succeed"

        # Second player attempts to scan the same locked tag
        register_player(client, make_player_id("lsa5-player-second"), "NickLSA5Second")
        rate_limiter.clear()
        r_second = scan_tag(client, make_player_id("lsa5-player-second"), tag_id)
        assert r_second.get_json()["status"] == "locked", "Second player's scan should be locked"

        r = client.get("/api/scoreboard")
        assert r.status_code == 200
        players = r.get_json()["players"]

        second_player = next(p for p in players if p["nick"] == "NickLSA5Second")
        assert second_player["last_scan_at"] is None, (
            f"Expected last_scan_at to be None for player with only a locked scan, "
            f"got {second_player['last_scan_at']!r}"
        )
