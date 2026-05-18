"""
Block C: Strategy tests.
Block D: Rate limiting tests.
"""
from datetime import datetime, timezone, timedelta

from helpers import start_game, create_tag, register_player, scan_tag, make_player_id
from blueprints.game_api import rate_limiter


class TestStrategies:
    # C1: unlimited strategy — player can scan same tag many times, points accumulate
    def test_scan_unlimited_multiple_times(self, client, admin_client):
        start_game(admin_client)
        tags = create_tag(admin_client, "random", {"min": 10, "max": 10})
        tag_id = tags[0]["id"]
        register_player(client, make_player_id("player-c1"), "PlayerC1")

        for expected_total in [10, 20, 30]:
            # Clear rate limiter between each scan so we don't hit the 1-second limit
            rate_limiter.clear()
            r = scan_tag(client, make_player_id("player-c1"), tag_id)
            assert r.status_code == 200
            body = r.get_json()
            assert body["status"] == "ok"
            assert body["delta"] == 10
            assert body["total"] == expected_total

    # C2: one_time_global — first player gets points, second player gets "locked"
    def test_scan_one_time_global_blocks_second_player(self, client, admin_client):
        start_game(admin_client)
        tags = create_tag(admin_client, "one_time_global", {"points": 50})
        tag_id = tags[0]["id"]

        register_player(client, make_player_id("player-c2a"), "PlayerC2A")
        r_a = scan_tag(client, make_player_id("player-c2a"), tag_id)
        assert r_a.status_code == 200
        assert r_a.get_json()["status"] == "ok"

        # Different player; clear rate limiter so it is not blocked by rate limit
        rate_limiter.clear()
        register_player(client, make_player_id("player-c2b"), "PlayerC2B")
        r_b = scan_tag(client, make_player_id("player-c2b"), tag_id)
        assert r_b.status_code == 200
        assert r_b.get_json()["status"] == "locked"

    # C3: one_time_per_player — each player can scan once; second scan by same player → "locked"
    def test_scan_one_time_per_player_isolation(self, client, admin_client):
        start_game(admin_client)
        tags = create_tag(admin_client, "one_time_per_player", {"points": 20})
        tag_id = tags[0]["id"]

        register_player(client, make_player_id("player-c3a"), "PlayerC3A")
        register_player(client, make_player_id("player-c3b"), "PlayerC3B")

        # Player A scans — should succeed
        r_a = scan_tag(client, make_player_id("player-c3a"), tag_id)
        assert r_a.get_json()["status"] == "ok"

        # Player B scans same tag — should also succeed (independent per-player)
        rate_limiter.clear()
        r_b = scan_tag(client, make_player_id("player-c3b"), tag_id)
        assert r_b.get_json()["status"] == "ok"

        # Player A tries again — should be locked
        rate_limiter.clear()
        r_a2 = scan_tag(client, make_player_id("player-c3a"), tag_id)
        assert r_a2.get_json()["status"] == "locked"

    # C4: random strategy — delta falls within [min, max] across multiple players
    def test_scan_random_in_range(self, client, admin_client):
        start_game(admin_client)
        # Use unlimited strategy so the same tag can be scanned many times
        tags = create_tag(admin_client, "random", {"min": 5, "max": 10})
        tag_id = tags[0]["id"]

        deltas = []
        for i in range(20):
            pid = make_player_id(f"player-c4-{i}")
            nick = f"PlayerC4_{i}"
            register_player(client, pid, nick)
            rate_limiter.clear()
            r = scan_tag(client, pid, tag_id)
            body = r.get_json()
            assert body["status"] == "ok", f"Expected ok but got: {body}"
            deltas.append(body["delta"])

        # All deltas must be within the [min, max] range (inclusive)
        for d in deltas:
            assert 5 <= d <= 10, f"Delta {d} out of range [5, 10]"

    # C5: Negative points — player total can go below zero
    def test_scan_negative_points(self, client, admin_client):
        start_game(admin_client)
        tags = create_tag(admin_client, "random", {"min": -15, "max": -15})
        tag_id = tags[0]["id"]
        register_player(client, make_player_id("player-c5"), "PlayerC5")

        r1 = scan_tag(client, make_player_id("player-c5"), tag_id)
        assert r1.status_code == 200
        body1 = r1.get_json()
        assert body1["status"] == "ok"
        assert body1["total"] == -15

        rate_limiter.clear()
        r2 = scan_tag(client, make_player_id("player-c5"), tag_id)
        body2 = r2.get_json()
        assert body2["total"] == -30

    # S-M4: Tag with empty strategy_params defaults to 0 points for random strategy
    def test_scan_empty_strategy_params(self, client, admin_client):
        start_game(admin_client)
        # Create random tag with no min/max keys in params — strategy should default to 0
        tags = create_tag(admin_client, "random", {})
        tag_id = tags[0]["id"]
        register_player(client, make_player_id("player-sm4"), "PlayerSM4")

        r = scan_tag(client, make_player_id("player-sm4"), tag_id)
        assert r.status_code == 200
        body = r.get_json()
        assert body["status"] == "ok"
        assert body["delta"] == 0

    # S-M5: Random strategy with min == max always returns exactly that value
    def test_scan_random_min_equals_max(self, client, admin_client):
        start_game(admin_client)
        tags = create_tag(admin_client, "random", {"min": 7, "max": 7})
        tag_id = tags[0]["id"]
        register_player(client, make_player_id("player-sm5"), "PlayerSM5")

        r = scan_tag(client, make_player_id("player-sm5"), tag_id)
        assert r.status_code == 200
        body = r.get_json()
        assert body["status"] == "ok"
        assert body["delta"] == 7

    # S-M6: Random strategy with inverted range (min > max) still works — strategies.py swaps lo/hi
    def test_scan_random_inverted_range(self, client, admin_client):
        start_game(admin_client)
        tags = create_tag(admin_client, "random", {"min": 10, "max": 5})
        tag_id = tags[0]["id"]

        deltas = []
        for i in range(20):
            pid = make_player_id(f"player-sm6-{i}")
            register_player(client, pid, f"PlayerSM6_{i}")
            rate_limiter.clear()
            r = scan_tag(client, pid, tag_id)
            body = r.get_json()
            assert body["status"] == "ok", f"Expected ok but got: {body}"
            deltas.append(body["delta"])

        # Despite inverted range, all deltas must be in [5, 10]
        for d in deltas:
            assert 5 <= d <= 10, f"Delta {d} out of inverted range [5, 10]"

    # S-M7: Batch creation rejects unknown strategy names
    def test_batch_create_rejects_unknown_strategy(self, admin_client):
        r_batch = admin_client.post(
            "/admin/api/tags/batch",
            json={"strategy": "mystery_box", "strategy_params": {}, "count": 1},
        )
        assert r_batch.status_code == 400
        assert r_batch.get_json()["error"] == "UNKNOWN_STRATEGY"

    # S-M9: one_time_global tag — same player scanning it a second time gets "locked"
    def test_scan_one_time_global_locked_for_original_player(self, client, admin_client):
        start_game(admin_client)
        tags = create_tag(admin_client, "one_time_global", {"points": 30})
        tag_id = tags[0]["id"]
        register_player(client, make_player_id("player-sm9"), "PlayerSM9")

        # First scan: should succeed
        r1 = scan_tag(client, make_player_id("player-sm9"), tag_id)
        assert r1.get_json()["status"] == "ok"

        # Same player scans again — tag is globally locked
        rate_limiter.clear()
        r2 = scan_tag(client, make_player_id("player-sm9"), tag_id)
        assert r2.get_json()["status"] == "locked"

    # C3-fix: one_time_per_player order independence — B scans first, then A; both succeed
    def test_scan_one_time_per_player_order_independence(self, client, admin_client):
        start_game(admin_client)
        tags = create_tag(admin_client, "one_time_per_player", {"points": 15})
        tag_id = tags[0]["id"]

        register_player(client, make_player_id("player-c3fix-a"), "PlayerC3FixA")
        register_player(client, make_player_id("player-c3fix-b"), "PlayerC3FixB")

        # Player B scans first
        r_b1 = scan_tag(client, make_player_id("player-c3fix-b"), tag_id)
        assert r_b1.get_json()["status"] == "ok"

        # Player A scans second — must also succeed (independent per player)
        rate_limiter.clear()
        r_a1 = scan_tag(client, make_player_id("player-c3fix-a"), tag_id)
        assert r_a1.get_json()["status"] == "ok"

        # Player A scans again — must be locked
        rate_limiter.clear()
        r_a2 = scan_tag(client, make_player_id("player-c3fix-a"), tag_id)
        assert r_a2.get_json()["status"] == "locked"

        # Player B scans again — must also be locked
        rate_limiter.clear()
        r_b2 = scan_tag(client, make_player_id("player-c3fix-b"), tag_id)
        assert r_b2.get_json()["status"] == "locked"

    # C4-fix: Same player can scan a random tag multiple times; every result is "ok"
    def test_scan_random_same_player_multiple_times(self, client, admin_client):
        start_game(admin_client)
        tags = create_tag(admin_client, "random", {"min": 5, "max": 10})
        tag_id = tags[0]["id"]
        register_player(client, make_player_id("player-c4fix"), "PlayerC4Fix")

        total = 0
        for _ in range(10):
            rate_limiter.clear()
            r = scan_tag(client, make_player_id("player-c4fix"), tag_id)
            body = r.get_json()
            assert body["status"] == "ok", f"Expected ok but got: {body}"
            assert 5 <= body["delta"] <= 10, f"Delta {body['delta']} out of range [5,10]"
            total += body["delta"]

        # After 10 scans with range [5,10], cumulative total must be in [50, 100]
        assert 50 <= total <= 100, f"Total {total} outside expected range [50, 100]"

    # S-new-1: Scanning multiple one_time_per_player tags accumulates points correctly
    def test_scan_one_time_per_player_multiple_tags_accumulates(self, client, admin_client):
        start_game(admin_client)
        register_player(client, make_player_id("player-snew1"), "PlayerSNew1")

        # Create 3 independent one_time_per_player tags worth 20 pts each
        tag_ids = []
        for _ in range(3):
            tags = create_tag(admin_client, "one_time_per_player", {"points": 20})
            tag_ids.append(tags[0]["id"])

        # Scan all three — each should succeed
        for tag_id in tag_ids:
            rate_limiter.clear()
            r = scan_tag(client, make_player_id("player-snew1"), tag_id)
            assert r.get_json()["status"] == "ok"

        # Total points on scoreboard should be 60
        sb = client.get("/api/scoreboard").get_json()
        player_data = next(p for p in sb["players"] if p["nick"] == "PlayerSNew1")
        assert player_data["points"] == 60

        # Scanning any of the tags again should now be locked
        rate_limiter.clear()
        r_lock = scan_tag(client, make_player_id("player-snew1"), tag_ids[0])
        assert r_lock.get_json()["status"] == "locked"

    # S-new-2: Random strategy works with negative and mixed ranges
    def test_scan_random_negative_range(self, client, admin_client):
        start_game(admin_client)

        # Negative-only range: [-20, -5]
        tags_neg = create_tag(admin_client, "random", {"min": -20, "max": -5})
        tag_neg_id = tags_neg[0]["id"]
        register_player(client, make_player_id("player-snew2a"), "PlayerSNew2A")

        r_neg = scan_tag(client, make_player_id("player-snew2a"), tag_neg_id)
        body_neg = r_neg.get_json()
        assert body_neg["status"] == "ok"
        assert -20 <= body_neg["delta"] <= -5, f"Delta {body_neg['delta']} out of range [-20, -5]"

        # Mixed range: [-10, 10]
        tags_mix = create_tag(admin_client, "random", {"min": -10, "max": 10})
        tag_mix_id = tags_mix[0]["id"]
        register_player(client, make_player_id("player-snew2b"), "PlayerSNew2B")

        r_mix = scan_tag(client, make_player_id("player-snew2b"), tag_mix_id)
        body_mix = r_mix.get_json()
        assert body_mix["status"] == "ok"
        assert -10 <= body_mix["delta"] <= 10, f"Delta {body_mix['delta']} out of range [-10, 10]"


    # one_time_per_player with negative points (replaces penalty strategy)
    def test_scan_one_time_per_player_negative_points(self, client, admin_client):
        start_game(admin_client)
        tags = create_tag(admin_client, "one_time_per_player", {"points": -25})
        tag_id = tags[0]["id"]
        register_player(client, make_player_id("player-neg1"), "PlayerNeg1")

        r = scan_tag(client, make_player_id("player-neg1"), tag_id)
        assert r.status_code == 200
        body = r.get_json()
        assert body["status"] == "ok"
        assert body["delta"] == -25
        assert body["total"] == -25


class TestRateLimit:
    # D1: Two immediate scans by the same player → second returns 429
    def test_rate_limit_blocks_fast_rescan(self, client, admin_client):
        start_game(admin_client)
        tags = create_tag(admin_client, "random", {"min": 10, "max": 10})
        tag_id = tags[0]["id"]
        register_player(client, make_player_id("player-d1"), "PlayerD1")

        # First scan should succeed
        r1 = scan_tag(client, make_player_id("player-d1"), tag_id)
        assert r1.status_code == 200

        # Second immediate scan should be rate-limited
        r2 = scan_tag(client, make_player_id("player-d1"), tag_id)
        assert r2.status_code == 429

    # D2: After manually backdating the rate limiter entry, next scan succeeds
    def test_rate_limit_allows_after_cooldown(self, client, admin_client):
        start_game(admin_client)
        tags = create_tag(admin_client, "random", {"min": 10, "max": 10})
        tag_id = tags[0]["id"]
        register_player(client, make_player_id("player-d2"), "PlayerD2")

        # First scan goes through
        r1 = scan_tag(client, make_player_id("player-d2"), tag_id)
        assert r1.status_code == 200

        # Simulate time passing by backdating the rate limiter entry
        rate_limiter[make_player_id("player-d2")] = datetime.now(timezone.utc) - timedelta(seconds=2)

        # Second scan should succeed now that the cooldown has "expired"
        r2 = scan_tag(client, make_player_id("player-d2"), tag_id)
        assert r2.status_code == 200
        assert r2.get_json()["status"] == "ok"

    # D-M1: Rate limit applies across different tags — same player, different tags
    def test_rate_limit_applies_across_different_tags(self, client, admin_client):
        start_game(admin_client)
        register_player(client, make_player_id("player-dm1"), "PlayerDM1")
        tags1 = create_tag(admin_client, "random", {"min": 10, "max": 10})
        tags2 = create_tag(admin_client, "random", {"min": 10, "max": 10})
        tag1_id = tags1[0]["id"]
        tag2_id = tags2[0]["id"]

        # First scan on tag1 succeeds
        rate_limiter.clear()
        r1 = scan_tag(client, make_player_id("player-dm1"), tag1_id)
        assert r1.status_code == 200
        assert r1.get_json()["status"] == "ok"

        # Immediately scan tag2 with the same player — must be rate-limited
        r2 = scan_tag(client, make_player_id("player-dm1"), tag2_id)
        assert r2.status_code == 429

    # D-M2: Rate limit is per-player — different players have independent cooldowns
    def test_rate_limit_independent_for_different_players(self, client, admin_client):
        start_game(admin_client)
        register_player(client, make_player_id("player-dm2a"), "PlayerDM2A")
        register_player(client, make_player_id("player-dm2b"), "PlayerDM2B")
        tags = create_tag(admin_client, "random", {"min": 10, "max": 10})
        tag_id = tags[0]["id"]

        # Player A scans first
        rate_limiter.clear()
        r_a = scan_tag(client, make_player_id("player-dm2a"), tag_id)
        assert r_a.status_code == 200
        assert r_a.get_json()["status"] == "ok"

        # Player B scans immediately after — should NOT be rate-limited (independent limiter)
        r_b = scan_tag(client, make_player_id("player-dm2b"), tag_id)
        assert r_b.status_code == 200
        body_b = r_b.get_json()
        # Tag is unlimited — it always returns "ok", never "locked" or "unknown"
        assert body_b.get("status") == "ok", \
            f"Expected ok but got: {body_b}"

    # D-M3: Rate-limited response body must have status="rate_limit" and non-empty message
    def test_rate_limit_429_body(self, client, admin_client):
        start_game(admin_client)
        register_player(client, make_player_id("player-dm3"), "PlayerDM3")
        tags = create_tag(admin_client, "random", {"min": 10, "max": 10})
        tag_id = tags[0]["id"]

        # First scan succeeds
        rate_limiter.clear()
        r1 = scan_tag(client, make_player_id("player-dm3"), tag_id)
        assert r1.status_code == 200

        # Second immediate scan must return 429 with correct body shape
        r2 = scan_tag(client, make_player_id("player-dm3"), tag_id)
        assert r2.status_code == 429
        body = r2.get_json()
        assert body.get("status") == "rate_limit"
        assert isinstance(body.get("message"), str)
        assert len(body["message"]) > 0


class TestBonusPenaltyStrategy:
    # BP-1: First scan awards full points and status is "ok"
    def test_bonus_penalty_first_scan_awards_points(self, client, admin_client):
        start_game(admin_client)
        tags = create_tag(admin_client, "bonus_penalty", {"points": 50})
        tag_id = tags[0]["id"]
        register_player(client, make_player_id("player-bp1"), "PlayerBP1")

        r = scan_tag(client, make_player_id("player-bp1"), tag_id)
        assert r.status_code == 200
        body = r.get_json()
        assert body["status"] == "ok"
        assert body["delta"] == 50
        assert body["total"] == 50

    # BP-2: Second scan by the same player deducts 90% of points and status is "ok"
    def test_bonus_penalty_second_scan_deducts(self, client, admin_client):
        start_game(admin_client)
        tags = create_tag(admin_client, "bonus_penalty", {"points": 50})
        tag_id = tags[0]["id"]
        register_player(client, make_player_id("player-bp2"), "PlayerBP2")

        # First scan: award points
        r1 = scan_tag(client, make_player_id("player-bp2"), tag_id)
        assert r1.get_json()["status"] == "ok"
        assert r1.get_json()["delta"] == 50

        # Second scan: deduct penalty = round(0.9 * 50) = 45
        rate_limiter.clear()
        r2 = scan_tag(client, make_player_id("player-bp2"), tag_id)
        assert r2.status_code == 200
        body2 = r2.get_json()
        assert body2["status"] == "ok"
        assert body2["delta"] == -45
        assert body2["total"] == 5  # 50 - 45 = 5

    # BP-3: Third scan deducts the same penalty again (not compounding)
    def test_bonus_penalty_third_scan_deducts_again(self, client, admin_client):
        start_game(admin_client)
        tags = create_tag(admin_client, "bonus_penalty", {"points": 50})
        tag_id = tags[0]["id"]
        register_player(client, make_player_id("player-bp3"), "PlayerBP3")

        # First scan: +50
        r1 = scan_tag(client, make_player_id("player-bp3"), tag_id)
        assert r1.get_json()["delta"] == 50

        # Second scan: -45 → total = 5
        rate_limiter.clear()
        r2 = scan_tag(client, make_player_id("player-bp3"), tag_id)
        assert r2.get_json()["delta"] == -45

        # Third scan: -45 again (same fixed penalty, not compounding) → total = -40
        rate_limiter.clear()
        r3 = scan_tag(client, make_player_id("player-bp3"), tag_id)
        body3 = r3.get_json()
        assert body3["status"] == "ok"
        assert body3["delta"] == -45
        assert body3["total"] == -40  # 50 - 45 - 45 = -40

    # BP-4: Player B's first scan still awards full points after Player A has been penalized
    def test_bonus_penalty_independent_per_player(self, client, admin_client):
        start_game(admin_client)
        tags = create_tag(admin_client, "bonus_penalty", {"points": 100})
        tag_id = tags[0]["id"]
        register_player(client, make_player_id("player-bp4a"), "PlayerBP4A")
        register_player(client, make_player_id("player-bp4b"), "PlayerBP4B")

        # Player A: first scan (+100)
        r_a1 = scan_tag(client, make_player_id("player-bp4a"), tag_id)
        assert r_a1.get_json()["delta"] == 100

        # Player A: second scan (penalty, -90)
        rate_limiter.clear()
        r_a2 = scan_tag(client, make_player_id("player-bp4a"), tag_id)
        assert r_a2.get_json()["delta"] == -90

        # Player B: first scan — must still award full points, unaffected by Player A
        rate_limiter.clear()
        r_b1 = scan_tag(client, make_player_id("player-bp4b"), tag_id)
        body_b1 = r_b1.get_json()
        assert body_b1["status"] == "ok"
        assert body_b1["delta"] == 100
        assert body_b1["total"] == 100

    # BP-5: points=0 — first scan delta=0, second scan delta=0, no crash
    def test_bonus_penalty_zero_points(self, client, admin_client):
        start_game(admin_client)
        tags = create_tag(admin_client, "bonus_penalty", {"points": 0})
        tag_id = tags[0]["id"]
        register_player(client, make_player_id("player-bp5"), "PlayerBP5")

        r1 = scan_tag(client, make_player_id("player-bp5"), tag_id)
        body1 = r1.get_json()
        assert body1["status"] == "ok"
        assert body1["delta"] == 0

        rate_limiter.clear()
        r2 = scan_tag(client, make_player_id("player-bp5"), tag_id)
        body2 = r2.get_json()
        assert body2["status"] == "ok"
        assert body2["delta"] == 0  # round(0.9 * 0) = 0
        assert body2["total"] == 0

    # BP-6: points=11 — first scan delta=11, second scan delta=-10 (round(0.9*11)=round(9.9)=10)
    def test_bonus_penalty_rounding(self, client, admin_client):
        start_game(admin_client)
        tags = create_tag(admin_client, "bonus_penalty", {"points": 11})
        tag_id = tags[0]["id"]
        register_player(client, make_player_id("player-bp6"), "PlayerBP6")

        r1 = scan_tag(client, make_player_id("player-bp6"), tag_id)
        body1 = r1.get_json()
        assert body1["status"] == "ok"
        assert body1["delta"] == 11

        rate_limiter.clear()
        r2 = scan_tag(client, make_player_id("player-bp6"), tag_id)
        body2 = r2.get_json()
        assert body2["status"] == "ok"
        assert body2["delta"] == -10  # round(0.9 * 11) = round(9.9) = 10
